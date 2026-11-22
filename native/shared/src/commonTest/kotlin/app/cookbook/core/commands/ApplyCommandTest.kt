package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.PantryItem
import app.cookbook.core.domain.initialState
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

class ApplyCommandTest {
    private val clock = "2026-11-21T10:00:00.000Z"

    private fun fails(message: String, status: Int = 400, block: () -> Unit) {
        val e = assertFailsWith<DomainError> { block() }
        assertEquals(message, e.message)
        assertEquals(status, e.status)
    }

    private fun recipe(id: String): JsonObject = buildJsonObject {
        put("id", id); put("title", "Recipe $id")
        putJsonArray("ingredients") { add(buildJsonObject { put("id", "$id-i1"); put("name", "rice"); put("amount", 1) }) }
        putJsonArray("steps") { add(JsonPrimitive("Cook.")) }
    }

    @Test fun nonObjectPayloadIsRefused() {
        fails("Action details are required.") { applyCommand(initialState(), "recipe.save", JsonPrimitive("x"), "op-00000001") }
        fails("Action details are required.") { applyCommand(initialState(), "recipe.save", null, "op-00000001") }
        fails("Action details are required.") { applyCommand(initialState(), "recipe.save", JsonNull, "op-00000001") }
        fails("Action details are required.") { applyCommand(initialState(), "menu.delete", JsonPrimitive(0), "op-00000001") }
    }

    @Test fun arrayPayloadActsLikeAnObjectAsInJavaScript() {
        // typeof [] === 'object', so TypeScript runs the command with the array's index keys.
        fails("Add a title, at least one named ingredient, and instructions before saving.") {
            applyCommand(initialState(), "recipe.save", buildJsonArray { add(JsonPrimitive("a")) }, "op-1", clock)
        }
        val after = applyCommand(initialState(), "menu.delete", JsonArray(emptyList()), "op-1", clock)
        assertEquals(listOf("op-1"), after.operations)
        fails("Unknown action.") { applyCommand(initialState(), "nope", JsonArray(emptyList()), "op-1", clock) }
    }

    @Test fun repeatedOperationReturnsTheSameState() {
        val once = applyCommand(initialState(), "recipe.save", recipe("r1"), "op-1", clock)
        assertSame(once, applyCommand(once, "recipe.save", recipe("r1"), "op-1", clock))
    }

    @Test fun unknownActionIsRefused() {
        fails("Unknown action.") { applyCommand(initialState(), "nonsense.command", JsonObject(emptyMap()), "op-1", clock) }
        // Server-only commands are not part of the apps' core.
        fails("Unknown action.") { applyCommand(initialState(), "reminders.ack", JsonObject(emptyMap()), "op-1", clock) }
        fails("Unknown action.") { applyCommand(initialState(), "reminders.sync", JsonObject(emptyMap()), "op-1", clock) }
    }

    @Test fun draftRecipeMustBeAnObjectOrArray() {
        for (bad in listOf<JsonElement?>(JsonPrimitive("Soup"), JsonPrimitive(0), JsonPrimitive(true), JsonPrimitive(""), JsonNull, null)) {
            val payload = buildJsonObject { put("id", "d1"); if (bad != null) put("recipe", bad) }
            fails("Recipe details are required.") { applyCommand(initialState(), "draft.save", payload, "op-1", clock) }
        }
        // An array is spread into an object, as JavaScript does: a blank draft with generated ids.
        val after = applyCommand(initialState(), "draft.save", buildJsonObject { putJsonArray("recipe") { add(JsonPrimitive("x")) } }, "op-1", clock)
        assertEquals("op-1-2", after.drafts.single().id)
        assertEquals("op-1-1", after.drafts.single().recipe.id)
        assertEquals("", after.drafts.single().recipe.title)
    }

    @Test fun importedRecipeMustBeAnObjectWithAnId() {
        for (bad in listOf<JsonElement>(buildJsonArray { add(JsonPrimitive("a")) }, JsonPrimitive("abc"), JsonNull)) {
            val payload = buildJsonObject { putJsonArray("recipes") { add(bad) } }
            fails("Each imported recipe needs an id.") { applyCommand(initialState(), "recipes.import", payload, "op-1", clock) }
        }
    }

