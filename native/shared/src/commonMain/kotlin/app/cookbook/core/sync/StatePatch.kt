package app.cookbook.core.sync

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.State
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.sameAs
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Ported from state-patch.ts. Rows are handled as JSON so unknown keys survive.

val COLLECTIONS = listOf("recipes", "pantry", "plan", "batches", "shopping", "ingredients", "drafts", "movements", "menus")

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class CollectionPatch(
    val upsert: List<JsonObject>,
    val remove: List<String>,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val order: List<String>? = null,
)

@Serializable
data class StatePatch(
    val collections: Map<String, CollectionPatch>,
    val values: JsonObject,
    val appendOperations: List<String>,
)

private const val INCOMPLETE = "The cookbook update is incomplete. Reload to get the latest version."
private val VALUE_KEYS = listOf("settings", "shoppingWeek", "reminders")

private fun encode(state: State): JsonObject = CookbookJson.encodeToJsonElement(State.serializer(), state).jsonObject
private fun rows(state: JsonObject, key: String): List<JsonObject> = (state[key] as? JsonArray)?.map { it.jsonObject } ?: emptyList()
private fun idOf(row: JsonObject): String = row.getValue("id").jsonPrimitive.content

fun statePatch(before: State, after: State): StatePatch {
    val b = encode(before)
    val a = encode(after)
    val collections = LinkedHashMap<String, CollectionPatch>()
    for (key in COLLECTIONS) {
        val beforeRows = rows(b, key)
        val afterRows = rows(a, key)
        val previous = beforeRows.associateBy { idOf(it) }
        val next = afterRows.map { idOf(it) }.toSet()
        val upsert = afterRows.filter { row -> previous[idOf(row)]?.let { !it.sameAs(row) } ?: true }
        val remove = beforeRows.filter { idOf(it) !in next }.map { idOf(it) }
        val reordered = beforeRows.map { idOf(it) } != afterRows.map { idOf(it) }
        if (upsert.isNotEmpty() || remove.isNotEmpty() || reordered) {
            collections[key] = CollectionPatch(upsert, remove, if (reordered) afterRows.map { idOf(it) } else null)
        }
    }
    val values = LinkedHashMap<String, JsonElement>()
    for (key in VALUE_KEYS) {
        val old = b[key]
        val new = a[key]
        val same = if (old == null || new == null) old == null && new == null else old.sameAs(new)
        // A cleared value is dropped on the wire, as undefined is in JSON.stringify.
        if (!same && new != null) values[key] = new
    }
    val known = before.operations.toSet()
    return StatePatch(collections, JsonObject(values), after.operations.filter { it !in known })
}

fun applyStatePatch(original: State, patch: StatePatch): State {
    val next = LinkedHashMap<String, JsonElement>(encode(original))
    for ((k, v) in patch.values) next[k] = v
    for (key in COLLECTIONS) {
        val change = patch.collections[key] ?: continue
        val map = LinkedHashMap<String, JsonObject>()
        for (row in rows(JsonObject(next), key)) map[idOf(row)] = row
        for (id in change.remove) map.remove(id)
        for (row in change.upsert) map[idOf(row)] = row
        val ordered = change.order?.map { map[it] ?: throw DomainError(INCOMPLETE) } ?: map.values.toList()
        if (ordered.size != map.size || ordered.map { idOf(it) }.toSet().size != map.size) throw DomainError(INCOMPLETE)
        next[key] = JsonArray(ordered)
    }
    if (patch.appendOperations.isNotEmpty()) {
        val ops = (next["operations"] as? JsonArray ?: JsonArray(emptyList())) + patch.appendOperations.map { JsonPrimitive(it) }
        next["operations"] = JsonArray(ops.takeLast(200))
    }
    return CookbookJson.decodeFromJsonElement(State.serializer(), JsonObject(next))
}
