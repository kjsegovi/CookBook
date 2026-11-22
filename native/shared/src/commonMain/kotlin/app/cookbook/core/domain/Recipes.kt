package app.cookbook.core.domain

import app.cookbook.core.json.jsIsFinite
import app.cookbook.core.json.jsNumber
import app.cookbook.core.json.jsTruthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Port of normalizeRecipe, normalizeNutrition and blankRecipe from domain.ts.

val NUTRIENTS = listOf("calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium")

/** The keys of a recipe. Anything else in the input travels in `Recipe.extra`. */
private val RECIPE_KEYS = setOf(
    "id", "title", "description", "servings", "prepMinutes", "cookMinutes", "category", "tags", "favorite", "wantToTry", "image",
    "sourceUrl", "author", "ingredients", "steps", "notes", "createdAt", "updatedAt", "rating", "categories", "images", "related", "nutrition",
)

private val photoImage = Regex("photo:[0-9a-f-]{36}/[0-9a-f-]{36}\\.(jpg|png|webp)")

private fun validImage(value: JsonElement?): String {
    val v = clean(value, 2000)
    return if (photoImage.matches(v)) v else httpUrl(JsonPrimitive(v))
}

/** `obj[key]`: a missing key reads as `undefined` (null here), and a non-object has no keys. */
private fun JsonElement?.field(key: String): JsonElement? = (this as? JsonObject)?.get(key)

private fun JsonElement?.isNullish() = this == null || this is JsonNull

private fun JsonElement?.orElse(default: JsonElement): JsonElement = if (isNullish()) default else this!!

private fun JsonElement?.items(): List<JsonElement> = (this as? JsonArray) ?: emptyList()

/**
 * The first entry is primary. When only the single field was changed (older clients, or editing just the main photo),
 * it becomes the first entry.
 */
private fun primaryFirst(list: JsonElement?, single: JsonElement?, normalize: (JsonElement?) -> String, max: Int): List<String> {
    var items = list.items().map(normalize).filter { it.isNotEmpty() }
    if (single is JsonPrimitive && single.isString) {
        val first = normalize(single)
        if (first != (items.firstOrNull() ?: "")) items = if (first.isNotEmpty()) listOf(first) + items.filter { it != first } else items.drop(1)
    }
    return items.distinct().take(max)
}

/** Per-serving nutrition from loose input. Out-of-range or non-numeric values are dropped. */
fun normalizeNutrition(v: JsonElement?): Nutrition? {
    if (v !is JsonObject) return null
    val values = HashMap<String, Double>()
    for (key in NUTRIENTS) {
        val raw = v[key]
        val n = jsNumber(raw)
        val blank = raw == null || raw is JsonNull || (raw is JsonPrimitive && raw.isString && raw.content.isEmpty())
        if (!blank && jsIsFinite(n) && n >= 0 && n <= 1000000) values[key] = jsRound(n * 10) / 10
    }
    val servingSize = clean(v["servingSize"], 80).ifEmpty { null }
    val text = clean(v["text"], 1000).ifEmpty { null }
    if (values.isEmpty() && servingSize == null && text == null) return null
    return Nutrition(
        calories = values["calories"], protein = values["protein"], carbs = values["carbs"], fat = values["fat"],
        fiber = values["fiber"], sugar = values["sugar"], sodium = values["sodium"],
        servingSize = servingSize, text = text,
        estimated = if (jsTruthy(v["estimated"])) true else null,
    )
}

/**
 * Cleans loose input into a Recipe, throwing [DomainError] for bad numbers, links or an incomplete recipe.
 * `newId` supplies ids for a recipe or ingredient that has none. Unlike the TypeScript, keys the recipe does not
 * declare are kept in `extra`.
 */
