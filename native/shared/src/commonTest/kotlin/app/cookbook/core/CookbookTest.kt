package app.cookbook.core

import app.cookbook.core.api.BackendConfig
import app.cookbook.core.api.CookbookApi
import app.cookbook.core.api.ReadResult
import app.cookbook.core.api.Session
import app.cookbook.core.domain.DomainError
import app.cookbook.core.store.Snapshot
import app.cookbook.core.sync.FakeServer
import app.cookbook.core.sync.HOUSEHOLD
import app.cookbook.core.sync.MemoryStore
import app.cookbook.core.sync.SEED_TIME
import app.cookbook.core.sync.SyncFailure
import app.cookbook.core.sync.sample
import app.cookbook.core.sync.seedWith
import app.cookbook.core.sync.statePatch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeSession(signedIn: Boolean = true) : Session {
    var token: String? = if (signedIn) "token" else null
    private val user = MutableStateFlow(if (signedIn) "user" else null)
    override val userId: StateFlow<String?> = user
    override suspend fun accessToken() = token
    override suspend fun signIn(email: String, password: String) { token = "token"; user.value = "user" }
    override suspend fun signOut() { token = null; user.value = null }
    override suspend fun sendPasswordReset(email: String) {}
}

/** The cookbook API over [FakeServer]: flags answer with a delta, as set_cookbook_flag does. */
private class FakeApi(val server: FakeServer) : CookbookApi {
    var online = true
    var signedIn = true
    /** The next flag answer claims a base revision this device never had. */
    var staleDelta = false
    val calls = mutableListOf<String>()

    private fun check() {
        if (!online) throw SyncFailure("Failed to fetch", 0)
        if (!signedIn) throw SyncFailure("Please sign in to open your cookbook.", 401)
    }

    override suspend fun read(knownRevision: Long?): ReadResult {
        check(); calls += "read:$knownRevision"
        return if (knownRevision == server.revision) ReadResult.Unchanged(server.revision, HOUSEHOLD) else ReadResult.Full(server.snapshot)
    }

    override suspend fun command(type: String, payload: JsonElement, id: String, revision: Long, household: String): ReadResult {
        check(); calls += "command:$type"
        return ReadResult.Full(server.send(type, payload, id, revision))
    }

    override suspend fun setFlag(
        type: String, recordId: String, checked: Boolean, operationId: String, revision: Long, expectedUpdatedAt: String?,
    ): ReadResult {
        check(); calls += "flag:$type:$recordId:$checked"
        val before = server.snapshot
        val payload = buildJsonObject {
            put("id", recordId); put(if (type == "shopping.toggle") "checked" else "favorite", checked)
            expectedUpdatedAt?.let { put("expectedUpdatedAt", it) }
        }
        val after = server.send(type, payload, operationId, revision)
        val base = if (staleDelta) revision - 1 else revision
        staleDelta = false
        return ReadResult.Changes(base, after.revision, HOUSEHOLD, statePatch(before.state, after.state))
    }

    override suspend fun importLink(url: String, id: String, household: String): Pair<Snapshot, String> {
        check(); calls += "import"
        val recipe = JsonObject(sample() + mapOf("id" to JsonPrimitive("imported"), "sourceUrl" to JsonPrimitive(url)))
        val snapshot = server.edit("draft.save", buildJsonObject { put("id", "draft-1"); put("recipe", recipe) })
        return snapshot to "draft-1"
    }

    override suspend fun photoUrls(references: List<String>, variant: String) = error("unused")
    override suspend fun uploadPhoto(id: String, photo: ByteArray, photoType: String, thumbnail: ByteArray?) = error("unused")
    override suspend fun export() = error("unused")
    override suspend fun restore(backup: JsonObject) = error("unused")
    override suspend fun remindersBegin(list: String, returnUrl: String) = error("unused")
    override suspend fun remindersStatus(syncId: String) = error("unused")
}

private val CONFIG = BackendConfig("https://backend.example.test", "publishable", "https://kitchen.example.test")

private fun shoppingSeed() = seedWith(
    Triple("recipe.save", sample(), "seed-recipe-1"),
    Triple("shopping.save", buildJsonObject { put("id", "lemons"); put("name", "Lemons"); put("amount", 2); put("unit", "") }, "seed-shop-1"),
)

private class World(scope: TestScope, signedIn: Boolean = true) {
    val server = FakeServer(shoppingSeed())
    val api = FakeApi(server)
    val session = FakeSession(signedIn)
    val store = MemoryStore()
    var online = true
    var time = SEED_TIME + 1_000_000
    val cookbook = Cookbook(CONFIG, session, store, api, scope.backgroundScope, { online && api.online }, { time += 5; time })

    fun goOffline() { online = false; api.online = false; cookbook.connectivityChanged() }
    fun goOnline() { online = true; api.online = true; cookbook.connectivityChanged() }
}

class CookbookTest {
    private val Cookbook.state get() = view.value!!.state

    @Test fun opensFromTheServerAndRemembersTheAccount() = runTest {
        val w = World(this)
        w.cookbook.open()
        assertEquals("user", w.cookbook.account.value)
        assertEquals(listOf("rice"), w.cookbook.state.recipes.map { it.id })
        assertEquals(w.server.snapshot, w.store.readSnapshot("user"), "saved for opening offline")
        assertEquals("user", w.store.lastAccount())
        assertEquals(listOf("read:null"), w.api.calls)
    }

