package app.cookbook.core.domain

import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.sameAs
import app.cookbook.core.readResource
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Golden vectors for the helper functions, written by `npm run vectors:export` from domain.ts. */
class HelpersVectorTest {
    private val helpers: JsonObject by lazy { Json.parseToJsonElement(readResource("vectors/helpers.json")).jsonObject }

    private fun cases(section: String): List<JsonArray> = helpers.getValue(section).jsonArray.map { it.jsonArray }.also { assertTrue(it.isNotEmpty()) }

    private fun number(d: Double?): JsonElement = if (d == null) JsonNull else JsonPrimitive(d)

    private fun check(where: String, actual: JsonElement, expected: JsonElement) {
        assertTrue(actual.sameAs(expected), "$where: expected $expected but got $actual")
    }

    @Test fun fractionVectors() {
        for (c in cases("fraction")) check("fraction(${c[0]})", number(fraction(c[0])), c[1])
    }

    @Test fun httpUrlVectors() {
        for (c in cases("httpUrl")) {
            val expected = c[1]
            val actual: JsonElement = try { JsonPrimitive(httpUrl(c[0])) } catch (e: DomainError) { buildJsonObject { put("error", JsonPrimitive(e.message)) } }
            check("httpUrl(${c[0]})", actual, expected)
        }
    }

    @Test fun parseIngredientVectors() {
        for (c in cases("parseIngredient")) {
            val line = parseIngredient(c[0].jsonPrimitive.content, "id")
            val actual = buildJsonObject {
                put("amount", number(line.amount)); put("unit", JsonPrimitive(line.unit)); put("name", JsonPrimitive(line.name)); put("note", JsonPrimitive(line.note))
            }
            check("parseIngredient(${c[0]})", actual, c[1])
            assertEquals(clean(c[0].jsonPrimitive.content, 1000), line.raw)
        }
    }

    @Test fun convertVectors() {
        for (c in cases("convert")) {
            val actual = convert(c[0].jsonPrimitive.content.toDouble(), c[1].jsonPrimitive.content, c[2].jsonPrimitive.content)
            check("convert(${c[0]}, ${c[1]}, ${c[2]})", number(actual), c[3])
        }
    }

    @Test fun formatAmountVectors() {
        for (c in cases("formatAmount")) {
            val n = if (c[0] is JsonNull) null else c[0].jsonPrimitive.content.toDouble()
            assertEquals(c[2].jsonPrimitive.content, formatAmount(n, c[1].jsonPrimitive.content), "formatAmount(${c[0]}, ${c[1]})")
        }
    }

    @Test fun normalizeRecipeVectors() {
        var errors = 0
        for (c in cases("normalizeRecipe")) {
            val input = c[0].jsonObject
            val now = c[1].jsonPrimitive.content
            val incomplete = c.getOrNull(3)?.jsonPrimitive?.content == "true"
            val expected = c[2].jsonObject
            val where = "normalizeRecipe(${input["title"]}, ${input["id"]})"
            val message = expected["error"]?.jsonPrimitive?.content
            val newId: () -> String = { error("$where should not need a generated id") }
            if (message != null) {
                errors++
                val thrown = runCatching { normalizeRecipe(input, incomplete, now, newId) }.exceptionOrNull()
                assertTrue(thrown is DomainError, "$where should fail with $message but gave $thrown")
                assertEquals(message, thrown.message, where)
                assertEquals(400, thrown.status)
            } else {
                val recipe = normalizeRecipe(input, incomplete, now, newId)
                val actual = CookbookJson.parseToJsonElement(CookbookJson.encodeToString(recipe.withoutExtras()))
                check(where, actual, expected)
                // Unknown input keys travel in `extra`.
                for (key in input.keys.filter { it !in recipeKeys }) assertTrue(key in recipe.extra, "$where lost $key")
            }
        }
        assertTrue(errors > 5)
    }

    @Test fun missingIdsComeFromTheGenerator() {
        var n = 0
        val input = Json.parseToJsonElement("""{"title":"T","ingredients":[{"name":"a"},{"name":"b","id":"keep"}],"steps":["s"]}""").jsonObject
        val recipe = normalizeRecipe(input, false, "now") { "gen-${++n}" }
        assertEquals("gen-1", recipe.id)
        assertEquals(listOf("gen-2", "keep"), recipe.ingredients.map { it.id })
        assertEquals("now", recipe.createdAt)
        assertEquals("now", recipe.updatedAt)
    }

    @Test fun blankRecipeMatchesTheDefaults() {
        val r = blankRecipe("id", "now")
        assertEquals(listOf("Entrées"), r.categories)
        assertEquals(2.0, r.servings)
        assertTrue(r.wantToTry)
        assertEquals("now", r.updatedAt)
    }

    @Test fun datesMatchTheCalendar() {
        assertEquals("2026-11-27", weekEnd("2026-11-21"))
        assertEquals("2024-03-01", shiftDate("2024-02-28", 2))
        assertEquals("2023-03-01", shiftDate("2023-02-28", 1))
        assertEquals("2025-12-31", shiftDate("2026-01-01", -1))
        assertEquals("2024-02-29", validDate(JsonPrimitive(" 2024-02-29 ")))
        for (bad in listOf("2023-02-29", "2024-13-01", "2024-1-1", "2024-02-30", "", "2024-00-10", "20240229")) {
            val e = runCatching { validDate(JsonPrimitive(bad)) }.exceptionOrNull()
            assertTrue(e is DomainError && e.message == "Choose a valid date.", bad)
        }
        assertEquals("Choose a valid date.", runCatching { validDate(null) }.exceptionOrNull()?.message)
    }

    private val recipeKeys = setOf(
        "id", "title", "description", "servings", "prepMinutes", "cookMinutes", "category", "tags", "favorite", "wantToTry", "image",
        "sourceUrl", "author", "ingredients", "steps", "notes", "createdAt", "updatedAt", "rating", "categories", "images", "related", "nutrition",
    )
}
