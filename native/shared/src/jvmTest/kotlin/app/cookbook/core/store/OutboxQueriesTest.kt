package app.cookbook.core.store

import app.cookbook.core.domain.State
import app.cookbook.core.domain.initialState
import app.cookbook.core.json.CookbookJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class OutboxQueriesTest {
    private fun store() = SqlLocalStore(DriverFactory().create())
    private fun item(id: String, at: Long) = OutboxItem(id, "recipe.save", buildJsonObject { put("n", id) }, at)

    @Test fun replaceOutboxKeepsOrder() {
        val s = store()
        val items = listOf(item("c", 3), item("a", 1), item("b", 2))
        s.replaceOutbox("u1", items)
        assertEquals(items, s.outbox("u1"))
        s.replaceOutbox("u1", listOf(item("z", 9)))
        assertEquals(listOf(item("z", 9)), s.outbox("u1"))
    }

    @Test fun accountsAreIsolated() {
        val s = store()
        s.replaceOutbox("u1", listOf(item("a", 1)))
        s.replaceOutbox("u2", listOf(item("b", 2)))
        assertEquals(listOf("a"), s.outbox("u1").map { it.id })
        assertEquals(listOf("b"), s.outbox("u2").map { it.id })
    }

    @Test fun clearAccountRemovesOnlyThatAccount() {
        val s = store()
        for (a in listOf("u1", "u2")) {
            s.writeSnapshot(a, Snapshot("h", 4, initialState()))
            s.replaceOutbox(a, listOf(item("o-$a", 1)))
            s.replaceProblems(a, listOf(Problem(item("p-$a", 2), "bad", 409)))
            s.addPendingUpload(a, PendingUpload("up-$a", "/p.jpg", null))
        }
        s.clearAccount("u1")
        assertNull(s.readSnapshot("u1"))
        assertEquals(emptyList(), s.outbox("u1"))
        assertEquals(emptyList(), s.problems("u1"))
        assertEquals(emptyList(), s.pendingUploads("u1"))
        assertNotNull(s.readSnapshot("u2"))
        assertEquals(1, s.outbox("u2").size)
        assertEquals(Problem(item("p-u2", 2), "bad", 409), s.problems("u2").single())
        assertEquals(PendingUpload("up-u2", "/p.jpg", null), s.pendingUploads("u2").single())
        s.removePendingUpload("up-u2")
        assertEquals(emptyList(), s.pendingUploads("u2"))
    }

    @Test fun snapshotKeepsUnknownRecipeFields() {
        val s = store()
        val base = CookbookJson.encodeToJsonElement(State.serializer(), initialState()) as JsonObject
        val recipe = buildJsonObject {
            put("id", "r1"); put("title", "T"); put("description", ""); put("servings", 2); put("prepMinutes", 0)
            put("cookMinutes", 0); put("category", ""); putJsonArray("tags") {}; put("favorite", false)
            put("wantToTry", false); put("image", ""); put("sourceUrl", ""); put("author", "")
            putJsonArray("ingredients") {}; putJsonArray("steps") {}; put("notes", "")
            put("createdAt", ""); put("updatedAt", ""); put("futureField", JsonPrimitive("keep me"))
        }
        val json = JsonObject(base + ("recipes" to kotlinx.serialization.json.JsonArray(listOf(recipe))))
        val state = CookbookJson.decodeFromJsonElement(State.serializer(), json)
        s.writeSnapshot("u1", Snapshot("h", 7, state))
        val back = s.readSnapshot("u1")!!
        assertEquals(7, back.revision)
        assertEquals(JsonPrimitive("keep me"), back.state.recipes.single().extra["futureField"])
    }

    @Test fun sameIdUnderTwoAccountsIsKept() {
        val s = store()
        s.replaceOutbox("u1", listOf(item("x", 1)))
        s.replaceOutbox("u2", listOf(item("x", 2)))
        s.replaceProblems("u1", listOf(Problem(item("x", 1), "a", 400)))
        s.replaceProblems("u2", listOf(Problem(item("x", 2), "b", 409)))
        s.addPendingUpload("u1", PendingUpload("x", "/1", null))
        s.addPendingUpload("u2", PendingUpload("x", "/2", "/t"))
        assertEquals(listOf(item("x", 1)), s.outbox("u1"))
        assertEquals(listOf(item("x", 2)), s.outbox("u2"))
        assertEquals("a", s.problems("u1").single().message)
        assertEquals("b", s.problems("u2").single().message)
        assertEquals("/1", s.pendingUploads("u1").single().photoPath)
        assertEquals("/2", s.pendingUploads("u2").single().photoPath)
    }

    @Test fun duplicateIdInOneReplaceThrowsAndKeepsPreviousOutbox() {
        val s = store()
        val before = listOf(item("keep", 1))
        s.replaceOutbox("u1", before)
        assertFailsWith<Exception> { s.replaceOutbox("u1", listOf(item("d", 1), item("d", 2))) }
        assertEquals(before, s.outbox("u1"))
    }

    @Test fun reopeningAFileStoreKeepsTheOutbox() {
        val file = java.io.File.createTempFile("cookbook", ".db")
        try {
            val url = "jdbc:sqlite:${file.absolutePath}"
            val d1 = DriverFactory(url).create()
            val s1 = SqlLocalStore(d1)
            val snap = Snapshot("h", 3, initialState())
            val items = listOf(item("a", 1), item("b", 2))
            s1.writeSnapshot("u1", snap)
            s1.replaceOutbox("u1", items)
            d1.close()
            val d2 = DriverFactory(url).create()
            val s2 = SqlLocalStore(d2)
            assertEquals(items, s2.outbox("u1"))
            assertEquals(snap, s2.readSnapshot("u1"))
            d2.close()
        } finally { file.delete() }
    }
}
