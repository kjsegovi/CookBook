package app.cookbook.core.sync

import app.cookbook.core.commands.applyCommand
import app.cookbook.core.commands.jsIsoString
import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.PantryItem
import app.cookbook.core.domain.Recipe
import app.cookbook.core.domain.State
import app.cookbook.core.domain.blankRecipe
import app.cookbook.core.domain.initialState
import app.cookbook.core.domain.parseIngredient
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.store.LocalStore
import app.cookbook.core.store.Snapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

const val SEED_TIME = 1_790_000_000_000L

fun sample(extra: Map<String, JsonElement> = emptyMap()): JsonObject {
    val recipe = blankRecipe("rice", jsIsoString(SEED_TIME))
        .copy(title = "[Sample] Rice", ingredients = listOf(parseIngredient("100 g rice", "rice-line")), steps = listOf("Cook."))
    return JsonObject(CookbookJson.encodeToJsonElement(Recipe.serializer(), recipe).jsonObject + extra)
}

fun seedWith(vararg commands: Triple<String, JsonElement, String>): State =
    commands.fold(initialState()) { state, (type, payload, id) -> applyCommand(state, type, payload, id, jsIsoString(SEED_TIME)) }

fun pantry(id: String, name: String, amount: Number, unit: String) = buildJsonObject {
    put("id", id); put("name", name); put("amount", amount); put("unit", unit)
}

/** One server and one saved outbox, like setup() in tests/sync-engine.test.mjs. Engines run in [scope]. */
class Setup(private val scope: CoroutineScope, seed: State? = null, online: Boolean = true, val store: LocalStore = MemoryStore()) {
    val server = FakeServer(seed ?: initialState()).also { it.online = online }
    var time = SEED_TIME + 1_000_000

    fun make(
        sender: CommandSender = server,
        beforeSend: suspend () -> Unit = {},
        initial: Snapshot = store.readSnapshot("user") ?: server.snapshot,
    ) = SyncEngine(
        initial, "user", store, sender, server, { server.online }, scope,
        retryDelayMs = { 60_000L }, now = { time += 5; time }, beforeSend = beforeSend,
    )
}

private fun TestScope.setup(seed: State? = null, online: Boolean = true) = Setup(backgroundScope, seed, online)

class SyncEngineTest {
    private val SyncEngine.state get() = view.value.state
    private val SyncEngine.pending get() = status.value.pending

    @Test fun changesApplyOnTheDeviceAtOnceAndSyncInOrder() = runTest {
        val s = setup()
        val engine = s.make()
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        engine.enqueue("pantry.save", pantry("salt", "salt", 1, "tsp"))
        assertEquals(listOf("rice", "salt"), engine.state.pantry.map { it.id }, "visible before the server answers")
        assertTrue(engine.flush())
        assertEquals(listOf("rice", "salt"), s.server.state.pantry.map { it.id })
        assertEquals(0, engine.pending)
    }

    @Test fun invalidChangesAreRefusedImmediatelyAndNeverQueued() = runTest {
        val engine = setup().make()
        val error = assertFailsWith<DomainError> {
            engine.enqueue("pantry.save", buildJsonObject { put("name", ""); put("amount", null as String?); put("unit", "") })
        }
        assertTrue(error.message!!.contains("ingredient name"), error.message)
        assertEquals(0, engine.pending)
    }

    @Test fun offlineChangesSurviveAReloadAndSyncWhenBackOnline() = runTest {
        val s = setup(online = false)
        val first = s.make()
        first.enqueue("shopping.save", buildJsonObject { put("id", "lemons"); put("name", "lemons"); put("amount", 2); put("unit", "") })
        first.flush()
        assertEquals(1, first.pending)
        assertTrue(first.status.value.offline)
        assertEquals(0, s.server.revision)
        first.close()
        val reopened = s.make()
        assertEquals("lemons", reopened.state.shopping[0].name, "the saved outbox is replayed after a reload")
        s.server.online = true
        assertTrue(reopened.flush())
        assertEquals("lemons", s.server.state.shopping[0].name)
        assertTrue(s.store.outbox("user").isEmpty())
        assertTrue(s.store.problems("user").isEmpty())
    }