    @Test fun recipeUpdateChangesMustBeAnObject() {
        val state = applyCommand(initialState(), "recipe.save", recipe("r1"), "op-1", clock)
        for ((changes, received) in listOf(JsonArray(emptyList()) to "array", JsonPrimitive("x") to "string", JsonNull to "null")) {
            val payload = buildJsonObject { put("recipeId", "r1"); put("expectedUpdatedAt", clock); put("changes", changes) }
            fails("Invalid recipe changes: Invalid input: expected object, received $received") { applyCommand(state, "recipe.update", payload, "op-2", clock) }
        }
    }

    @Test fun idsDeriveFromTheOperationIdInBase36() {
        var state = applyCommand(initialState(), "recipe.save", recipe("r1"), "op-1", clock)
        val menu = buildJsonObject {
            put("id", "m1"); put("name", "Many")
            putJsonArray("items") { repeat(11) { add(buildJsonObject { put("recipeId", "r1"); put("day", 1) }) } }
        }
        state = applyCommand(state, "menu.save", menu, "op-2", clock)
        val longOp = "x".repeat(100)
        state = applyCommand(state, "menu.plan", buildJsonObject { put("menuId", "m1"); put("date", "2026-11-02") }, longOp, clock)
        val prefix = "x".repeat(90)
        assertEquals((1..11).map { "$prefix-${it.toString(36)}" }, state.plan.map { it.id })
        assertEquals("$prefix-b", state.plan.last().id)
        assertEquals(longOp, state.operations.last())
    }

    @Test fun missingClockUsesTheCurrentTime() {
        val state = applyCommand(initialState(), "recipe.save", recipe("r1"), "op-1")
        val stamp = state.recipes.single().updatedAt
        assertTrue(Regex("""\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z""").matches(stamp), stamp)
        assertTrue(stamp.startsWith("20"), stamp)
    }

    @Test fun laterMovesPastThePreviousTime() {
        assertEquals("2026-01-01T00:00:00.001Z", later("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"))
        assertEquals("2026-01-01T00:00:00.001Z", later("2026-01-01T00:00:00.000Z", "2025-12-31T23:59:59.999Z"))
        assertEquals("2026-01-01T00:00:01.000Z", later("2026-01-01T00:00:00.999Z", "2026-01-01T00:00:00.500Z"))
        assertEquals("2026-01-02T00:00:00.000Z", later("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"))
        assertEquals("2026-01-01T00:00:00.000Z", later(null, "2026-01-01T00:00:00.000Z"))
        assertEquals("2026-01-01T00:00:00.000Z", later("", "2026-01-01T00:00:00.000Z"))
        assertEquals("2026-01-01T00:00:00.000Z", later("not a date", "2026-01-01T00:00:00.000Z"))
        assertEquals("junk", later("2026-01-01T00:00:00.000Z", "junk"))
        // Date-only and offset forms parse as JavaScript's Date.parse does.
        assertEquals("2026-01-01T00:00:00.001Z", later("2026-01-01", "2025-01-01T00:00:00.000Z"))
        assertEquals("2026-01-01T02:00:00.001Z", later("2026-01-01T03:00:00.000+01:00", "2025-01-01T00:00:00.000Z"))
        assertEquals("+275760-09-13T00:00:00.000Z", later("+275760-09-12T23:59:59.999Z", "2025-01-01T00:00:00.000Z"))
    }

    @Test fun sameRecordIgnoresKeyOrder() {
        val item = PantryItem(id = "p1", name = "rice", amount = 2.0, unit = "g", location = "Pantry", note = "")
        assertTrue(sameRecord(item, """{"note":"","location":"Pantry","unit":"g","amount":2,"name":"rice","id":"p1"}"""))
        assertFalse(sameRecord(item, """{"id":"p1"}"""))
        assertFalse(sameRecord(item, "not json"))
        assertFalse(sameRecord(null, "null"))
        assertTrue(sameRecord(buildJsonObject { putJsonObject("a") { put("b", 1.0) } }, """{"a":{"b":1}}"""))
    }
}
