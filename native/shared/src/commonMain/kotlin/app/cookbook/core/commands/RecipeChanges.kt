package app.cookbook.core.commands

import app.cookbook.core.json.jsNumberString
import app.cookbook.core.json.jsTrim
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.floor

// recipeChangesSchema from supabase/functions/_shared/recipe-schema.ts (zod 4), as explicit checks that report
// zod's first issue with zod's wording. zod reports, in order: a wrong type; for an array longer than its maximum,
// only that (its items are not read); then the items or the object's fields in schema order; then the size and
// range checks in the order they are declared; and an object's unknown keys after its fields.

private const val MAX_SAFE_INTEGER = 9007199254740991.0

private sealed interface Rule {
    /** The first issue with `v` (`null` stands for `undefined`), or null when it passes. */
    fun issue(v: JsonElement?): String?
}

private fun received(v: JsonElement?): String = when (v) {
    null -> "undefined"
    is JsonNull -> "null"
    is JsonArray -> "array"
    is JsonObject -> "object"
    is JsonPrimitive -> when {
        v.isString -> "string"
        v.content == "true" || v.content == "false" -> "boolean"
        else -> v.content.toDouble().let { if (it.isInfinite()) (if (it > 0) "Infinity" else "-Infinity") else "number" }
    }
}

private fun expected(type: String, v: JsonElement?) = "Invalid input: expected $type, received ${received(v)}"

private fun JsonElement?.stringValue(): String? = if (this is JsonPrimitive && this !is JsonNull && isString) content else null

private fun JsonElement?.numberValue(): Double? {
    if (this !is JsonPrimitive || this is JsonNull || isString || content == "true" || content == "false") return null
    return content.toDouble().takeIf { !it.isInfinite() && !it.isNaN() }
}

private class Str(val max: Int, val trim: Boolean = false, val min: Int? = null) : Rule {
    override fun issue(v: JsonElement?): String? {
        val raw = v.stringValue() ?: return expected("string", v)
        val s = if (trim) jsTrim(raw) else raw
        if (min != null && s.length < min) return "Too small: expected string to have >=$min characters"
        if (s.length > max) return "Too big: expected string to have <=$max characters"
        return null
    }
}

private class Num(val min: Double, val max: Double, val int: Boolean = false) : Rule {
    override fun issue(v: JsonElement?): String? {
        val n = v.numberValue() ?: return expected("number", v)
        if (int) {
            if (floor(n) != n) return expected("int", v)
            if (n > MAX_SAFE_INTEGER) return "Too big: expected int to be <=${jsNumberString(MAX_SAFE_INTEGER)}"
            if (n < -MAX_SAFE_INTEGER) return "Too small: expected int to be >=${jsNumberString(-MAX_SAFE_INTEGER)}"
        }
        if (n < min) return "Too small: expected number to be >=${jsNumberString(min)}"
        if (n > max) return "Too big: expected number to be <=${jsNumberString(max)}"
        return null
    }
}

private object Bool : Rule {
    override fun issue(v: JsonElement?): String? =
        if (v is JsonPrimitive && v !is JsonNull && !v.isString && (v.content == "true" || v.content == "false")) null else expected("boolean", v)
}

private class Arr(val item: Rule, val max: Int, val min: Int? = null) : Rule {
    override fun issue(v: JsonElement?): String? {
        if (v !is JsonArray) return expected("array", v)
        if (v.size > max) return "Too big: expected array to have <=$max items"
        for (x in v) item.issue(x)?.let { return it }
        if (min != null && v.size < min) return "Too small: expected array to have >=$min items"
        return null
    }
}

private class Nullable(val inner: Rule) : Rule {
    override fun issue(v: JsonElement?): String? = if (v is JsonNull) null else inner.issue(v)
}

/** JavaScript's own-key order: array-index keys ascending, then the rest in insertion order. */
private fun jsKeyOrder(keys: Collection<String>): List<String> {
    fun index(k: String): Long? = if (k == "0" || (k.isNotEmpty() && k[0] in '1'..'9' && k.all { it in '0'..'9' } && k.length <= 10)) k.toLong().takeIf { it < 4294967295L } else null
    val (indexed, named) = keys.partition { index(it) != null }
    return indexed.sortedBy { index(it) } + named
}

/** A strict object; with `partial`, every field is optional. */
private class Obj(val shape: List<Pair<String, Rule>>, val optional: Set<String>) : Rule {
    override fun issue(v: JsonElement?): String? {
        if (v !is JsonObject) return expected("object", v)
        for ((key, rule) in shape) {
            if (key !in v && key in optional) continue
            rule.issue(v[key])?.let { return it }
        }
        val known = shape.map { it.first }.toSet()
        val unknown = jsKeyOrder(v.keys.filter { it !in known })
        if (unknown.isNotEmpty()) {
            return (if (unknown.size == 1) "Unrecognized key: " else "Unrecognized keys: ") + unknown.joinToString(", ") { "\"$it\"" }
        }
        return null
    }
}

private const val NUMBER_LIMIT = 1000000.0

private val ingredientRule = Obj(
    listOf(
        "id" to Str(100, trim = true, min = 1),
        "name" to Str(200, trim = true, min = 1),
        "amount" to Nullable(Num(0.0, NUMBER_LIMIT)),
        "unit" to Str(40),
        "group" to Str(120),
        "note" to Str(500),
        "raw" to Str(1000),
    ),
    optional = setOf("id", "group", "note", "raw"),
)

private val nutritionShape = listOf("calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium").map { it to Num(0.0, NUMBER_LIMIT) } +
    listOf("servingSize" to Str(80), "text" to Str(1000), "estimated" to Bool)

private val recipeFields: List<Pair<String, Rule>> = listOf(
    "title" to Str(200, trim = true, min = 1),
    "description" to Str(3000),
    "servings" to Num(0.000001, NUMBER_LIMIT),
    "prepMinutes" to Num(0.0, NUMBER_LIMIT),
    "cookMinutes" to Num(0.0, NUMBER_LIMIT),
    "category" to Str(80, trim = true, min = 1),
    "tags" to Arr(Str(60, trim = true, min = 1), max = 30),
    "favorite" to Bool,
    "wantToTry" to Bool,
    "image" to Str(2000),
    "sourceUrl" to Str(2000),
    "author" to Str(200),
    "ingredients" to Arr(ingredientRule, max = 200, min = 1),
    "steps" to Arr(Str(5000, trim = true, min = 1), max = 100, min = 1),
    "notes" to Str(10000),
    "rating" to Num(0.0, 5.0, int = true),
    "categories" to Arr(Str(80, trim = true, min = 1), max = 10),
    "images" to Arr(Str(2000), max = 12),
    "related" to Arr(Str(100, trim = true, min = 1), max = 30),
    "nutrition" to Nullable(Obj(nutritionShape, optional = nutritionShape.map { it.first }.toSet())),
)

private val recipeChanges = Obj(recipeFields, optional = recipeFields.map { it.first }.toSet())

/**
 * The message of zod's first issue when `changes` fails recipeChangesSchema (strict, partial, at least one field),
 * or null when it passes.
 */
internal fun recipeChangesIssue(changes: JsonElement?): String? {
    recipeChanges.issue(changes)?.let { return it }
    return if ((changes as JsonObject).isEmpty()) "Include at least one field to edit." else null
}