    @Test fun consecutiveOfflineEditsOfTheSameRecipeDoNotConflictWithEachOther() = runTest {
        val s = setup(seedWith(Triple("recipe.save", sample(), "seed-rice-1")), online = false)
        val engine = s.make()
        fun edit(notes: String) = engine.enqueue("recipe.update", buildJsonObject {
            put("recipeId", "rice"); put("expectedUpdatedAt", engine.state.recipes[0].updatedAt); putJsonObject("changes") { put("notes", notes) }
        })
        edit("First"); edit("Second")
        assertEquals("Second", engine.state.recipes[0].notes)
        s.server.online = true
        assertTrue(engine.flush(), engine.status.value.problems.toString())
        assertEquals("Second", s.server.state.recipes[0].notes)
    }

    @Test fun consecutivePantryFormEditsAndACookReviewKeepTheirChecksAfterSyncing() = runTest {
        val seed = seedWith(Triple("recipe.save", sample(), "seed-rice-1"), Triple("pantry.save", pantry("stock", "rice", 1000, "g"), "seed-stock-1"))
        val s = setup(seed, online = false)
        val engine = s.make()
        fun stock() = engine.state.pantry[0]
        fun stockJson(): JsonObject = CookbookJson.encodeToJsonElement(PantryItem.serializer(), stock()).jsonObject
        fun expected() = CookbookJson.encodeToString(PantryItem.serializer(), stock())
        engine.enqueue("pantry.save", JsonObject(stockJson() + mapOf("amount" to JsonPrimitive(900), "__expected" to JsonPrimitive(expected()))))
        engine.enqueue("pantry.save", JsonObject(stockJson() + mapOf("amount" to JsonPrimitive(800), "__expected" to JsonPrimitive(expected()))))
        engine.enqueue("cook", buildJsonObject {
            put("recipeId", "rice"); put("cookServings", 2); put("eatServings", 2)
            putJsonArray("usage") { add(buildJsonObject { put("pantryId", "stock"); put("amount", 100); put("unit", "g"); put("expected", expected()) }) }
        })
        s.server.online = true
        assertTrue(engine.flush(), engine.status.value.problems.toString())
        assertEquals(700.0, s.server.state.pantry[0].amount)
    }

    @Test fun aRealConflictBecomesAProblemYouCanKeepOrDiscard() = runTest {
        val s = setup(seedWith(Triple("recipe.save", sample(), "seed-rice-1")), online = false)
        val engine = s.make()
        engine.enqueue("recipe.update", buildJsonObject {
            put("recipeId", "rice"); put("expectedUpdatedAt", engine.state.recipes[0].updatedAt); putJsonObject("changes") { put("notes", "Mine") }
        })
        engine.enqueue("pantry.save", pantry("salt", "salt", 1, "tsp"))
        // Someone else edits the same recipe first.
        s.server.edit("recipe.update", buildJsonObject {
            put("recipeId", "rice"); put("expectedUpdatedAt", s.server.state.recipes[0].updatedAt); putJsonObject("changes") { put("notes", "Theirs") }
        }, "other-device-1")
        s.server.online = true
        assertTrue(engine.flush(), "later independent changes still sync")
        assertEquals("Theirs", s.server.state.recipes[0].notes)
        assertEquals(1, s.server.state.pantry.size)
        val problem = engine.status.value.problems.single()
        assertEquals(409, problem.status)
        assertEquals("recipe.update", problem.item.type)
        assertEquals(listOf(problem), s.store.problems("user"), "problems are saved")
        engine.refresh()
        engine.retry(problem.item.id, JsonObject(problem.item.payload.jsonObject + ("expectedUpdatedAt" to JsonPrimitive(engine.state.recipes[0].updatedAt))))
        assertTrue(engine.flush())
        assertEquals("Mine", s.server.state.recipes[0].notes)
        assertEquals(0, engine.status.value.problems.size)
        assertTrue(s.store.problems("user").isEmpty())
    }

    @Test fun rapidCheckmarkTapsKeepOnlyTheLatestUnsentChoice() = runTest {
        val seed = seedWith(Triple("shopping.save", buildJsonObject { put("id", "lemons"); put("name", "lemons"); put("amount", 2); put("unit", "") }, "seed-lemons-1"))
        val s = setup(seed, online = false)
        val engine = s.make()
        for (checked in listOf(true, false, true)) engine.enqueue("shopping.toggle", buildJsonObject { put("id", "lemons"); put("checked", checked) })
        assertEquals(1, engine.pending)
        assertEquals(true, engine.state.shopping[0].checked)
        s.server.online = true
        engine.flush()
        assertEquals(listOf("shopping.toggle"), s.server.sent)
        assertEquals(true, s.server.state.shopping[0].checked)
    }

