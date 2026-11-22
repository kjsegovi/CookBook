package app.cookbook.core.api

import app.cookbook.core.domain.State
import app.cookbook.core.domain.initialState
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.sync.SyncFailure
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.content.TextContent
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import io.ktor.utils.io.errors.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeSession(var token: String? = "tok") : Session {
    override suspend fun accessToken() = token
    override val userId: StateFlow<String?> = MutableStateFlow("user-1")
    override suspend fun signIn(email: String, password: String) {}
    override suspend fun signOut() {}
    override suspend fun sendPasswordReset(email: String) {}
}

private val config = BackendConfig("https://x.supabase.co", "pub-key", "https://cookbook.app")
private val json = CookbookJson

private fun stateJson(): JsonObject = json.encodeToJsonElement(State.serializer(), initialState()).jsonObject
private fun snapshotBody(revision: Int = 7, household: String = "h1") = buildJsonObject {
    put("householdId", household); put("revision", revision); put("state", stateJson())
}.toString()
private fun deltaBody(base: Int = 7, revision: Int = 8) = buildJsonObject {
    put("householdId", "h1"); put("baseRevision", base); put("revision", revision)
    putJsonObject("patch") {
        putJsonObject("collections") {}
        putJsonObject("values") {}
        putJsonArray("appendOperations") { add(JsonPrimitive("op-1")) }
    }
}.toString()

private fun MockRequestHandleScope.ok(body: String) =
    respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
private fun MockRequestHandleScope.fail(status: HttpStatusCode, body: String) =
    respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

private fun HttpRequestData.bodyJson(): JsonObject = Json.parseToJsonElement((body as TextContent).text).jsonObject

private class Harness(val session: Session = FakeSession(), handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) {
    val requests = mutableListOf<HttpRequestData>()
    val api = KtorCookbookApi(config, session, HttpClient(MockEngine { request -> requests += request; handler(request) }))
}

class KtorCookbookApiTest {
    @Test fun readWithoutRevisionCallsReadCookbook() = runTest {
        val h = Harness { ok(snapshotBody()) }
        val result = h.api.read(null)
        assertIs<ReadResult.Full>(result)
        assertEquals(7, result.snapshot.revision); assertEquals("h1", result.snapshot.householdId)
        val r = h.requests.single()
        assertEquals(HttpMethod.Post, r.method)
        assertEquals("https://x.supabase.co/rest/v1/rpc/read_cookbook", r.url.toString())
        assertEquals("pub-key", r.headers["apikey"]); assertEquals("Bearer tok", r.headers["Authorization"])
        assertEquals(JsonNull, r.bodyJson()["known_revision"])
        assertTrue(r.bodyJson().containsKey("known_revision"))
    }

    @Test fun readWithRevisionUsesChangesRpc() = runTest {
        val h = Harness { ok(deltaBody()) }
        val result = h.api.read(7)
        assertIs<ReadResult.Changes>(result)
        assertEquals(7, result.baseRevision); assertEquals(8, result.revision); assertEquals("h1", result.householdId)
        assertEquals(listOf("op-1"), result.patch.appendOperations)
        val r = h.requests.single()
        assertEquals("https://x.supabase.co/rest/v1/rpc/read_cookbook_changes", r.url.toString())
        assertEquals(7, r.bodyJson()["since"]!!.jsonPrimitive.content.toInt())
    }

    @Test fun readUnchangedAndFullFromChangesRpc() = runTest {
        val unchanged = Harness { ok("""{"householdId":"h1","revision":7,"unchanged":true}""") }.api.read(7)
        assertEquals(ReadResult.Unchanged(7, "h1"), unchanged)
        assertIs<ReadResult.Full>(Harness { ok(snapshotBody()) }.api.read(3))
    }

