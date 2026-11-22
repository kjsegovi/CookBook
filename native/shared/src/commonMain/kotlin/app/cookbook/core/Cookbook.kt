package app.cookbook.core

import app.cookbook.core.api.BackendConfig
import app.cookbook.core.api.CookbookApi
import app.cookbook.core.api.ReadResult
import app.cookbook.core.api.Session
import app.cookbook.core.commands.jsIsoString
import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.Ids
import app.cookbook.core.domain.Recipe
import app.cookbook.core.domain.blankRecipe
import app.cookbook.core.domain.parseHttpUrl
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.store.LocalStore
import app.cookbook.core.store.Snapshot
import app.cookbook.core.sync.CommandSender
import app.cookbook.core.sync.SnapshotReader
import app.cookbook.core.sync.SyncEngine
import app.cookbook.core.sync.SyncFailure
import app.cookbook.core.sync.SyncStatus
import app.cookbook.core.sync.applyStatePatch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add
import kotlin.time.Clock

private const val SIGN_IN = "Please sign in to open your cookbook."
private const val NOT_OPEN = "Open your cookbook first."
private const val UNREADABLE = "The cookbook response could not be read. Please try again."
// Copied from the website (src/components/kitchen.tsx, importUrl).
private const val OFFLINE_IMPORT =
    "Saved while offline. When you’re back online, use Import a link with this address to bring in the recipe."
private val FLAGS = setOf("shopping.toggle", "recipe.favorite")

/**
 * The one object the app screens use: the signed-in cookbook, saved on this device and synced in the background.
 * Port of the website's flows in src/lib/api.ts, src/app.tsx and src/components/kitchen.tsx.
 *
 * Threading: [scope] must run on a single thread (the main dispatcher in the apps; a test or single-thread dispatcher
 * in tests). Call every public method and collect every flow from that dispatcher; the sync engine runs there too.
 */
