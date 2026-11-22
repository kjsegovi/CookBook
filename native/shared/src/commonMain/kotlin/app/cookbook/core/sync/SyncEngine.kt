package app.cookbook.core.sync

import app.cookbook.core.commands.applyCommand
import app.cookbook.core.commands.jsIsoString
import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.Ids
import app.cookbook.core.domain.Settings
import app.cookbook.core.domain.State
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.jsonParse
import app.cookbook.core.json.stableJson
import app.cookbook.core.store.LocalStore
import app.cookbook.core.store.OutboxItem
import app.cookbook.core.store.Problem
import app.cookbook.core.store.Snapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.min

// Port of src/lib/sync-engine.ts. Every change is applied on this device at once and kept in a saved outbox; the
// outbox is sent in order whenever the server is reachable. What you see is the last confirmed cookbook with the
// outbox replayed on top, using the same command code the server runs. The server stays the authority: a change it
// rejects moves to `problems` for you to keep, copy or discard.

fun interface CommandSender { suspend fun send(type: String, payload: JsonElement, id: String, revision: Long): Snapshot }
fun interface SnapshotReader { suspend fun read(): Snapshot }

/** A failed request; [status] is the HTTP status, or 0 when the server could not be reached. */
class SyncFailure(message: String, val status: Int) : Exception(message)

data class SyncStatus(val pending: Int, val problems: List<Problem>, val offline: Boolean, val syncing: Boolean)

/** Shown when the server sent something this version can't read; 426 makes it a problem, not an endless retry. */
const val UPDATE_APP = "This cookbook was saved by a newer version of CookBook. Update the app to continue."

/** Any failure as a [SyncFailure]; data that can't be decoded (IllegalArgumentException, SerializationException) is 426. */
internal fun asSyncFailure(error: Throwable): SyncFailure = when (error) {
    is SyncFailure -> error
    is DomainError -> SyncFailure(error.message ?: "This change could not be saved.", error.status)
    is IllegalArgumentException -> SyncFailure(UPDATE_APP, 426)
    else -> SyncFailure(error.message ?: "This change could not be saved.", 0)
}

// Rejections the server will repeat: show them instead of retrying forever.
private fun isRejection(status: Int) = status in 400..499 && status != 401 && status != 408 && status != 429
private val COALESCIBLE = setOf("shopping.toggle", "recipe.favorite")

/**
 * Threading: like the website's engine this is single-threaded. Call every method from [scope]'s dispatcher, which must
 * run one task at a time: in the apps that is [app.cookbook.core.Cookbook]'s confined background dispatcher, never the
 * UI thread. The flows may be collected anywhere; [sender], [reader] and [beforeSend] may switch dispatchers.
 */