    @Test fun missingChangesRpcFallsBackAndIsRemembered() = runTest {
        val h = Harness { request ->
            if (request.url.encodedPath.endsWith("read_cookbook_changes")) fail(HttpStatusCode.NotFound, """{"code":"PGRST202","message":"Could not find the function"}""")
            else ok(snapshotBody())
        }
        assertIs<ReadResult.Full>(h.api.read(5))
        assertEquals(listOf("read_cookbook_changes", "read_cookbook"), h.requests.map { it.url.encodedPath.substringAfterLast('/') })
        assertEquals(5, h.requests[1].bodyJson()["known_revision"]!!.jsonPrimitive.content.toInt())
        assertIs<ReadResult.Full>(h.api.read(6))
        assertEquals(3, h.requests.size)
        assertTrue(h.requests[2].url.encodedPath.endsWith("read_cookbook"))
    }

    @Test fun commandPostsToEdgeFunctionWithHeaders() = runTest {
        val h = Harness { ok(deltaBody()) }
        val payload = buildJsonObject { put("id", "r1") }
        val result = h.api.command("recipe.save", payload, "op-9", 7, "h1")
        assertIs<ReadResult.Changes>(result)
        val r = h.requests.single()
        assertEquals(HttpMethod.Post, r.method)
        assertEquals("https://x.supabase.co/functions/v1/cookbook/command", r.url.toString())
        assertEquals("Bearer tok", r.headers["Authorization"]); assertEquals("pub-key", r.headers["apikey"]); assertEquals("h1", r.headers["x-household-id"])
        assertTrue(r.body.contentType.toString().startsWith("application/json"))
        val body = r.bodyJson()
        assertEquals("recipe.save", body["type"]!!.jsonPrimitive.content); assertEquals(payload, body["payload"])
        assertEquals("op-9", body["id"]!!.jsonPrimitive.content); assertEquals(7, body["revision"]!!.jsonPrimitive.content.toInt())
        assertEquals("delta", body["response"]!!.jsonPrimitive.content)
    }

    @Test fun commandFullSnapshotOnDuplicate() = runTest {
        assertIs<ReadResult.Full>(Harness { ok(snapshotBody()) }.api.command("x", JsonObject(emptyMap()), "i", 1, "h1"))
    }

    @Test fun setFlagCallsRpc() = runTest {
        val h = Harness { ok(deltaBody()) }
        val result = h.api.setFlag("shopping.toggle", "s1", true, "op-2", 7)
        assertIs<ReadResult.Changes>(result)
        val r = h.requests.single()
        assertEquals("https://x.supabase.co/rest/v1/rpc/set_cookbook_flag", r.url.toString())
        val b = r.bodyJson()
        assertEquals("shopping.toggle", b["command_type"]!!.jsonPrimitive.content); assertEquals("s1", b["record_id"]!!.jsonPrimitive.content)
        assertEquals("true", b["checked"]!!.jsonPrimitive.content); assertEquals("op-2", b["operation_id"]!!.jsonPrimitive.content)
        assertEquals("7", b["expected_revision"]!!.jsonPrimitive.content); assertEquals(JsonNull, b["expected_updated_at"])
        assertIs<ReadResult.Full>(Harness { ok(snapshotBody()) }.api.setFlag("recipe.favorite", "r", false, "o", 1, "2026-01-01T00:00:00Z"))
    }

    @Test fun importLinkReturnsSnapshotAndDraftId() = runTest {
        val body = buildJsonObject { put("householdId", "h1"); put("revision", 9); put("state", stateJson()); put("draftId", "d1") }.toString()
        val h = Harness { ok(body) }
        val (snapshot, draft) = h.api.importLink("https://example.com/r", "d1", "h1")
        assertEquals(9, snapshot.revision); assertEquals("d1", draft)
        val r = h.requests.single()
        assertEquals("https://x.supabase.co/functions/v1/cookbook/import", r.url.toString())
        assertEquals("h1", r.headers["x-household-id"])
        assertEquals("https://example.com/r", r.bodyJson()["url"]!!.jsonPrimitive.content)
        assertEquals("d1", r.bodyJson()["id"]!!.jsonPrimitive.content)
    }