    @Test fun opensOfflineFromTheSavedCopyOfTheLastAccount() = runTest {
        val first = World(this)
        first.cookbook.open()
        // A new launch: no saved sign-in and no network.
        val api = FakeApi(first.server).also { it.online = false }
        val cookbook = Cookbook(CONFIG, FakeSession(signedIn = false), first.store, api, backgroundScope, { false })
        cookbook.open()
        assertEquals("user", cookbook.account.value)
        assertEquals(listOf("rice"), cookbook.state.recipes.map { it.id })
        assertTrue(cookbook.status.value.offline)
        assertTrue(cookbook.needsSignIn.value)
    }

    @Test fun withNoSavedCopyAndNoNetworkOpenFails() = runTest {
        val w = World(this)
        w.online = false; w.api.online = false
        val failure = assertFailsWith<SyncFailure> { w.cookbook.open() }
        assertEquals(0, failure.status)
        assertNull(w.cookbook.view.value)
        assertTrue(w.cookbook.status.value.offline)
        val signedOut = World(this, signedIn = false)
        assertEquals(401, assertFailsWith<SyncFailure> { signedOut.cookbook.open() }.status)
        assertTrue(signedOut.cookbook.needsSignIn.value)
    }

    @Test fun reachableButFailingRefreshShowsOffline() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.online = false  // the device thinks it is online, but the server can't be reached
        assertFailsWith<SyncFailure> { w.cookbook.refresh() }
        assertTrue(w.cookbook.status.value.offline)
        w.api.online = true
        w.cookbook.refresh()
        assertFalse(w.cookbook.status.value.offline)
    }

    @Test fun flagsUseTheFastPathAndApplyItsDelta() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.cookbook.save("shopping.toggle", buildJsonObject { put("id", "lemons"); put("checked", true) }).getOrThrow()
        w.cookbook.save("pantry.save", buildJsonObject { put("name", "rice"); put("amount", 1); put("unit", "kg") }).getOrThrow()
        assertTrue(w.cookbook.flush())
        assertEquals(listOf("read:null", "flag:shopping.toggle:lemons:true", "command:pantry.save"), w.api.calls)
        assertEquals(w.server.revision, w.cookbook.view.value!!.revision)
        assertTrue(w.cookbook.state.shopping.single().checked)
        assertEquals(w.server.state, w.cookbook.state)
    }

    @Test fun aDeltaForAnotherRevisionFallsBackToAFullRead() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.staleDelta = true
        w.cookbook.save("shopping.toggle", buildJsonObject { put("id", "lemons"); put("checked", true) }).getOrThrow()
        assertTrue(w.cookbook.flush())
        assertEquals("read:null", w.api.calls.last())
        assertTrue(w.cookbook.state.shopping.single().checked)
    }

    @Test fun invalidChangesFailAtOnce() = runTest {
        val w = World(this)
        assertTrue(w.cookbook.save("pantry.save", buildJsonObject {}).exceptionOrNull() is DomainError, "not open yet")
        w.cookbook.open()
        val failure = w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 9) }).exceptionOrNull()
        assertTrue(failure is DomainError)
        assertEquals(0, w.cookbook.status.value.pending)
    }

    @Test fun signInExpiryKeepsChangesUntilSignedInAgain() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.signedIn = false
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 4) }).getOrThrow()
        assertFalse(w.cookbook.flush())
        assertTrue(w.cookbook.needsSignIn.value)
        assertEquals(1, w.cookbook.status.value.pending)
        assertEquals(1, w.store.outbox("user").size)
        w.api.signedIn = true
        w.cookbook.signIn("qa@example.test", "local-qa-password")
        assertFalse(w.cookbook.needsSignIn.value)
        assertTrue(w.cookbook.flush())
        assertEquals(4, w.server.state.recipes.single().rating)
    }

    @Test fun importOfflineKeepsTheLinkAsADraft() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.goOffline()
        val id = w.cookbook.importLink("https://www.example.com/soup?x=1")
        val draft = w.cookbook.state.drafts.single { it.id == id }
        assertEquals("https://www.example.com/soup?x=1", draft.recipe.sourceUrl)
        assertEquals("example.com", draft.recipe.title)
        assertEquals("https://www.example.com/soup?x=1", draft.text)
        assertEquals(
            listOf("Saved while offline. When you’re back online, use Import a link with this address to bring in the recipe."),
            draft.warnings,
        )
        assertEquals(1, w.cookbook.status.value.pending)
        w.goOnline()
        assertTrue(w.cookbook.flush())
        assertEquals(listOf(id), w.server.state.drafts.map { it.id })
    }

    @Test fun importOnlineFlushesFirstAndAcceptsTheServersCookbook() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 3) }).getOrThrow()
        assertEquals("draft-1", w.cookbook.importLink("https://example.com/soup"))
        assertEquals(listOf("read:null", "command:recipe.rate", "import"), w.api.calls)
        assertEquals(listOf("draft-1"), w.cookbook.state.drafts.map { it.id })
        assertEquals(w.server.revision, w.cookbook.view.value!!.revision)
    }

    @Test fun signOutWaitsForUnsentChangesUnlessForced() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.goOffline()
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 2) }).getOrThrow()
        assertFalse(w.cookbook.signOut())
        assertEquals("user", w.session.userId.value, "nothing happened")
        assertEquals(1, w.store.outbox("user").size)
        assertTrue(w.cookbook.signOut(force = true))
        assertNull(w.session.userId.value)
        assertNull(w.cookbook.view.value)
        assertNull(w.cookbook.account.value)
        assertNull(w.store.readSnapshot("user"))
        assertEquals(0, w.store.outbox("user").size)
        assertNull(w.store.lastAccount())
    }
}
