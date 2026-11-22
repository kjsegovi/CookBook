package app.cookbook.core.api

import app.cookbook.core.store.Snapshot
import app.cookbook.core.sync.StatePatch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

sealed interface ReadResult {
    data class Full(val snapshot: Snapshot) : ReadResult
    data class Changes(val baseRevision: Long, val revision: Long, val householdId: String, val patch: StatePatch) : ReadResult
    data class Unchanged(val revision: Long, val householdId: String) : ReadResult
}

/** The cookbook backend. Failures are thrown as [app.cookbook.core.sync.SyncFailure] (status 0 = unreachable). */
interface CookbookApi {
    /** Forgets what was learned about the signed-in account (its household); called on sign-out and account switch. */
    fun reset() {}
    /** `read_cookbook_changes(since)` when [knownRevision] is set, else `read_cookbook`; falls back on 404/PGRST202. */
    suspend fun read(knownRevision: Long?): ReadResult
    suspend fun command(type: String, payload: JsonElement, id: String, revision: Long, household: String): ReadResult
    suspend fun setFlag(
        type: String, recordId: String, checked: Boolean, operationId: String, revision: Long, expectedUpdatedAt: String? = null,
    ): ReadResult
    suspend fun importLink(url: String, id: String, household: String): Pair<Snapshot, String>
    /** reference -> (url, fallback) */
    suspend fun photoUrls(references: List<String>, variant: String): Map<String, Pair<String, String?>>
    /** Returns the `photo:` reference. */
    suspend fun uploadPhoto(id: String, photo: ByteArray, photoType: String, thumbnail: ByteArray?): String
    suspend fun export(): JsonObject
    suspend fun restore(backup: JsonObject): Snapshot
    suspend fun remindersBegin(list: String, returnUrl: String): JsonObject
    suspend fun remindersStatus(syncId: String): JsonObject
}