    @Test fun photoUrlsMapsReferences() = runTest {
        val h = Harness { ok("""{"urls":{"photo:h1/a.webp":{"url":"https://u/a","fallback":"https://u/a-full"},"photo:h1/b.webp":{"url":"https://u/b"}}}""") }
        val result = h.api.photoUrls(listOf("photo:h1/a.webp", "photo:h1/b.webp"), "thumbnail")
        assertEquals("https://u/a" to "https://u/a-full", result["photo:h1/a.webp"])
        assertEquals("https://u/b" to null, result["photo:h1/b.webp"])
        val r = h.requests.single()
        assertEquals("https://x.supabase.co/functions/v1/cookbook/photos/urls", r.url.toString())
        assertEquals("thumbnail", r.bodyJson()["variant"]!!.jsonPrimitive.content)
        assertEquals(2, r.bodyJson()["references"]!!.toString().split("photo:").size - 1)
    }

    @Test fun uploadPhotoMultipartAndRaw() = runTest {
        val h = Harness { ok("""{"url":"photo:h1/abc.webp"}""") }
        val ref = h.api.uploadPhoto("abc", byteArrayOf(1, 2, 3), "image/webp", byteArrayOf(4, 5))
        assertEquals("photo:h1/abc.webp", ref)
        val r = h.requests.single()
        assertEquals(HttpMethod.Post, r.method)
        assertEquals("https://x.supabase.co/functions/v1/cookbook/photos?id=abc", r.url.toString())
        assertTrue(r.body.contentType.toString().startsWith("multipart/form-data"))
        val raw = Harness { ok("""{"url":"photo:h1/abc.jpg"}""") }
        raw.api.uploadPhoto("abc", byteArrayOf(1, 2, 3), "image/jpeg", null)
        val rr = raw.requests.single()
        assertEquals("image/jpeg", rr.body.contentType.toString())
        assertTrue(rr.body is OutgoingContent.ByteArrayContent)
        assertEquals(listOf<Byte>(1, 2, 3), (rr.body as OutgoingContent.ByteArrayContent).bytes().toList())
    }

    @Test fun exportRestoreAndReminders() = runTest {
        val h = Harness { request ->
            when (request.url.encodedPath.substringAfter("/cookbook/")) {
                "export" -> ok("""{"format":"cookbook-household-v1"}""")
                "restore" -> ok(snapshotBody(3))
                "reminders/begin" -> ok("""{"syncId":"s1"}""")
                else -> ok("""{"status":"done"}""")
            }
        }
        assertEquals("cookbook-household-v1", h.api.export()["format"]!!.jsonPrimitive.content)
        assertEquals(HttpMethod.Get, h.requests[0].method)
        assertEquals(3, h.api.restore(buildJsonObject { put("format", "cookbook-household-v1") }).revision)
        assertEquals("cookbook-household-v1", h.requests[1].bodyJson()["format"]!!.jsonPrimitive.content)
        h.api.remindersBegin("Groceries", "cookbook://app/")
        assertEquals("Groceries", h.requests[2].bodyJson()["list"]!!.jsonPrimitive.content)
        assertEquals("cookbook://app/", h.requests[2].bodyJson()["returnUrl"]!!.jsonPrimitive.content)
        h.api.remindersStatus("a b")
        assertEquals(HttpMethod.Get, h.requests[3].method)
        assertEquals("https://x.supabase.co/functions/v1/cookbook/reminders/status?id=a%20b", h.requests[3].url.toString())
    }

    @Test fun edgeErrorUsesBodyErrorAndStatus() = runTest {
        val h = Harness { fail(HttpStatusCode.Conflict, """{"error":"This recipe changed."}""") }
        val e = assertFailsWith<SyncFailure> { h.api.command("x", JsonObject(emptyMap()), "i", 1, "h1") }
        assertEquals(409, e.status); assertEquals("This recipe changed.", e.message)
    }

