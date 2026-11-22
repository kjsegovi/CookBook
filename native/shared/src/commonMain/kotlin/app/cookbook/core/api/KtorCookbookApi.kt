package app.cookbook.core.api

import app.cookbook.core.domain.State
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.store.Snapshot
import app.cookbook.core.sync.StatePatch
import app.cookbook.core.sync.SyncFailure
import io.ktor.client.HttpClient
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.content.TextContent
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

private const val TIMEOUT_MS = 20_000L
private const val SIGN_IN = "Please sign in to open your cookbook."
private const val LOAD_FAILED = "Your cookbook could not be loaded. Please try again."
private const val SAVE_FAILED = "Your changes could not be confirmed. Please try again."
private const val UNREADABLE = "The cookbook response could not be read. Please try again."
private const val OFFLINE = "The cookbook could not be reached. Check your connection and try again."

class KtorCookbookApi(
    private val config: BackendConfig,
    private val session: Session,
    private val client: HttpClient,
) : CookbookApi {
    private var changesAvailable = true
    private var household: String? = null
    private val base = config.supabaseUrl.trimEnd('/')

    // --- transport ---

    private class Raw(val status: Int, val body: JsonElement?)

    private suspend fun send(
        url: String, method: HttpMethod, token: String, household: String?, body: Any?, rpc: Boolean,
    ): Raw {
        try {
            // Default dispatcher: the timeout runs on real time even under a test scheduler.
            return withContext(Dispatchers.Default) { withTimeout(TIMEOUT_MS) {
                val response = client.request(url) {
                    this.method = method
                    header("apikey", config.publishableKey)
                    header(HttpHeaders.Authorization, "Bearer $token")
                    if (!rpc && !household.isNullOrEmpty()) header("x-household-id", household)
                    if (body != null) setBody(body)
                }
                val text = response.bodyAsText()
                Raw(response.status.value, runCatching { Json.parseToJsonElement(text) }.getOrNull())
            } }
        } catch (e: TimeoutCancellationException) {
            throw SyncFailure(OFFLINE, 0)
        } catch (e: CancellationException) {
            throw e
        } catch (e: SyncFailure) {
            throw e
        } catch (e: Exception) {
            throw SyncFailure(e.message?.takeIf { it.isNotBlank() } ?: OFFLINE, 0)
        }
    }

    private suspend fun token(): String = session.accessToken() ?: throw SyncFailure(SIGN_IN, 401)

    private fun JsonElement?.field(name: String): String? =
        ((this as? JsonObject)?.get(name) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    private fun fail(raw: Raw, generic: String): Nothing {
        val code = raw.body.field("code")
        val status = when (code) { "40001" -> 409; "P0002" -> 404; "42501" -> 403; else -> raw.status }
        throw SyncFailure(raw.body.field("error") ?: raw.body.field("message") ?: generic, status)
    }

    private fun json(value: JsonElement) = TextContent(value.toString(), ContentType.Application.Json)

    /** Returns null only when [missingAsNull] and the function does not exist on the server. */
    private suspend fun rpc(name: String, args: JsonObject, missingAsNull: Boolean = false): JsonElement? {
        val raw = send("$base/rest/v1/rpc/$name", HttpMethod.Post, token(), null, json(args), rpc = true)
        if (raw.status !in 200..299) {
            if (missingAsNull && (raw.status == 404 && raw.body.field("code") != "P0002" || raw.body.field("code") == "PGRST202")) return null
            fail(raw, LOAD_FAILED)
        }
        val body = raw.body
        if (body == null || body is JsonNull) throw SyncFailure(LOAD_FAILED, 503)
        return body
    }

    private suspend fun edge(
        path: String, method: HttpMethod = HttpMethod.Get, body: Any? = null, household: String? = this.household,
    ): JsonObject {
        val raw = send("$base/functions/v1/cookbook/$path", method, token(), household, body, rpc = false)
        if (raw.status !in 200..299) fail(raw, SAVE_FAILED)
        return raw.body as? JsonObject ?: throw SyncFailure(UNREADABLE, 502)
    }

    // --- parsing ---

    private fun snapshot(o: JsonObject): Snapshot? {
        val state = o["state"] as? JsonObject ?: return null
        val id = o.field("householdId") ?: return null
        val revision = (o["revision"] as? JsonPrimitive)?.longOrNull ?: return null
        return Snapshot(id, revision, CookbookJson.decodeFromJsonElement(State.serializer(), state)).also { household = id }
    }

    private fun requireSnapshot(o: JsonObject) = snapshot(o) ?: throw SyncFailure(UNREADABLE, 502)

    private fun result(element: JsonElement): ReadResult {
        val o = element as? JsonObject ?: throw SyncFailure(UNREADABLE, 502)
        try {
            val id = o.field("householdId")
            val revision = (o["revision"] as? JsonPrimitive)?.longOrNull
            if ((o["unchanged"] as? JsonPrimitive)?.booleanOrNull == true && id != null && revision != null) {
                household = id
                return ReadResult.Unchanged(revision, id)
            }
            if (o["patch"] is JsonObject && id != null && revision != null) {
                val baseRevision = (o["baseRevision"] as? JsonPrimitive)?.longOrNull
                if (baseRevision != null) {
                    household = id
                    return ReadResult.Changes(baseRevision, revision, id, CookbookJson.decodeFromJsonElement(StatePatch.serializer(), o["patch"]!!))
                }
            }
            snapshot(o)?.let { return ReadResult.Full(it) }
        } catch (e: SyncFailure) {
            throw e
        } catch (e: Exception) {
            throw SyncFailure(UNREADABLE, 502)
        }
        throw SyncFailure(UNREADABLE, 502)
    }

    // --- CookbookApi ---

    override suspend fun read(knownRevision: Long?): ReadResult {
        if (knownRevision != null && changesAvailable) {
            val changes = rpc("read_cookbook_changes", buildJsonObject { put("since", knownRevision) }, missingAsNull = true)
            if (changes != null) return result(changes)
            changesAvailable = false
        }
        return result(rpc("read_cookbook", buildJsonObject { put("known_revision", knownRevision) })!!)
    }

    override suspend fun command(type: String, payload: JsonElement, id: String, revision: Long, household: String): ReadResult {
        val body = buildJsonObject { put("type", type); put("payload", payload); put("id", id); put("revision", revision); put("response", "delta") }
        return result(edge("command", HttpMethod.Post, json(body), household))
    }

    override suspend fun setFlag(
        type: String, recordId: String, checked: Boolean, operationId: String, revision: Long, expectedUpdatedAt: String?,
    ): ReadResult = result(rpc("set_cookbook_flag", buildJsonObject {
        put("command_type", type); put("record_id", recordId); put("checked", checked); put("operation_id", operationId)
        put("expected_revision", revision); put("expected_updated_at", expectedUpdatedAt)
    })!!)

    override suspend fun importLink(url: String, id: String, household: String): Pair<Snapshot, String> {
        val o = edge("import", HttpMethod.Post, json(buildJsonObject { put("url", url); put("id", id) }), household)
        return requireSnapshot(o) to (o.field("draftId") ?: id)
    }

    override suspend fun photoUrls(references: List<String>, variant: String): Map<String, Pair<String, String?>> {
        val body = buildJsonObject {
            put("references", kotlinx.serialization.json.JsonArray(references.map { JsonPrimitive(it) })); put("variant", variant)
        }
        val urls = edge("photos/urls", HttpMethod.Post, json(body))["urls"] as? JsonObject ?: throw SyncFailure(UNREADABLE, 502)
        return urls.mapNotNull { (reference, entry) ->
            entry.field("url")?.let { reference to (it to entry.field("fallback")) }
        }.toMap()
    }

    override suspend fun uploadPhoto(id: String, photo: ByteArray, photoType: String, thumbnail: ByteArray?): String {
        val body: Any = if (thumbnail != null) MultiPartFormDataContent(formData {
            append("photo", photo, Headers.build {
                append(HttpHeaders.ContentType, photoType); append(HttpHeaders.ContentDisposition, "filename=\"recipe.webp\"")
            })
            append("thumbnail", thumbnail, Headers.build {
                append(HttpHeaders.ContentType, "image/webp"); append(HttpHeaders.ContentDisposition, "filename=\"recipe.thumb.webp\"")
            })
        }) else ByteArrayContent(photo, ContentType.parse(photoType))
        return edge("photos?id=" + id.encodeURLParameter(), HttpMethod.Post, body).field("url") ?: throw SyncFailure(UNREADABLE, 502)
    }

    override suspend fun export(): JsonObject = edge("export")

    override suspend fun restore(backup: JsonObject): Snapshot = requireSnapshot(edge("restore", HttpMethod.Post, json(backup)))

    override suspend fun remindersBegin(list: String, returnUrl: String): JsonObject =
        edge("reminders/begin", HttpMethod.Post, json(buildJsonObject { put("list", list); put("returnUrl", returnUrl) }))

    override suspend fun remindersStatus(syncId: String): JsonObject = edge("reminders/status?id=" + syncId.encodeURLParameter())
}
