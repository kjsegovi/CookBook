package app.cookbook.core

import app.cookbook.core.api.BackendConfig
import app.cookbook.core.api.CookbookApi
import app.cookbook.core.api.ReadResult
import app.cookbook.core.api.Session
import app.cookbook.core.store.Snapshot
import app.cookbook.core.sync.CollectionPatch
import app.cookbook.core.sync.FakeServer
import app.cookbook.core.sync.HOUSEHOLD
import app.cookbook.core.sync.MemoryStore
import app.cookbook.core.sync.SEED_TIME
import app.cookbook.core.sync.StatePatch
import app.cookbook.core.sync.SyncFailure
import app.cookbook.core.sync.sample
import app.cookbook.core.sync.seedWith
import app.cookbook.core.sync.statePatch
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.ContinuationInterceptor

internal class FakeSession(signedIn: Boolean = true) : Session {
    var token: String? = if (signedIn) "token" else null
    /** The token the next refresh hands out; null means the saved sign-in can't be refreshed. */
    var refreshedToken: String? = null
    var refreshes = 0
    private val user = MutableStateFlow(if (signedIn) "user" else null)
    override val userId: StateFlow<String?> = user
    override suspend fun accessToken() = token
    override suspend fun refreshAccessToken(): String? {
        refreshes++
        val next = refreshedToken ?: return null
        refreshedToken = null
        token = next
        return next
    }
    fun become(id: String) { user.value = id }
    override suspend fun signIn(email: String, password: String) { token = "token"; user.value = "user" }
    override suspend fun signOut() { token = null; user.value = null }
    override suspend fun sendPasswordReset(email: String) {}
}

/** The cookbook API over [FakeServer]: flags answer with a delta, as set_cookbook_flag does. */
internal class FakeApi(val server: FakeServer, private val session: FakeSession? = null) : CookbookApi {
    var online = true
    var signedIn = true
    /** While set, requests are refused (401) unless the session's token is this one. */
    var requiredToken: String? = null
    /** The next flag answer claims a base revision this device never had. */
    var staleDelta = false
    /** The next flag answer is a delta for the right revision that can't be applied (a row without an id). */
    var brokenDelta = false
    /** Command and flag answers can't be decoded by this version while set. */
    var undecodable = false
    /** Reads fail with this status (a server error) while set. */
    var readFailure: Int? = null
    /** Commands wait for this before reaching the server while set. */
    var gate: CompletableDeferred<Unit>? = null
    var resets = 0
    val calls = mutableListOf<String>()

    private fun check() {
        if (!online) throw SyncFailure("Failed to fetch", 0)
        if (!signedIn) throw SyncFailure("Please sign in to open your cookbook.", 401)
        requiredToken?.let { if (session?.token != it) throw SyncFailure("Please sign in to open your cookbook.", 401) }
    }

    override fun reset() { resets++ }

    override suspend fun read(knownRevision: Long?): ReadResult {
        check()
        readFailure?.let { throw SyncFailure("The cookbook is busy. Please try again.", it) }
        calls += "read:$knownRevision"
        return if (knownRevision == server.revision) ReadResult.Unchanged(server.revision, HOUSEHOLD) else ReadResult.Full(server.snapshot)
    }

    override suspend fun command(type: String, payload: JsonElement, id: String, revision: Long, household: String): ReadResult {
        check(); calls += "command:$type"
        gate?.await()
        val snapshot = server.send(type, payload, id, revision)
        if (undecodable) throw SerializationException("Unexpected JSON token at offset 0")
        return ReadResult.Full(snapshot)
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
        if (undecodable) throw SerializationException("Unexpected JSON token at offset 0")
        if (brokenDelta) {
            brokenDelta = false
            val row = JsonObject(mapOf("name" to JsonPrimitive("no id")))
            return ReadResult.Changes(revision, after.revision, HOUSEHOLD, StatePatch(mapOf("shopping" to CollectionPatch(listOf(row), emptyList())), JsonObject(emptyMap()), emptyList()))
        }
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

internal val CONFIG = BackendConfig("https://backend.example.test", "publishable", "https://kitchen.example.test")

internal fun shoppingSeed() = seedWith(
    Triple("recipe.save", sample(), "seed-recipe-1"),
    Triple("shopping.save", buildJsonObject { put("id", "lemons"); put("name", "Lemons"); put("amount", 2); put("unit", "") }, "seed-shop-1"),
)

/** The test's own dispatcher, so the cookbook's confined work runs on the test scheduler. */
internal val TestScope.dispatcher: CoroutineDispatcher get() = coroutineContext[ContinuationInterceptor] as CoroutineDispatcher

internal class World(scope: TestScope, signedIn: Boolean = true) {
    val server = FakeServer(shoppingSeed())
    val session = FakeSession(signedIn)
    val api = FakeApi(server, session)
    val store = MemoryStore()
    var online = true
    var time = SEED_TIME + 1_000_000
    /** The device clock throws this while set (an unexpected failure while saving). */
    var clockFailure: Throwable? = null
    val cookbook = Cookbook(
        CONFIG, session, store, api, scope.backgroundScope, { online && api.online },
        { clockFailure?.let { throw it }; time += 5; time }, scope.dispatcher,
    )

    fun goOffline() { online = false; api.online = false; cookbook.connectivityChanged() }
    fun goOnline() { online = true; api.online = true; cookbook.connectivityChanged() }
}