    @Test fun aChangeTheServerAlreadyAppliedIsNotAppliedTwiceAfterALostReply() = runTest {
        val s = setup()
        val engine = s.make()
        val id = engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        engine.flush()
        // Same operation replayed (for example after a crash before the outbox was cleared).
        val again = SyncEngine(s.server.snapshot, "x", MemoryStore(), s.server, s.server, { true }, backgroundScope, now = { s.time += 5; s.time })
        again.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"), id)
        assertTrue(again.flush())
        assertEquals(1, s.server.revision)
        assertEquals(1, s.server.state.movements.size)
    }

    @Test fun outboxSurvivesRestart() = runTest {
        val s = setup(online = false)
        restartScenario(s)
    }

    @Test fun unknownFieldsSurviveOfflineEdits() = runTest {
        val future = mapOf("futureField" to buildJsonObject { put("kept", true) })
        val s = setup(seedWith(Triple("recipe.save", sample(future), "seed-rice-1")), online = false)
        assertEquals(future["futureField"], s.server.state.recipes[0].extra["futureField"], "seed keeps the unknown field")
        val engine = s.make()
        fun edit(notes: String) = engine.enqueue("recipe.update", buildJsonObject {
            put("recipeId", "rice"); put("expectedUpdatedAt", engine.state.recipes[0].updatedAt); putJsonObject("changes") { put("notes", notes) }
        })
        edit("First"); edit("Second")
        assertEquals(future["futureField"], engine.state.recipes[0].extra["futureField"])
        s.server.online = true
        assertTrue(engine.flush(), engine.status.value.problems.toString())
        assertEquals("Second", s.server.state.recipes[0].notes)
        assertEquals(future["futureField"], s.server.state.recipes[0].extra["futureField"])
    }

    @Test fun unauthorisedKeepsQueue() = runTest {
        val s = setup()
        var calls = 0
        val engine = s.make(sender = { _, _, _, _ -> calls++; throw SyncFailure("Sign in", 401) })
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        runCurrent()
        assertEquals(1, calls)
        assertEquals(1, engine.pending)
        assertTrue(engine.status.value.problems.isEmpty())
        assertTrue(engine.status.value.offline)
        advanceTimeBy(10 * 60_000L)
        runCurrent()
        assertEquals(1, calls, "no retry is scheduled")
        assertEquals(1, s.store.outbox("user").size)
    }

    @Test fun serverErrorsKeepTheQueueAndRetryLater() = runTest {
        val s = setup()
        val engine = s.make()
        s.server.failNext(503)
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        runCurrent()
        assertEquals(1, engine.pending)
        assertTrue(engine.status.value.problems.isEmpty())
        assertTrue(engine.status.value.offline)
        advanceTimeBy(60_001L)
        runCurrent()
        assertEquals(0, engine.pending)
        assertFalse(engine.status.value.offline)
        assertEquals(1, s.server.revision)
    }

    @Test fun pauseStopsTheRetryTimer() = runTest {
        val s = setup()
        val engine = s.make()
        s.server.failNext(0)
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        runCurrent()
        engine.pause()
        advanceTimeBy(10 * 60_000L)
        runCurrent()
        assertEquals(1, engine.pending)
        assertTrue(engine.flush(), "a later drain resumes")
    }

    @Test fun photoUploadsRunBeforeCommands() = runTest {
        val s = setup()
        val events = mutableListOf<String>()
        val engine = s.make(
            sender = { type, payload, id, revision -> events += "send $type"; s.server.send(type, payload, id, revision) },
            beforeSend = { events += "upload" },
        )
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        engine.enqueue("pantry.save", pantry("salt", "salt", 1, "tsp"))
        assertTrue(engine.flush())
        assertEquals(listOf("upload", "send pantry.save", "upload", "send pantry.save"), events)
    }

    @Test fun aFailedPhotoUploadKeepsTheChangeQueued() = runTest {
        val s = setup()
        val engine = s.make(beforeSend = { throw SyncFailure("Upload failed", 0) })
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        assertFalse(engine.flush())
        assertEquals(1, engine.pending)
        assertTrue(engine.status.value.problems.isEmpty())
        assertTrue(s.server.sent.isEmpty())
    }

    @Test fun aChangeQueuedDuringASendIsStillSent() = runTest {
        val s = setup()
        lateinit var engine: SyncEngine
        var enqueued = false
        engine = s.make(sender = { type, payload, id, revision ->
            val saved = s.server.send(type, payload, id, revision)
            // Arrives while the pass is waiting for the server's answer.
            if (!enqueued) { enqueued = true; engine.enqueue("pantry.save", pantry("salt", "salt", 1, "tsp")) }
            saved
        })
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        assertTrue(engine.flush())
        assertEquals(listOf("rice", "salt"), s.server.state.pantry.map { it.id })
    }