class SyncEngine(
    initial: Snapshot,
    private val account: String,
    private val store: LocalStore,
    private val sender: CommandSender,
    private val reader: SnapshotReader,
    private val online: () -> Boolean,
    private val scope: CoroutineScope,
    private val retryDelayMs: (Int) -> Long = { min(60_000L, 2000L shl min(it, 5)) },
    private val now: () -> Long,
    private val beforeSend: suspend () -> Unit = {},
) {
    private var confirmed = initial
    private var queue: List<OutboxItem> = emptyList()
    private var problemList: List<Problem> = emptyList()
    private var sending: String? = null
    private var failures = 0
    private var lastError = false
    private var closed = false
    private var timer: Job? = null
    // One pass at a time; a drain called during a pass waits for it, then runs a fresh pass, so a change queued
    // while a pass is finishing is still sent.
    private val passes = Mutex()

    init {
        // A damaged outbox is ignored rather than blocking the cookbook.
        try { queue = store.outbox(account) } catch (e: Exception) { queue = emptyList() }
        try { problemList = store.problems(account) } catch (e: Exception) { problemList = emptyList() }
    }

    private val _view = MutableStateFlow(replay())
    private val _status = MutableStateFlow(currentStatus())
    val view: StateFlow<Snapshot> = _view.asStateFlow()
    /** The last cookbook the server confirmed, without the outbox; server deltas apply to this. */
    val confirmedSnapshot: Snapshot get() = confirmed
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    private fun replay(): Snapshot {
        var state = confirmed.state
        for (item in queue) {
            // An item the latest cookbook no longer accepts stays queued; the server decides.
            try { state = applyCommand(state, item.type, item.payload, item.id, jsIsoString(item.at)) } catch (e: Exception) { /* shown after sending */ }
        }
        return confirmed.copy(state = state)
    }

    private fun currentStatus() = SyncStatus(queue.size, problemList, lastError || !online(), sending != null)
    private fun publishStatus() { _status.value = currentStatus() }
    private fun changed() { _view.value = replay(); publishStatus() }

    private fun persistQueue() {
        // Storage may fail (full disk); the change still syncs while the app stays open.
        try { store.replaceOutbox(account, queue) } catch (e: Exception) { }
    }
    private fun persistProblems() {
        try { store.replaceProblems(account, problemList) } catch (e: Exception) { }
    }
    private fun persistConfirmed() {
        try { store.writeSnapshot(account, confirmed) } catch (e: Exception) { }
    }

    /** Stops retry timers while no screen is showing the cookbook; any later change or drain resumes. */
    fun pause() { timer?.cancel(); timer = null }

    /** After sign-out: nothing more is sent and changes are refused. */
    fun close() { closed = true; pause() }

    /** Forgets the outbox and problems (for example when signing out on purpose). */
    fun clear() {
        queue = emptyList(); problemList = emptyList()
        persistQueue(); persistProblems(); changed()
    }

    /**
     * Checks the change against what you see now, then queues it. Invalid changes throw [DomainError] at once, so
     * forms show the same errors as before.
     */
    fun enqueue(type: String, payload: JsonElement, id: String = Ids.uuid()): String {
        if (closed) throw DomainError("Sign in again to save changes.", 401)
        // The same operation is already waiting; the server would ignore a second copy.
        if (queue.any { it.id == id }) return id
        val at = now()
        // Validates against what is shown; throws before anything changes.
        val shown = _view.value
        val next = applyCommand(shown.state, type, payload, id, jsIsoString(at))
        val coalesce = type in COALESCIBLE
        // Rapid taps on the same checkmark or heart keep only the latest unsent choice.
        if (coalesce) {
            val target = (payload as? JsonObject)?.get("id")
            queue = queue.filter { it.type != type || (it.payload as? JsonObject)?.get("id") != target || it.id == sending }
        }
        queue = queue + OutboxItem(id, type, payload, at)
        persistQueue()
        // A new change only needs applying on top of what is shown; a coalesced one is replayed.
        _view.value = if (coalesce) replay() else shown.copy(state = next)
        publishStatus()
        scope.launch { drain() }
        return id
    }

    /** A newer cookbook from the server, for example after a refresh. */
    fun accept(snapshot: Snapshot) {
        if (closed) return
        if (snapshot.householdId != confirmed.householdId || snapshot.revision < confirmed.revision) return
        confirmed = snapshot
        persistConfirmed()
        changed()
    }

    suspend fun refresh() {
        accept(reader.read())
        scope.launch { drain() }
    }

    /** Sends queued changes one at a time, oldest first. */
    suspend fun drain() {
        if (closed) return
        pause()
        passes.withLock { pass() }
    }

    private suspend fun pass() {
        try {
            while (queue.isNotEmpty() && !closed) {
                if (!online()) { lastError = true; publishStatus(); return }
                val item = queue.first()
                sending = item.id; publishStatus()
                val saved = try {
                    beforeSend()
                    sender.send(item.type, item.payload, item.id, confirmed.revision)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    sending = null
                    // Closed (signed out) while waiting: the account's data may already be gone; write nothing back.
                    if (closed) return
                    val failure = asSyncFailure(e)
                    val status = failure.status
                    if (isRejection(status)) {
                        queue = queue.filter { it.id != item.id }
                        problemList = problemList.filter { it.item.id != item.id } + Problem(item, failure.message ?: "This change could not be saved.", status)
                        persistQueue(); persistProblems(); changed()
                        continue
                    }
                    // Offline, signed out or a server error: keep everything and try later.
                    lastError = true; failures++; publishStatus()
                    if (status != 401) retryLater()
                    return
                }
                sending = null; lastError = false; failures = 0
                if (closed) return
                acknowledge(item, saved)
            }
        } finally {
            sending = null
            publishStatus()
        }
    }

    private fun retryLater() {
        val delayMs = retryDelayMs(failures)
        timer?.cancel()
        timer = scope.launch {
            delay(delayMs)
            // This timer has fired; drain() must not cancel it while it runs.
            if (timer === currentCoroutineContext()[Job]) timer = null
            drain()
        }
    }

    /**
     * After the server confirms a change, later queued edits of the same records were based on this device's copy.
     * Their conflict checks are moved to the server's copy, so your own consecutive offline edits never conflict.
     */
    private fun acknowledge(item: OutboxItem, saved: Snapshot) {
        val before = confirmed.state
        val local: State = try {
            applyCommand(before, item.type, item.payload, item.id, jsIsoString(item.at))
        } catch (e: Exception) { saved.state }
        val replacements = HashMap<String, String>()
        val versions = HashMap<String, String>()
        val patch = statePatch(before, local)
        val server = CookbookJson.encodeToJsonElement(State.serializer(), saved.state).jsonObject
        for ((collection, change) in patch.collections) {
            val serverRows = server[collection] as? JsonArray ?: continue
            for (row in change.upsert) {
                val id = row["id"]
                val serverRow = serverRows.firstOrNull { (it as? JsonObject)?.get("id") == id } as? JsonObject ?: continue
                // The server compares form checks by content (sameRecord), so any JSON spelling of its row works.
                replacements[stableJson(row)] = stableJson(serverRow)
                val localAt = versionOf(row)
                val serverAt = versionOf(serverRow)
                if (localAt != null && serverAt != null) versions[localAt] = serverAt
            }
        }
        if ("settings" in patch.values) {
            replacements[stableJson(CookbookJson.encodeToJsonElement(Settings.serializer(), local.settings))] =
                stableJson(CookbookJson.encodeToJsonElement(Settings.serializer(), saved.state.settings))
        }
        queue = queue.filter { it.id != item.id }.map { it.copy(payload = rewriteGuards(it.payload, replacements, versions)) }
        confirmed = saved
        // One transaction, so the saved cookbook and outbox never disagree after a crash.
        try { store.writeConfirmed(account, confirmed, queue) } catch (e: Exception) { }
        changed()
    }

    /** Waits for queued changes; false if any remain (offline or rejected). */
    suspend fun flush(): Boolean {
        drain()
        return queue.isEmpty()
    }

    fun dismiss(problemId: String) {
        problemList = problemList.filter { it.item.id != problemId }
        persistProblems(); publishStatus()
    }

    /** Keep mine: resend a rejected change against the latest version. Returns the new change's id. */
    fun retry(problemId: String, payload: JsonElement): String? {
        val problem = problemList.firstOrNull { it.item.id == problemId } ?: return null
        val next = enqueue(problem.item.type, payload)
        dismiss(problemId)
        return next
    }
}

