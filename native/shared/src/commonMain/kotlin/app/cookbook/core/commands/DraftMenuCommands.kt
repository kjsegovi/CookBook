package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.ImportDraft
import app.cookbook.core.domain.Menu
import app.cookbook.core.domain.MenuItem
import app.cookbook.core.domain.PlanEntry
import app.cookbook.core.domain.clean
import app.cookbook.core.domain.jsRound
import app.cookbook.core.domain.normalizeRecipe
import app.cookbook.core.domain.positive
import app.cookbook.core.domain.shiftDate
import app.cookbook.core.domain.validDate
import app.cookbook.core.json.jsNumber
import app.cookbook.core.json.jsTruthy
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// draft.save, draft.delete, menu.save, menu.delete and menu.plan from commands.ts.

private val SLOTS = listOf("Breakfast", "Lunch", "Dinner", "Snack")

internal fun CommandContext.draftSave() {
    val existing = state.drafts.firstOrNull { this["id"].jsEquals(it.id) }
    val expected = this["expectedUpdatedAt"]
    if (jsTruthy(expected) && (existing == null || !expected.jsEquals(existing.recipe.updatedAt))) {
        throw DomainError("This draft changed. Load the latest version before saving.", 409)
    }
    // An object or array recipe gets an id (JavaScript spreads an array into an object); anything else is refused,
    // as normalizeRecipe refuses it in TypeScript.
    val fields = this["recipe"].asJsObject() ?: throw DomainError("Recipe details are required.")
    val withId = JsonObject(fields + ("id" to JsonPrimitive(clean(fields["id"], 100).ifEmpty { nextId() })))
    val recipe = normalizeRecipe(withId, true, at, newIngredientId)
    val draft = ImportDraft(
        id = clean(this["id"], 100).ifEmpty { nextId() },
        recipe = if (existing != null) recipe.copy(updatedAt = later(existing.recipe.updatedAt, recipe.updatedAt)) else recipe,
        text = clean(this["text"], 60000),
        warnings = this["warnings"].arrayItems().take(20).map { clean(it, 500) },
        createdAt = at,
    )
    state.drafts.removeAll { it.id == draft.id }
    state.drafts.add(draft)
}

internal fun CommandContext.draftDelete() {
    val id = this["id"]
    state.drafts.removeAll { id.jsEquals(it.id) }
}

internal fun CommandContext.menuSave() {
    val existing = state.menus.firstOrNull { this["id"].jsEquals(it.id) }
    val expected = this["expectedUpdatedAt"]
    if (existing != null && jsTruthy(expected) && !expected.jsEquals(existing.updatedAt)) {
        throw DomainError("This menu changed. Reopen it to review the latest version.", 409)
    }
    val name = clean(this["name"], 200)
    if (name.isEmpty()) throw DomainError("Give the menu a name.")
    val items = this["items"].arrayItems().take(200).map { raw ->
        // `item?.day`: a value that is not an object has no fields.
        val item = raw.asJsObject()
        val day = jsNumber(item?.get("day")).let { if (it.isNaN() || it == 0.0) 1.0 else it }
        val slot = item?.get("slot")
        MenuItem(
            recipeId = clean(item?.get("recipeId"), 100),
            day = minOf(31.0, maxOf(1.0, jsRound(day))).toInt(),
            slot = if (slot is JsonPrimitive && slot !is JsonNull && slot.isString && slot.content in SLOTS) slot.content else "Dinner",
        )
    }
    for (item in items) recipeById(JsonPrimitive(item.recipeId))
    if (items.isEmpty()) throw DomainError("Add at least one recipe to the menu.")
    if (existing == null && state.menus.size >= 500) throw DomainError("Remove a menu before adding more than 500.")
    val menu = Menu(
        id = clean(this["id"], 100).ifEmpty { nextId() },
        name = name,
        description = clean(this["description"], 2000),
        items = items,
        createdAt = existing?.createdAt ?: at,
        updatedAt = later(existing?.updatedAt, at),
    )
    state.menus = if (existing != null) state.menus.map { if (it.id == menu.id) menu else it }.toMutableList() else (state.menus + menu).toMutableList()
}

internal fun CommandContext.menuDelete() {
    val id = this["id"]
    state.menus.removeAll { id.jsEquals(it.id) }
}

/** Adds every recipe in the menu to the meal plan, day 1 on the chosen date. */
internal fun CommandContext.menuPlan() {
    val menuId = this["menuId"]
    val menu = state.menus.firstOrNull { menuId.jsEquals(it.id) } ?: throw DomainError("This menu was removed. Refresh and choose another.", 404)
    val start = validDate(this["date"])
    for (item in menu.items) {
        val recipe = recipeById(JsonPrimitive(item.recipeId))
        val servingsInput = this["servings"].let { if (it == null || it is JsonNull) JsonPrimitive(state.settings.servings) else it }
        val servings = positive(servingsInput, "Servings")
        state.plan.add(
            PlanEntry(
                id = nextId(), date = shiftDate(start, item.day - 1), slot = item.slot, kind = "cook", recipeId = recipe.id, batchId = "",
                cookServings = maxOf(servings, recipe.servings), eatServings = servings, done = false, note = menu.name,
            ),
        )
    }
}
