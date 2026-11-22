package app.cookbook.core.sync

import app.cookbook.core.domain.PantryItem
import app.cookbook.core.domain.PlanEntry
import app.cookbook.core.domain.PreparedBatch
import app.cookbook.core.domain.Recipe
import app.cookbook.core.domain.Settings
import app.cookbook.core.domain.ShoppingItem
import app.cookbook.core.domain.State
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.jsString
import app.cookbook.core.json.jsTruthy
import app.cookbook.core.store.Problem
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Ports of keepMine, copyOfMine and describeProblem from src/lib/sync-engine.ts.

private fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

/** `{ ...p, key: value }`, where an undefined value disappears from the JSON as it does in JSON.stringify. */
private fun JsonObject.with(key: String, value: JsonElement?): JsonObject =
    JsonObject(LinkedHashMap(this).also { if (value == null) it.remove(key) else it[key] = value })

/** Keep mine: the same change, checked against the latest version this time. */
fun keepMine(problem: Problem, state: State): JsonElement {
    val payload = problem.item.payload
    val p = payload as? JsonObject ?: JsonObject(emptyMap())
    fun recipe(id: String?) = state.recipes.firstOrNull { id != null && it.id == id }
    fun version(at: String?) = at?.let { JsonPrimitive(it) }
    return when (problem.item.type) {
        "recipe.update" -> p.with("expectedUpdatedAt", version(recipe(str(p["recipeId"]))?.updatedAt))
        "recipe.save" -> p.with("expectedUpdatedAt", version(recipe(str(p["id"]))?.updatedAt))
        "draft.save" -> p.with("expectedUpdatedAt", version(state.drafts.firstOrNull { str(p["id"]) == it.id }?.recipe?.updatedAt))
        "cook" -> {
            val usage = p["usage"] as? JsonArray ?: return p.with("usage", p["usage"])
            p.with("usage", JsonArray(usage.map { u ->
                val pantryId = str((u as? JsonObject)?.get("pantryId"))
                val stock = state.pantry.firstOrNull { pantryId != null && it.id == pantryId }
                if (stock == null) u else (u as JsonObject).with("expected", JsonPrimitive(CookbookJson.encodeToString(PantryItem.serializer(), stock)))
            }))
        }
        else -> {
            if (str(p["__expected"]) == null) return if (payload is JsonNull) p else payload
            val id = str(p["id"])
            val current: String? = when (problem.item.type) {
                "settings.save" -> CookbookJson.encodeToString(Settings.serializer(), state.settings)
                "pantry.save" -> state.pantry.firstOrNull { it.id == id }?.let { CookbookJson.encodeToString(PantryItem.serializer(), it) }
                "shopping.save" -> state.shopping.firstOrNull { it.id == id }?.let { CookbookJson.encodeToString(ShoppingItem.serializer(), it) }
                "plan.save" -> state.plan.firstOrNull { it.id == id }?.let { CookbookJson.encodeToString(PlanEntry.serializer(), it) }
                "batch.update" -> state.batches.firstOrNull { it.id == id }?.let { CookbookJson.encodeToString(PreparedBatch.serializer(), it) }
                else -> null
            }
            p.with("__expected", current?.let { JsonPrimitive(it) })
        }
    }
}

/** Save mine as a copy: for recipe edits, a new recipe (with id [newId]) so nothing is overwritten. */
fun copyOfMine(problem: Problem, state: State, newId: String): JsonObject? {
    val p = problem.item.payload as? JsonObject ?: JsonObject(emptyMap())
    val base: JsonObject = when (problem.item.type) {
        "recipe.update" -> {
            val id = str(p["recipeId"])
            val recipe = state.recipes.firstOrNull { id != null && it.id == id }
                ?.let { CookbookJson.encodeToJsonElement(Recipe.serializer(), it) as JsonObject } ?: JsonObject(emptyMap())
            JsonObject(recipe + ((p["changes"] as? JsonObject) ?: JsonObject(emptyMap())))
        }
        "recipe.save" -> p
        else -> return null
    }
    if (!jsTruthy(base["title"])) return null
    val rest = LinkedHashMap(base).also { it.remove("expectedUpdatedAt"); it.remove("createdAt"); it.remove("updatedAt") }
    rest["id"] = JsonPrimitive(newId)
    rest["title"] = JsonPrimitive(jsString(base["title"]).take(180) + " (my version)")
    return JsonObject(rest)
}

private val DESCRIPTIONS = mapOf(
    "recipe.update" to "Recipe edit", "recipe.save" to "Recipe", "recipe.delete" to "Recipe removal", "draft.save" to "Draft",
    "pantry.save" to "Pantry item", "shopping.save" to "Shopping item", "shopping.toggle" to "Checkmark", "shopping.purchase" to "Purchases",
    "plan.save" to "Planned meal", "plan.delete" to "Planned meal removal", "cook" to "Cooked meal", "leftover.eat" to "Leftovers",
    "batch.update" to "Leftovers", "settings.save" to "Settings", "ingredient.save" to "Ingredient names",
)

fun describeProblem(problem: Problem): String = DESCRIPTIONS[problem.item.type] ?: "Change"