    @Test fun anAnswerArrivingAfterCloseIsNotSaved() = runTest {
        val s = setup()
        val answer = kotlinx.coroutines.CompletableDeferred<Unit>()
        val engine = s.make(sender = { type, payload, id, revision -> answer.await(); s.server.send(type, payload, id, revision) })
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        runCurrent()
        assertTrue(engine.status.value.syncing, "the send is waiting for the server")
        // Signing out: the engine closes and the account's data is removed while the request is in flight.
        engine.close()
        s.store.clearAccount("user")
        answer.complete(Unit)
        runCurrent()
        assertNull(s.store.readSnapshot("user"), "the signed-out account's cookbook is not written back")
        assertEquals(0, s.store.outbox("user").size)
        assertEquals(0, s.store.problems("user").size)
    }

    @Test fun aConfirmedChangeSavesTheCookbookAndOutboxInOneWrite() = runTest {
        val calls = mutableListOf<String>()
        val store = object : LocalStore by MemoryStore() {
            override fun writeConfirmed(account: String, snapshot: Snapshot, outbox: List<app.cookbook.core.store.OutboxItem>) {
                calls += "writeConfirmed:${snapshot.revision}:${outbox.size}"
            }
            override fun writeSnapshot(account: String, snapshot: Snapshot) { calls += "writeSnapshot" }
            override fun replaceOutbox(account: String, items: List<app.cookbook.core.store.OutboxItem>) { calls += "replaceOutbox:${items.size}" }
        }
        val s = Setup(backgroundScope, store = store)
        val engine = s.make()
        s.server.online = false
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        engine.enqueue("pantry.save", pantry("salt", "salt", 1, "tsp"))
        runCurrent()
        calls.clear()
        s.server.online = true
        assertTrue(engine.flush())
        assertEquals(listOf("writeConfirmed:1:1", "writeConfirmed:2:0"), calls)
    }

    @Test fun anAnswerThisVersionCannotReadBecomesAProblemInsteadOfRetrying() = runTest {
        val s = setup()
        var sends = 0
        val engine = s.make(sender = CommandSender { _, _, _, _ -> sends++; throw kotlinx.serialization.SerializationException("Unexpected JSON token") })
        engine.enqueue("pantry.save", pantry("rice", "rice", 1, "kg"))
        runCurrent()
        advanceTimeBy(10 * 60_000L)
        runCurrent()
        assertEquals(1, sends, "not retried")
        assertEquals(0, engine.pending)
        val problem = engine.status.value.problems.single()
        assertEquals(426, problem.status)
        assertEquals("This cookbook was saved by a newer version of CookBook. Update the app to continue.", problem.message)
    }

    @Test fun acceptIgnoresOlderAndForeignSnapshots() = runTest {
        val s = setup()
        val engine = s.make()
        s.server.edit("pantry.save", pantry("rice", "rice", 1, "kg"))
        engine.accept(s.server.snapshot)
        assertEquals(1L, engine.view.value.revision)
        engine.accept(Snapshot(HOUSEHOLD, 0, initialState()))
        engine.accept(Snapshot("another", 5, initialState()))
        assertEquals(listOf("rice"), engine.state.pantry.map { it.id })
        assertEquals(1L, s.store.readSnapshot("user")?.revision, "the confirmed cookbook is saved")
    }
}

/** Shared by the in-memory test and the SQLite test in jvmTest. */
suspend fun TestScope.restartScenario(s: Setup) {
    val first = s.make()
    first.enqueue("shopping.save", buildJsonObject { put("id", "lemons"); put("name", "lemons"); put("amount", 2); put("unit", "") })
    assertFalse(first.flush())
    assertEquals(1, s.store.outbox("user").size)
    first.close()
    // The app restarts: a new engine reads the same store.
    val second = s.make()
    assertEquals(1, second.status.value.pending)
    assertEquals("lemons", second.view.value.state.shopping.single().name)
    s.server.online = true
    assertTrue(second.flush())
    assertEquals(1, s.server.revision)
    assertEquals(listOf("lemons"), s.server.state.shopping.map { it.name })
    assertTrue(s.store.outbox("user").isEmpty())
    assertEquals(1L, s.store.readSnapshot("user")?.revision)
    assertNull(s.store.problems("user").firstOrNull())
    assertNotNull(s.store.readSnapshot("user"))
}
