package app.cookbook.core.store

import app.cash.sqldelight.db.SqlDriver
import app.cookbook.core.domain.State
import app.cookbook.core.json.CookbookJson
import kotlinx.serialization.json.JsonElement

data class Snapshot(val householdId: String, val revision: Long, val state: State)
data class OutboxItem(val id: String, val type: String, val payload: JsonElement, val at: Long)
data class Problem(val item: OutboxItem, val message: String, val status: Int)
data class PendingUpload(val id: String, val photoPath: String, val thumbPath: String?)

interface LocalStore {
    fun readSnapshot(account: String): Snapshot?
    fun writeSnapshot(account: String, snapshot: Snapshot)
    /** Saves a confirmed cookbook and the outbox left after it in one transaction, so they never disagree. */
    fun writeConfirmed(account: String, snapshot: Snapshot, outbox: List<OutboxItem>)
    fun outbox(account: String): List<OutboxItem>
    fun replaceOutbox(account: String, items: List<OutboxItem>)
    fun problems(account: String): List<Problem>
    fun replaceProblems(account: String, items: List<Problem>)
    fun pendingUploads(account: String): List<PendingUpload>
    fun addPendingUpload(account: String, upload: PendingUpload)
    fun removePendingUpload(id: String)
    fun clearAccount(account: String)
    /** The account that last signed in on this device, so the cookbook opens offline when the sign-in can't be checked. */
    fun lastAccount(): String?
    fun setLastAccount(account: String?)
}

class SqlLocalStore(driver: SqlDriver) : LocalStore {
    private val db = CookbookDatabase(driver)
    private val q = db.cookbookQueries

    override fun readSnapshot(account: String): Snapshot? =
        q.selectSnapshot(account).executeAsOneOrNull()?.let {
            Snapshot(it.household, it.revision, CookbookJson.decodeFromString(State.serializer(), it.state))
        }

    override fun writeSnapshot(account: String, snapshot: Snapshot) {
        q.upsertSnapshot(account, snapshot.householdId, snapshot.revision, CookbookJson.encodeToString(State.serializer(), snapshot.state))
    }

    override fun writeConfirmed(account: String, snapshot: Snapshot, outbox: List<OutboxItem>) {
        db.transaction {
            writeSnapshot(account, snapshot)
            replaceOutbox(account, outbox)
        }
    }

    override fun outbox(account: String): List<OutboxItem> =
        q.selectOutbox(account).executeAsList().map {
            OutboxItem(it.id, it.type, CookbookJson.parseToJsonElement(it.payload), it.at)
        }

    override fun replaceOutbox(account: String, items: List<OutboxItem>) {
        db.transaction {
            q.deleteOutbox(account)
            items.forEach { q.insertOutbox(account, it.id, it.type, CookbookJson.encodeToString(JsonElement.serializer(), it.payload), it.at) }
        }
    }

    override fun problems(account: String): List<Problem> =
        q.selectProblems(account).executeAsList().map {
            Problem(OutboxItem(it.id, it.type, CookbookJson.parseToJsonElement(it.payload), it.at), it.message, it.status.toInt())
        }

    override fun replaceProblems(account: String, items: List<Problem>) {
        db.transaction {
            q.deleteProblems(account)
            items.forEach {
                q.insertProblem(it.item.id, account, it.item.type, CookbookJson.encodeToString(JsonElement.serializer(), it.item.payload), it.item.at, it.message, it.status.toLong())
            }
        }
    }

    override fun pendingUploads(account: String): List<PendingUpload> =
        q.selectUploads(account).executeAsList().map { PendingUpload(it.id, it.photo_path, it.thumb_path) }

    override fun addPendingUpload(account: String, upload: PendingUpload) {
        q.insertUpload(upload.id, account, upload.photoPath, upload.thumbPath)
    }

    override fun removePendingUpload(id: String) {
        q.deleteUpload(id)
    }

    override fun clearAccount(account: String) {
        db.transaction {
            q.deleteSnapshot(account)
            q.deleteOutbox(account)
            q.deleteProblems(account)
            q.deleteUploads(account)
        }
    }

    override fun lastAccount(): String? = q.selectPreference(LAST_ACCOUNT).executeAsOneOrNull()

    override fun setLastAccount(account: String?) {
        if (account == null) q.deletePreference(LAST_ACCOUNT) else q.upsertPreference(LAST_ACCOUNT, account)
    }

    private companion object { const val LAST_ACCOUNT = "last-account" }
}
