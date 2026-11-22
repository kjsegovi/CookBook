package app.cookbook.core.sync

import app.cookbook.core.commands.applyCommand
import app.cookbook.core.commands.jsIsoString
import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.State
import app.cookbook.core.domain.initialState
import app.cookbook.core.store.LocalStore
import app.cookbook.core.store.OutboxItem
import app.cookbook.core.store.PendingUpload
import app.cookbook.core.store.Problem
import app.cookbook.core.store.Snapshot
import kotlinx.serialization.json.JsonElement

const val HOUSEHOLD = "10000000-0000-4000-8000-000000000001"

/**
 * In-memory stand-in for the cookbook server (store.ts `execute`): commands run against the latest cookbook with the
 * server's own clock, a repeated operation id returns the cookbook unchanged, and command errors carry their status.
 */
class FakeServer(seed: State = initialState()) : CommandSender, SnapshotReader {
    var state: State = seed
        private set
    var revision = 0L
        private set
    var online = true
    val sent = mutableListOf<String>()
    private val applied = seed.operations.toMutableSet()
    private val failures = ArrayDeque<Int>()
    private var others = 0

    /** The server's clock, well after the seed and device clocks so its timestamps never coincide with theirs. */
    var clock = 1_800_000_000_000L

    val snapshot: Snapshot get() = Snapshot(HOUSEHOLD, revision, state)

    /** The next send fails with [status] before reaching the cookbook. */
    fun failNext(status: Int) { failures.addLast(status) }

    override suspend fun send(type: String, payload: JsonElement, id: String, revision: Long): Snapshot {
        if (!online) throw SyncFailure("Failed to fetch", 0)
        failures.removeFirstOrNull()?.let { throw SyncFailure("The server could not save this change.", it) }
        sent += type
        return command(type, payload, id)
    }

    override suspend fun read(): Snapshot {
        if (!online) throw SyncFailure("Failed to fetch", 0)
        return snapshot
    }

    /** A change made on another device. */
    fun edit(type: String, payload: JsonElement, id: String = "other-device-${++others}"): Snapshot = command(type, payload, id)

    private fun command(type: String, payload: JsonElement, id: String): Snapshot {
        if (!Regex("^[a-zA-Z0-9_-]{8,100}$").matches(id)) throw SyncFailure("A valid action identifier is required.", 400)
        if (id in state.operations || id in applied) return snapshot
        val next = try {
            clock += 1000
            applyCommand(state, type, payload, id, jsIsoString(clock))
        } catch (e: DomainError) {
            throw SyncFailure(e.message ?: "This change could not be saved.", e.status)
        }
        state = next
        revision++
        applied += id
        return snapshot
    }
}

/** LocalStore kept in memory, with the same contract as SqlLocalStore. */
class MemoryStore : LocalStore {
    private val snapshots = mutableMapOf<String, Snapshot>()
    private val outboxes = mutableMapOf<String, List<OutboxItem>>()
    private val problemLists = mutableMapOf<String, List<Problem>>()
    private val uploads = mutableMapOf<String, MutableList<Pair<String, PendingUpload>>>()

    override fun readSnapshot(account: String) = snapshots[account]
    override fun writeSnapshot(account: String, snapshot: Snapshot) { snapshots[account] = snapshot }
    override fun outbox(account: String) = outboxes[account] ?: emptyList()
    override fun replaceOutbox(account: String, items: List<OutboxItem>) {
        require(items.map { it.id }.toSet().size == items.size) { "Duplicate outbox id" }
        outboxes[account] = items.toList()
    }
    override fun problems(account: String) = problemLists[account] ?: emptyList()
    override fun replaceProblems(account: String, items: List<Problem>) {
        require(items.map { it.item.id }.toSet().size == items.size) { "Duplicate problem id" }
        problemLists[account] = items.toList()
    }
    override fun pendingUploads(account: String) = uploads[account]?.map { it.second } ?: emptyList()
    override fun addPendingUpload(account: String, upload: PendingUpload) {
        uploads.getOrPut(account) { mutableListOf() } += account to upload
    }
    override fun removePendingUpload(id: String) { uploads.values.forEach { list -> list.removeAll { it.second.id == id } } }
    override fun clearAccount(account: String) {
        snapshots.remove(account); outboxes.remove(account); problemLists.remove(account); uploads.remove(account)
    }
    private var last: String? = null
    override fun lastAccount() = last
    override fun setLastAccount(account: String?) { last = account }
}