    @Test fun rpcErrorCodesMapToStatuses() = runTest {
        suspend fun status(code: String, http: HttpStatusCode = HttpStatusCode.BadRequest): Int =
            assertFailsWith<SyncFailure> { Harness { fail(http, """{"code":"$code","message":"x"}""") }.api.read(null) }.status
        assertEquals(409, status("40001")); assertEquals(404, status("P0002")); assertEquals(403, status("42501"))
        assertEquals(500, status("XX000", HttpStatusCode.InternalServerError))
        val e = assertFailsWith<SyncFailure> { Harness { fail(HttpStatusCode.BadRequest, """{"code":"40001","message":"x"}""") }.api.read(null) }
        assertEquals("x", e.message)
    }

    @Test fun nonJsonErrorUsesGenericMessage() = runTest {
        val e = assertFailsWith<SyncFailure> { Harness { fail(HttpStatusCode.BadGateway, "<html>") }.api.command("x", JsonObject(emptyMap()), "i", 1, "h1") }
        assertEquals(502, e.status)
        assertEquals("Your changes could not be confirmed. Please try again.", e.message)
    }

    @Test fun networkFailureIsStatusZero() = runTest {
        val e = assertFailsWith<SyncFailure> { Harness { throw IOException("offline") }.api.read(null) }
        assertEquals(0, e.status); assertEquals("You’re offline.", e.message, "the website's text, not the exception's")
        assertEquals(0, assertFailsWith<SyncFailure> { Harness { throw IOException("offline") }.api.command("x", JsonObject(emptyMap()), "i", 1, "h1") }.status)
    }

    @Test fun missingTokenFailsWithoutRequest() = runTest {
        val h = Harness(FakeSession(null)) { ok("{}") }
        val e = assertFailsWith<SyncFailure> { h.api.read(null) }
        assertEquals(401, e.status); assertEquals("Please sign in to open your cookbook.", e.message)
        assertEquals(401, assertFailsWith<SyncFailure> { h.api.export() }.status)
        assertTrue(h.requests.isEmpty())
    }

    @Test fun unreadableSuccessBodyIs502() = runTest {
        val e = assertFailsWith<SyncFailure> { Harness { ok("null") }.api.read(null) }
        assertEquals(503, e.status)
        assertEquals(502, assertFailsWith<SyncFailure> { Harness { ok("nope") }.api.command("x", JsonObject(emptyMap()), "i", 1, "h1") }.status)
    }

    @Test fun aCookbookThisVersionCannotDecodeIsA426() = runTest {
        val newer = buildJsonObject { put("householdId", "h1"); put("revision", 9); putJsonObject("state") { put("recipes", "a newer shape") }; put("draftId", "d1") }.toString()
        val update = "This cookbook was saved by a newer version of CookBook. Update the app to continue."
        val command = assertFailsWith<SyncFailure> { Harness { ok(newer) }.api.command("x", JsonObject(emptyMap()), "i", 1, "h1") }
        assertEquals(426, command.status); assertEquals(update, command.message)
        val read = assertFailsWith<SyncFailure> { Harness { ok(newer) }.api.read(null) }
        assertEquals(426, read.status)
        val import = assertFailsWith<SyncFailure> { Harness { ok(newer) }.api.importLink("https://example.com/r", "d1", "h1") }
        assertEquals(426, import.status); assertEquals(update, import.message)
        val restore = assertFailsWith<SyncFailure> { Harness { ok(newer) }.api.restore(buildJsonObject { put("format", "cookbook-household-v1") }) }
        assertEquals(426, restore.status)
    }

    @Test fun resetForgetsTheHousehold() = runTest {
        val h = Harness { request -> if (request.url.encodedPath.endsWith("read_cookbook")) ok(snapshotBody()) else ok("""{"urls":{}}""") }
        h.api.read(null)
        h.api.photoUrls(listOf("photo:h1/a.webp"), "thumbnail")
        assertEquals("h1", h.requests[1].headers["x-household-id"])
        h.api.reset()
        h.api.photoUrls(listOf("photo:h1/a.webp"), "thumbnail")
        assertNull(h.requests[2].headers["x-household-id"], "the previous account's household is never sent")
    }
}
