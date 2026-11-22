package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.ImportDraft
import app.cookbook.core.domain.Recipe
import app.cookbook.core.domain.clean
import app.cookbook.core.domain.normalizeRecipe
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.jsIsFinite
import app.cookbook.core.json.jsNumber
import app.cookbook.core.json.jsTruthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.math.floor

// recipe.favorite, recipe.rate, recipe.update, recipe.save, recipe.delete and recipes.import from commands.ts.

private const val RECIPE_LIMIT = 2000
private const val TOO_MANY_RECIPES = "Export your collection before adding more than 2,000 recipes."
private const val RECIPE_CHANGED = "This recipe changed. Load the latest version before saving."

private fun JsonElement?.isBoolean() = this is JsonPrimitive && !isString && (content == "true" || content == "false")

/** Last writer wins and updatedAt is untouched, so favouriting never conflicts with someone editing the recipe. */
internal fun CommandContext.recipeFavorite() {
    val index = recipeIndex(this["id"])
    val favorite = this["favorite"]
    if (!favorite.isBoolean()) throw DomainError("Choose whether to favorite this recipe.")
    state.recipes[index] = state.recipes[index].copy(favorite = (favorite as JsonPrimitive).content == "true")
}

/** Like favourites: last writer wins and updatedAt is untouched. */
internal fun CommandContext.recipeRate() {
    val index = recipeIndex(this["id"])
    val rating = jsNumber(this["rating"])
    if (!jsIsFinite(rating) || floor(rating) != rating || rating < 0 || rating > 5) throw DomainError("Choose a rating from 0 to 5 stars.")
    state.recipes[index] = state.recipes[index].copy(rating = rating.toInt())
}

/** A batch from another app (Paprika). Re-importing is safe: ids are stable, and existing recipes are skipped unless replace is chosen. */
internal fun CommandContext.recipesImport() {
    val inputs = this["recipes"] as? JsonArray
    if (inputs == null || inputs.isEmpty() || inputs.size > 25) throw DomainError("Import between 1 and 25 recipes at a time.")
    val replace = this["mode"].jsEquals("replace")
    for (input in inputs) {
        // `input?.id`: only an object can carry an id, so anything else stops here.
        val fields = input as? JsonObject
        val id = clean(fields?.get("id"), 100)
        if (id.isEmpty() || fields == null) throw DomainError("Each imported recipe needs an id.")
        val recipe = normalizeRecipe(JsonObject(fields + ("id" to JsonPrimitive(id))), true, at, newIngredientId)
        val complete = recipe.title.isNotEmpty() && recipe.ingredients.isNotEmpty() && recipe.ingredients.all { it.name.isNotEmpty() } && recipe.steps.isNotEmpty()
        val index = state.recipes.indexOfFirst { it.id == id }
        if (index >= 0) {
            val old = state.recipes[index]
            if (replace && complete) state.recipes[index] = recipe.copy(createdAt = old.createdAt, updatedAt = later(old.updatedAt, at))
            continue
        }
        if (!complete) {
            val draftId = "draft-" + id.take(90)
            if (state.drafts.none { it.id == draftId }) {
                state.drafts.add(ImportDraft(id = draftId, recipe = recipe, text = "", warnings = listOf("Imported without ingredients or steps. Add them, then save it to your library."), createdAt = at))
            }
            continue
        }
        if (state.recipes.size >= RECIPE_LIMIT) throw DomainError(TOO_MANY_RECIPES)
        state.recipes.add(recipe)
    }
}

internal fun CommandContext.recipeUpdate() {
    val index = recipeIndex(this["recipeId"])
    val existing = state.recipes[index]
    val expected = this["expectedUpdatedAt"]
    if (!(expected is JsonPrimitive && expected.isString) || expected.content.isEmpty() || existing.updatedAt != expected.content) {
        throw DomainError(RECIPE_CHANGED, 409)
    }
    val changesInput = this["changes"]
    recipeChangesIssue(changesInput)?.let { throw DomainError("Invalid recipe changes: $it") }
    val changes = changesInput as JsonObject
    val merged = LinkedHashMap(CookbookJson.encodeToJsonElement(Recipe.serializer(), existing).jsonObject)
    merged.putAll(changes)
    // Changing only the list keeps its first entry as the primary photo or category.
    if ("images" in changes && "image" !in changes) merged["image"] = (changes["images"] as JsonArray).firstOrNull() ?: JsonPrimitive("")
    if ("categories" in changes && "category" !in changes) merged["category"] = (changes["categories"] as JsonArray).firstOrNull() ?: JsonPrimitive(existing.category)
    state.recipes[index] = normalizeRecipe(JsonObject(merged), false, later(existing.updatedAt, at), newIngredientId)
}

internal fun CommandContext.recipeSave() {
    // Kotlin's normalizeRecipe keeps unknown keys; the conflict and form fields of the payload are not recipe data.
    val input = payload.filterKeys { it != "expectedUpdatedAt" && it != "__expected" }
    var r = normalizeRecipe(JsonObject(input + ("id" to JsonPrimitive(clean(this["id"], 100).ifEmpty { nextId() }))), false, at, newIngredientId)
    val old = state.recipes.indexOfFirst { it.id == r.id }
    if (old >= 0) r = r.copy(updatedAt = later(state.recipes[old].updatedAt, r.updatedAt))
    val expected = this["expectedUpdatedAt"]
    if (old >= 0 && jsTruthy(expected) && !expected.jsEquals(state.recipes[old].updatedAt)) throw DomainError(RECIPE_CHANGED, 409)
    if (old < 0) {
        if (state.recipes.size >= RECIPE_LIMIT) throw DomainError(TOO_MANY_RECIPES)
        state.recipes.add(r)
    } else {
        state.recipes[old] = r
    }
    val savedId = r.id
    state.drafts.removeAll { it.recipe.id == savedId }
}

internal fun CommandContext.recipeDelete() {
    val id = recipeById(this["id"]).id
    if (state.plan.any { it.recipeId == id && !it.done } || state.batches.any { it.recipeId == id && it.remaining > 0 }) {
        throw DomainError("Remove upcoming meals and use or discard this recipe’s leftovers first.")
    }
    state.recipes.removeAll { it.id == id }
    // Links and menus no longer point at the removed recipe.
    state.recipes = state.recipes.map { r -> if (id in r.related) r.copy(related = r.related.filter { it != id }) else r }.toMutableList()
    state.menus = state.menus
        .map { m -> if (m.items.any { it.recipeId == id }) m.copy(items = m.items.filter { it.recipeId != id }) else m }
        .filter { it.items.isNotEmpty() }
        .toMutableList()
}
