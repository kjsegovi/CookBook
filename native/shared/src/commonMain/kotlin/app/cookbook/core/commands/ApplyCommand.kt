package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.ImportDraft
import app.cookbook.core.domain.Ingredient
import app.cookbook.core.domain.Menu
import app.cookbook.core.domain.Movement
import app.cookbook.core.domain.PantryItem
import app.cookbook.core.domain.PlanEntry
import app.cookbook.core.domain.PreparedBatch
import app.cookbook.core.domain.Recipe
import app.cookbook.core.domain.Settings
import app.cookbook.core.domain.ShoppingItem
import app.cookbook.core.domain.State
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.jsTruthy
import app.cookbook.core.json.jsString
import app.cookbook.core.json.jsonParse
import app.cookbook.core.json.stableJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Port of applyCommand in supabase/functions/_shared/commands.ts. TypeScript mutates a structuredClone of the
// state; here the collections are mutable lists of immutable records, and a change replaces the record.

/** A working copy of [State] that commands change in place. */
class MutableState(original: State) {
    var recipes: MutableList<Recipe> = original.recipes.toMutableList()
    var pantry: MutableList<PantryItem> = original.pantry.toMutableList()
    var plan: MutableList<PlanEntry> = original.plan.toMutableList()
    var batches: MutableList<PreparedBatch> = original.batches.toMutableList()
    var shopping: MutableList<ShoppingItem> = original.shopping.toMutableList()
    var shoppingWeek: String = original.shoppingWeek
    var menus: MutableList<Menu> = original.menus.toMutableList()
    var ingredients: MutableList<Ingredient> = original.ingredients.toMutableList()
    var drafts: MutableList<ImportDraft> = original.drafts.toMutableList()
    var movements: MutableList<Movement> = original.movements.toMutableList()
    val operations: MutableList<String> = original.operations.toMutableList()
    var settings: Settings = original.settings
    private val reminders = original.reminders
    private val extra = original.extra

    fun toState(): State = State(
        recipes = recipes.toList(), pantry = pantry.toList(), plan = plan.toList(), batches = batches.toList(),
        shopping = shopping.toList(), shoppingWeek = shoppingWeek, menus = menus.toList(), ingredients = ingredients.toList(),
        drafts = drafts.toList(), movements = movements.toList(), operations = operations.toList(), settings = settings,
        reminders = reminders, extra = extra,
    )
}

/** What a command sees: the working state, its payload `p`, the time and the id generator. */
class CommandContext(
    val state: MutableState,
    val payload: JsonObject,
    val at: String,
    val nextId: () -> String,
    val operationId: String,
) {
    private var ingredientIds = 0

    /**
     * Ids for ingredient lines that arrive without one. TypeScript gives them random ids (crypto.randomUUID); commands
     * here stay deterministic, and use their own counter so the ids [nextId] hands out still match the server's.
     */
    val newIngredientId: () -> String = { "${operationId.take(90)}-line-${(++ingredientIds).toString(36)}" }

    /** `p[key]`; a missing key is `undefined` (null). */
    operator fun get(key: String): JsonElement? = payload[key]

    /** The index of the recipe whose id is `id` (compared strictly, as `===`), or a 404 DomainError. */
    fun recipeIndex(id: JsonElement?): Int {
        val index = state.recipes.indexOfFirst { id.jsEquals(it.id) }
        if (index < 0) throw DomainError("This recipe was removed. Refresh and choose another.", 404)
        return index
    }

    fun recipeById(id: JsonElement?): Recipe = state.recipes[recipeIndex(id)]

    fun movement(name: String, amount: Double?, unit: String, reason: String) {
        state.movements.add(Movement(id = nextId(), name = name, amount = amount, unit = unit, reason = reason, at = at))
    }
}

/** `value === text` for a JSON value and a string. */
internal fun JsonElement?.jsEquals(text: String): Boolean = this is JsonPrimitive && this !is JsonNull && isString && content == text

/** `typeof value === 'object' && value !== null`: an array reads like an object keyed by index (`length` aside). */
internal fun JsonElement?.asJsObject(): JsonObject? = when (this) {
    is JsonObject -> this
    is JsonArray -> JsonObject(mapIndexed { index, item -> index.toString() to item }.toMap())
    else -> null
}

/** `Array.isArray(value) ? value : []` */
internal fun JsonElement?.arrayItems(): List<JsonElement> = (this as? JsonArray) ?: emptyList()

/**
 * updatedAt is the per-recipe conflict check, so each save must move it forward even when two saves land in the
 * same millisecond.
 */
internal fun later(previous: String?, at: String): String {
    if (previous.isNullOrEmpty()) return at
    val before = jsDateParse(previous)
    return if (jsDateParse(at) <= before) jsIsoString(before.toLong() + 1) else at
}