fun normalizeRecipe(input: JsonObject, allowIncomplete: Boolean = false, now: String, newId: () -> String = Ids::uuid): Recipe {
    val id = clean(input["id"], 100).ifEmpty { newId() }
    val title = clean(input["title"], 200)
    val description = clean(input["description"], 3000)
    val servings = positive(input["servings"].orElse(JsonPrimitive(2)), "Servings")
    val prepMinutes = positive(input["prepMinutes"].orElse(JsonPrimitive(0)), "Preparation time", true)
    val cookMinutes = positive(input["cookMinutes"].orElse(JsonPrimitive(0)), "Cooking time", true)
    val category = clean(input["category"], 80).ifEmpty { "Entrées" }
    val tags = input["tags"].items().take(30).map { clean(it, 60) }.filter { it.isNotEmpty() }
    val favorite = jsTruthy(input["favorite"])
    val wantToTry = jsTruthy(input["wantToTry"])
    val imageText = clean(input["image"], 2000)
    val image = if (photoImage.matches(imageText)) imageText else httpUrl(input["image"])
    val sourceUrl = httpUrl(input["sourceUrl"])
    val author = clean(input["author"], 200)
    val ingredients = input["ingredients"].items().take(200).map { x ->
        if (x is JsonNull) throw IllegalArgumentException("Cannot read properties of null (reading 'id')")
        val lineId = clean(x.field("id"), 100).ifEmpty { newId() }
        val amountValue = x.field("amount")
        val blankAmount = amountValue == null || amountValue is JsonNull || (amountValue is JsonPrimitive && amountValue.isString && amountValue.content.isEmpty())
        IngredientLine(
            id = lineId,
            name = clean(x.field("name"), 200),
            amount = if (blankAmount) null else positive(amountValue, "Ingredient amount", true),
            unit = clean(x.field("unit"), 40),
            group = clean(x.field("group"), 120),
            note = clean(x.field("note"), 500),
            raw = clean(x.field("raw"), 1000),
        )
    }
    val steps = input["steps"].items().take(100).map { clean(it, 5000) }.filter { it.isNotEmpty() }
    val notes = clean(input["notes"], 10000)
    val createdAt = clean(input["createdAt"], 40).ifEmpty { now }

    // organisation(input)
    val rounded = jsRound(jsNumber(input["rating"]))
    val rating = if (jsIsFinite(rounded)) minOf(5.0, maxOf(0.0, rounded)).toInt() else 0
    var categories = primaryFirst(input["categories"], input["category"], { clean(it, 80) }, 10)
    val images = primaryFirst(input["images"], input["image"], ::validImage, 12)
    val related = input["related"].items().map { clean(it, 100) }.filter { it.isNotEmpty() }.distinct().take(30)
    val nutrition = normalizeNutrition(input["nutrition"])

    if (categories.isEmpty()) categories = listOf(category)
    val recipe = Recipe(
        id = id, title = title, description = description, servings = servings, prepMinutes = prepMinutes, cookMinutes = cookMinutes,
        category = categories[0], tags = tags, favorite = favorite, wantToTry = wantToTry, image = images.firstOrNull() ?: "",
        sourceUrl = sourceUrl, author = author, ingredients = ingredients, steps = steps, notes = notes, createdAt = createdAt, updatedAt = now,
        rating = rating, categories = categories, images = images, related = related.filter { it != id }, nutrition = nutrition,
        extra = JsonObject(input.filterKeys { it !in RECIPE_KEYS }),
    )
    if (!allowIncomplete && (recipe.title.isEmpty() || recipe.ingredients.isEmpty() || recipe.ingredients.any { it.name.isEmpty() } || recipe.steps.isEmpty())) {
        throw DomainError("Add a title, at least one named ingredient, and instructions before saving.")
    }
    return recipe
}

fun blankRecipe(id: String, now: String): Recipe = Recipe(
    id = id, title = "", description = "", servings = 2.0, prepMinutes = 0.0, cookMinutes = 0.0, category = "Entrées", tags = emptyList(),
    favorite = false, wantToTry = true, image = "", sourceUrl = "", author = "", ingredients = emptyList(), steps = emptyList(), notes = "",
    createdAt = now, updatedAt = now, rating = 0, categories = listOf("Entrées"), images = emptyList(), related = emptyList(), nutrition = null,
)