/** `row.updatedAt ?? row.recipe?.updatedAt`, when it is a string. */
private fun versionOf(row: JsonObject): String? {
    val direct = row["updatedAt"]?.takeUnless { it is JsonNull }
    val value = direct ?: (row["recipe"] as? JsonObject)?.get("updatedAt")
    return (value as? JsonPrimitive)?.takeIf { it.isString }?.content
}

private fun stringValue(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

private fun replaced(text: String, replacements: Map<String, String>): String? =
    try { replacements[stableJson(jsonParse(text))] } catch (e: IllegalArgumentException) { null }

internal fun rewriteGuards(payload: JsonElement, replacements: Map<String, String>, versions: Map<String, String>): JsonElement {
    if (payload !is JsonObject || (replacements.isEmpty() && versions.isEmpty())) return payload
    val next = LinkedHashMap(payload)
    stringValue(next["expectedUpdatedAt"])?.let { at -> versions[at]?.let { next["expectedUpdatedAt"] = JsonPrimitive(it) } }
    stringValue(next["__expected"])?.let { text -> replaced(text, replacements)?.let { next["__expected"] = JsonPrimitive(it) } }
    (next["usage"] as? JsonArray)?.let { usage ->
        next["usage"] = JsonArray(usage.map { u ->
            val expected = (u as? JsonObject)?.let { stringValue(it["expected"]) } ?: return@map u
            val swap = replaced(expected, replacements) ?: return@map u
            JsonObject(LinkedHashMap(u.jsonObject).also { it["expected"] = JsonPrimitive(swap) })
        })
    }
    return JsonObject(next)
}