private fun recordJson(record: Any?): JsonElement? = when (record) {
    null -> null
    is JsonElement -> record
    is PantryItem -> CookbookJson.encodeToJsonElement(PantryItem.serializer(), record)
    is ShoppingItem -> CookbookJson.encodeToJsonElement(ShoppingItem.serializer(), record)
    is PlanEntry -> CookbookJson.encodeToJsonElement(PlanEntry.serializer(), record)
    is PreparedBatch -> CookbookJson.encodeToJsonElement(PreparedBatch.serializer(), record)
    is Settings -> CookbookJson.encodeToJsonElement(Settings.serializer(), record)
    is Recipe -> CookbookJson.encodeToJsonElement(Recipe.serializer(), record)
    else -> throw IllegalArgumentException("No JSON form for ${record::class.simpleName}")
}

/** Compares a record with the JSON a form captured, ignoring key order. A missing record or bad JSON never matches. */
internal fun sameRecord(record: Any?, expected: String): Boolean {
    val json = recordJson(record) ?: return false
    val parsed = try { jsonParse(expected) } catch (_: IllegalArgumentException) { return false }
    return stableJson(json) == stableJson(parsed)
}

/**
 * Applies one command to a copy of [original]. `clock` lets an offline device replay a queued change with the time
 * it was made. Ids created by a command derive from [operationId], so a replay predicts the ids the server creates.
 */
fun applyCommand(original: State, type: String, payload: JsonElement?, operationId: String, clock: String? = null): State {
    if (operationId in original.operations) return original
    val p = payload.asJsObject() ?: throw DomainError("Action details are required.")
    val s = MutableState(original)
    val at = clock ?: nowIso()
    var created = 0
    val nextId = { "${operationId.take(90)}-${(++created).toString(36)}" }
    val ctx = CommandContext(s, p, at, nextId, operationId)

    // Forms send the record they opened as __expected; a save is refused if the record changed since.
    val expectedRecord: Any? = when (type) {
        "pantry.save" -> s.pantry.firstOrNull { p["id"].jsEquals(it.id) }
        "shopping.save" -> s.shopping.firstOrNull { p["id"].jsEquals(it.id) }
        "plan.save" -> s.plan.firstOrNull { p["id"].jsEquals(it.id) }
        "batch.update" -> s.batches.firstOrNull { p["id"].jsEquals(it.id) }
        "settings.save" -> s.settings
        else -> null
    }
    if (jsTruthy(p["__expected"])) {
        val expected = try { jsonParse(jsString(p["__expected"])) } catch (_: IllegalArgumentException) {
            throw DomainError("Reopen this form before saving.", 409)
        }
        val current = recordJson(expectedRecord)
        if (current == null || stableJson(current) != stableJson(expected)) {
            throw DomainError("This item changed. Close this form and reopen it to review the latest version.", 409)
        }
    }

    when (type) {
        "recipe.favorite" -> ctx.recipeFavorite()
        "recipe.rate" -> ctx.recipeRate()
        "recipes.import" -> ctx.recipesImport()
        "menu.save" -> ctx.menuSave()
        "menu.delete" -> ctx.menuDelete()
        "menu.plan" -> ctx.menuPlan()
        // reminders.sync and reminders.ack are server-only (the Reminders shortcut talks to the server), so they are
        // unknown here.
        "reminders.sync", "reminders.ack" -> throw DomainError("Unknown action.")
        "recipe.update" -> ctx.recipeUpdate()
        "recipe.save" -> ctx.recipeSave()
        "recipe.delete" -> ctx.recipeDelete()
        "pantry.save" -> ctx.pantrySave()
        "pantry.delete" -> ctx.pantryDelete()
        "ingredient.save" -> ctx.ingredientSave()
        "plan.save" -> ctx.planSave()
        "plan.move" -> ctx.planMove()
        "plan.delete" -> ctx.planDelete()
        "cook" -> ctx.cook()
        "leftover.eat" -> ctx.leftoverEat()
        "batch.update" -> ctx.batchUpdate()
        "shopping.generate" -> ctx.shoppingGenerate()
        "shopping.save" -> ctx.shoppingSave()
        "shopping.toggle" -> ctx.shoppingToggle()
        "shopping.delete" -> ctx.shoppingDelete()
        "shopping.purchase" -> ctx.shoppingPurchase()
        "draft.save" -> ctx.draftSave()
        "draft.delete" -> ctx.draftDelete()
        "settings.save" -> ctx.settingsSave()
        else -> throw DomainError("Unknown action.")
    }
    s.operations.add(operationId)
    return s.toState()
}
