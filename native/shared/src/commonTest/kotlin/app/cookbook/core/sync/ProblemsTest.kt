package app.cookbook.core.sync

import app.cookbook.core.domain.PantryItem
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.jsonParse
import app.cookbook.core.store.OutboxItem
import app.cookbook.core.store.Problem
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ProblemsTest {
    private fun problem(type: String, payload: JsonElement) = Problem(OutboxItem("op-12345678", type, payload, 0), "Changed elsewhere", 409)
    private val state = seedWith(
        Triple("recipe.save", sample(), "seed-rice-1"),
        Triple("pantry.save", pantry("stock", "rice", 1000, "g"), "seed-stock-1"),
    )
    private val stockJson = CookbookJson.encodeToJsonElement(PantryItem.serializer(), state.pantry[0])

    @Test fun keepMineMovesARecipeEditToTheLatestVersion() {
        val kept = keepMine(problem("recipe.update", buildJsonObject {
            put("recipeId", "rice"); put("expectedUpdatedAt", "old"); putJsonObject("changes") { put("notes", "Mine") }
        }), state).jsonObject
        assertEquals(state.recipes[0].updatedAt, kept["expectedUpdatedAt"]?.jsonPrimitive?.content)
        assertEquals("Mine", kept["changes"]!!.jsonObject["notes"]!!.jsonPrimitive.content)
        val gone = keepMine(problem("recipe.update", buildJsonObject { put("recipeId", "missing"); put("expectedUpdatedAt", "old") }), state).jsonObject
        assertFalse("expectedUpdatedAt" in gone, "an undefined value is dropped, as JSON.stringify does")
    }

    @Test fun keepMineRefreshesFormAndCookChecks() {
        val form = keepMine(problem("pantry.save", JsonObject(stockJson.jsonObject + ("__expected" to JsonPrimitive("{}")))), state).jsonObject
        assertEquals(stockJson, jsonParse(form["__expected"]!!.jsonPrimitive.content))
        val cook = keepMine(problem("cook", buildJsonObject {
            put("recipeId", "rice")
            putJsonArray("usage") {
                add(buildJsonObject { put("pantryId", "stock"); put("expected", "{}") })
                add(buildJsonObject { put("pantryId", "missing"); put("expected", "{}") })
            }
        }), state).jsonObject
        val usage = cook["usage"] as kotlinx.serialization.json.JsonArray
        assertEquals(stockJson, jsonParse(usage[0].jsonObject["expected"]!!.jsonPrimitive.content))
        assertEquals("{}", usage[1].jsonObject["expected"]!!.jsonPrimitive.content)
        val plain = buildJsonObject { put("id", "x") }
        assertEquals(plain, keepMine(problem("plan.save", plain), state), "no form check, nothing to move")
        val removed = keepMine(problem("plan.save", buildJsonObject { put("id", "x"); put("__expected", "{}") }), state).jsonObject
        assertFalse("__expected" in removed, "a record that no longer exists drops the check")
    }

    @Test fun copyOfMineMakesANewRecipeFromAnEdit() {
        val copy = copyOfMine(problem("recipe.update", buildJsonObject {
            put("recipeId", "rice"); put("expectedUpdatedAt", "old"); putJsonObject("changes") { put("notes", "Mine") }
        }), state, "new-id")
        assertNotNull(copy)
        assertEquals("new-id", copy["id"]!!.jsonPrimitive.content)
        assertEquals("[Sample] Rice (my version)", copy["title"]!!.jsonPrimitive.content)
        assertEquals("Mine", copy["notes"]!!.jsonPrimitive.content)
        for (key in listOf("expectedUpdatedAt", "createdAt", "updatedAt")) assertFalse(key in copy, key)
        val long = copyOfMine(problem("recipe.save", buildJsonObject { put("id", "r"); put("title", "x".repeat(200)) }), state, "n")!!
        assertEquals("x".repeat(180) + " (my version)", long["title"]!!.jsonPrimitive.content)
        assertNull(copyOfMine(problem("pantry.save", stockJson), state, "n"))
        assertNull(copyOfMine(problem("recipe.save", buildJsonObject { put("id", "r"); put("title", "") }), state, "n"))
    }

    @Test fun describeProblemNamesTheChange() {
        assertEquals("Recipe edit", describeProblem(problem("recipe.update", JsonObject(emptyMap()))))
        assertEquals("Checkmark", describeProblem(problem("shopping.toggle", JsonObject(emptyMap()))))
        assertEquals("Change", describeProblem(problem("menu.save", JsonObject(emptyMap()))))
    }
}