class Cookbook(
    val config: BackendConfig,
    private val session: Session,
    private val store: LocalStore,
    private val api: CookbookApi,
    private val scope: CoroutineScope,
    private val online: () -> Boolean,
    private val now: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) {
    private var engine: SyncEngine? = null
    private var watchers: Job? = null
    // The last read failed for lack of a connection; the engine only notices that while sending.
    private var unreachable = false

    private val _account = MutableStateFlow<String?>(null)
    private val _view = MutableStateFlow<Snapshot?>(null)
    private val _status = MutableStateFlow(currentStatus())
    private val _needsSignIn = MutableStateFlow(false)

    /** The account whose cookbook is open (the last signed-in one when opened offline). */
    val account: StateFlow<String?> = _account.asStateFlow()
    /** What you see: the last confirmed cookbook with unsent changes applied; null until [open] finds one. */
    val view: StateFlow<Snapshot?> = _view.asStateFlow()
    val status: StateFlow<SyncStatus> = _status.asStateFlow()
    /** The saved sign-in is missing or the server refused it (401). Unsent changes are kept; sign in to send them. */
    val needsSignIn: StateFlow<Boolean> = _needsSignIn.asStateFlow()

    private fun currentStatus(): SyncStatus {
        val engineStatus = engine?.status?.value ?: SyncStatus(0, emptyList(), !online(), false)
        return if (unreachable && !engineStatus.offline) engineStatus.copy(offline = true) else engineStatus
    }

    /** Copies the engine's state into the public flows; called after every operation and on each engine update. */
    private fun sync() {
        _view.value = engine?.view?.value
        _status.value = currentStatus()
    }

    private fun failed(e: SyncFailure) {
        if (e.status == 0) unreachable = true
        if (e.status == 401) _needsSignIn.value = true
        sync()
    }

    private fun reachedServer() {
        unreachable = false
        _needsSignIn.value = false
    }

    // --- opening ---

    private suspend fun signedInUser(): String? {
        val token = try { session.accessToken() } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
        if (token == null) return null
        // The session may publish its user a moment after the token is available.
        return session.userId.value ?: withTimeoutOrNull(5_000) { session.userId.first { it != null } }
    }

    /**
     * Opens the cookbook of the signed-in account, or of the last signed-in account when the sign-in can't be checked
     * (offline). A saved copy opens without the network, then a refresh is tried; connection and sign-in failures are
     * shown through [status] and [needsSignIn]. With no saved copy the cookbook is read from the server, and a failure
     * is thrown ([SyncFailure]) with [view] left null.
     */
    suspend fun open() {
        val user = signedInUser()
        if (user == null) _needsSignIn.value = true
        val account = user ?: store.lastAccount() ?: run { sync(); throw SyncFailure(SIGN_IN, 401) }
        if (user != null) store.setLastAccount(user)
        if (engine == null || _account.value != account) {
            stop()
            _account.value = account
            val saved = store.readSnapshot(account)
            if (saved == null) {
                val snapshot = try { full() } catch (e: SyncFailure) { failed(e); throw e }
                store.writeSnapshot(account, snapshot)
                start(account, snapshot)
                reachedServer()
                sync()
                return
            }
            start(account, saved)
        }
        try { refresh() } catch (e: SyncFailure) { if (e.status != 0 && e.status != 401) throw e }
    }

    private fun start(account: String, snapshot: Snapshot) {
        var created: SyncEngine? = null
        val engine = SyncEngine(
            initial = snapshot, account = account, store = store,
            sender = CommandSender { type, payload, id, revision -> send(created!!, type, payload, id, revision) },
            reader = SnapshotReader { read(created!!) },
            online = online, scope = scope, now = now,
        )
        created = engine
        this.engine = engine
        watchers = scope.launch {
            launch { engine.view.collect { sync() } }
            launch { engine.status.collect { sync() } }
        }
        sync()
    }

    private fun stop() {
        engine?.close()
        watchers?.cancel()
        engine = null
        watchers = null
        sync()
    }

    // --- server mapping ---

    private suspend fun <T> call(block: suspend () -> T): T = try {
        block()
    } catch (e: SyncFailure) {
        if (e.status == 401) _needsSignIn.value = true
        throw e
    }

    private suspend fun full(): Snapshot =
        (call { api.read(null) } as? ReadResult.Full)?.snapshot ?: throw SyncFailure(UNREADABLE, 502)

    /** A server answer on top of [base]: a delta applies only to the revision it was made from. */
    private suspend fun resolve(base: Snapshot, result: ReadResult): Snapshot = when (result) {
        is ReadResult.Full -> result.snapshot
        is ReadResult.Changes ->
            if (result.baseRevision == base.revision && result.householdId == base.householdId) {
                try { Snapshot(result.householdId, result.revision, applyStatePatch(base.state, result.patch)) } catch (e: DomainError) { full() }
            } else full()
        is ReadResult.Unchanged ->
            if (result.revision == base.revision && result.householdId == base.householdId) base else full()
    }

    private suspend fun send(engine: SyncEngine, type: String, payload: JsonElement, id: String, revision: Long): Snapshot {
        val base = engine.confirmedSnapshot
        val result = call {
            if (type in FLAGS) {
                // Checkmarks and hearts take the database fast path, as on the website.
                val o = payload as? JsonObject ?: JsonObject(emptyMap())
                fun text(key: String) = (o[key] as? JsonPrimitive)?.contentOrNull
                val checked = (o[if (type == "shopping.toggle") "checked" else "favorite"] as? JsonPrimitive)?.booleanOrNull ?: false
                api.setFlag(type, text("id") ?: "", checked, id, revision, text("expectedUpdatedAt"))
            } else api.command(type, payload, id, revision, base.householdId)
        }
        return resolve(base, result)
    }

    private suspend fun read(engine: SyncEngine): Snapshot {
        val base = engine.confirmedSnapshot
        return resolve(base, call { api.read(base.revision) })
    }

    // --- using the cookbook ---

    /** Applies the change here at once and queues it for the server. An invalid change fails with its [DomainError]. */
    fun save(type: String, payload: JsonElement): Result<Unit> {
        val engine = engine ?: return Result.failure(DomainError(NOT_OPEN, 409))
        return try {
            engine.enqueue(type, payload)
            sync()
            Result.success(Unit)
        } catch (e: DomainError) {
            Result.failure(e)
        }
    }

    /** Gets the latest cookbook from the server; throws [SyncFailure] when it can't. */
    suspend fun refresh() {
        val engine = engine ?: return open()
        try { engine.refresh() } catch (e: SyncFailure) { failed(e); throw e }
        reachedServer()
        sync()
    }

    /** Waits for unsent changes; false while any remain (offline or signed out). Rejected changes become problems. */
    suspend fun flush(): Boolean {
        val engine = engine ?: return true
        val done = engine.flush()
        if (done) unreachable = false
        sync()
        return done
    }

    /** Call when the device's connection changes: sends waiting changes and updates [status]. */
    fun connectivityChanged() {
        if (online()) unreachable = false
        sync()
        val engine = engine ?: return
        scope.launch { engine.drain(); sync() }
    }

    /** Discards a rejected change. */
    fun dismiss(problemId: String) { engine?.dismiss(problemId); sync() }

    /** Keep mine: resends a rejected change with [payload] against the latest version. */
    fun retry(problemId: String, payload: JsonElement): Result<String?> = try {
        Result.success(engine?.retry(problemId, payload)).also { sync() }
    } catch (e: DomainError) {
        Result.failure(e)
    }

    /** Stops retry timers while no screen shows the cookbook. */
    fun pause() { engine?.pause() }

    /**
     * Imports a recipe link as a draft and returns the draft's id. Offline, the link is kept as a draft holding only
     * its address, to import again later, as on the website.
     */
    suspend fun importLink(url: String): String {
        val engine = engine ?: throw DomainError(NOT_OPEN, 409)
        if (!online()) return offlineDraft(url)
        engine.flush()
        val (snapshot, draftId) = try {
            call { api.importLink(url, Ids.uuid(), engine.confirmedSnapshot.householdId) }
        } catch (e: SyncFailure) {
            failed(e)
            if (e.status == 0) return offlineDraft(url)
            throw e
        }
        engine.accept(snapshot)
        reachedServer()
        sync()
        return draftId
    }

    private fun offlineDraft(url: String): String {
        val id = Ids.uuid()
        val host = parseHttpUrl(url)?.substringAfter("://")?.substringBefore('/')
            ?.let { if (it.startsWith("[")) it.substringBefore(']') + "]" else it.substringBefore(':') }
            ?.removePrefix("www.") ?: ""
        val recipe = blankRecipe(Ids.uuid(), jsIsoString(now())).copy(sourceUrl = url, title = host)
        val payload = buildJsonObject {
            put("id", id)
            put("recipe", CookbookJson.encodeToJsonElement(Recipe.serializer(), recipe))
            put("text", url)
            putJsonArray("warnings") { add(OFFLINE_IMPORT) }
        }
        save("draft.save", payload).getOrThrow()
        return id
    }

    // --- account ---

    /** Signs in, then opens that account's cookbook and sends any changes waiting from before. */
    suspend fun signIn(email: String, password: String) {
        session.signIn(email, password)
        _needsSignIn.value = false
        open()
    }

    /**
     * Signs out and forgets this device's copy of the cookbook. Returns false, doing nothing, while changes are unsent
     * unless [force] is set (the screen first warns that they will be lost).
     */
    suspend fun signOut(force: Boolean = false): Boolean {
        if (status.value.pending > 0 && !force) return false
        val account = _account.value
        stop()
        try { session.signOut() } catch (e: CancellationException) { throw e } catch (e: Exception) { /* forgotten locally regardless */ }
        account?.let { store.clearAccount(it) }
        store.setLastAccount(null)
        _account.value = null
        unreachable = false
        _needsSignIn.value = false
        sync()
        return true
    }
}
