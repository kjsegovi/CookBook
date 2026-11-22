package app.cookbook.core

import app.cookbook.core.api.BackendConfig
import app.cookbook.core.api.InMemorySessionStorage
import app.cookbook.core.api.KtorCookbookApi
import app.cookbook.core.api.ReadResult
import app.cookbook.core.api.SupabaseSession
import app.cookbook.core.domain.Ids
import app.cookbook.core.domain.Recipe
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.store.DriverFactory
import app.cookbook.core.store.SqlLocalStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assume
import java.util.concurrent.Executors
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Runs the shared core against the synthetic backend (`node tests/fixtures/preview-backend.mjs`), only when
 * COOKBOOK_CONTRACT_URL is set. Sign-in goes through supabase-kt; data through KtorCookbookApi. Start a fresh fixture
 * for each run: it keeps its edits in memory.
 */
class ContractTest {
    private val url: String? = System.getenv("COOKBOOK_CONTRACT_URL")?.takeIf { it.isNotBlank() }

    private fun recipeSave(recipe: Recipe, title: String): JsonObject = JsonObject(
        CookbookJson.encodeToJsonElement(Recipe.serializer(), recipe).jsonObject +
            mapOf("title" to JsonPrimitive(title), "expectedUpdatedAt" to JsonPrimitive(recipe.updatedAt)),
    )

    @Test fun cookbookAgainstSyntheticBackend() {
        Assume.assumeTrue("COOKBOOK_CONTRACT_URL is not set", url != null)
        val base = url!!
        val config = BackendConfig(base, "local-preview", "http://127.0.0.1:4173")
        val executor = Executors.newSingleThreadExecutor()
        val dispatcher = executor.asCoroutineDispatcher()
        val client = HttpClient(OkHttp)
        val scope = CoroutineScope(SupervisorJob() + dispatcher)
        try {
            runBlocking(dispatcher) {
                var online = true
                val store = SqlLocalStore(DriverFactory().create())
                val session = SupabaseSession(config, InMemorySessionStorage())
                val cookbook = Cookbook(config, session, store, KtorCookbookApi(config, session, client), scope, { online })

                // Sign in through supabase-kt, then open: 54 seeded recipes.
                cookbook.signIn("qa@example.test", "local-qa-password")
                assertFalse(cookbook.needsSignIn.value)
                val account = assertNotNull(cookbook.account.value)
                assertEquals(session.userId.value, account)
                assertEquals(54, cookbook.view.value!!.state.recipes.size)

                // A command reaches the server: one revision later.
                val start = cookbook.view.value!!.revision
                cookbook.save("recipe.rate", buildJsonObject { put("id", "lemon-rice"); put("rating", 4) }).getOrThrow()
                assertTrue(cookbook.flush())
                assertEquals(start + 1, cookbook.view.value!!.revision)
                assertEquals(4, cookbook.view.value!!.state.recipes.first { it.id == "lemon-rice" }.rating)

                // Offline the change waits in the outbox; back online it is sent through the flag fast path.
                online = false
                cookbook.connectivityChanged()
                val item = cookbook.view.value!!.state.shopping.first()
                cookbook.save("shopping.toggle", buildJsonObject { put("id", item.id); put("checked", !item.checked) }).getOrThrow()
                assertFalse(cookbook.flush())
                assertEquals(1, cookbook.status.value.pending)
                assertTrue(cookbook.status.value.offline)
                assertEquals(1, store.outbox(account).size)
                online = true
                cookbook.connectivityChanged()
                assertTrue(cookbook.flush())
                assertEquals(0, cookbook.status.value.pending)
                assertEquals(start + 2, cookbook.view.value!!.revision)
                assertEquals(!item.checked, cookbook.view.value!!.state.shopping.first { it.id == item.id }.checked)

                // Someone else saves the same recipe first: this device's edit comes back as a 409 problem.
                online = false
                val mine = cookbook.view.value!!.state.recipes.first { it.id == "lemon-rice" }
                cookbook.save("recipe.save", recipeSave(mine, "Mine")).getOrThrow()
                val second = SupabaseSession(config, InMemorySessionStorage())
                second.signIn("qa2@example.test", "local-qa-password")
                val other = KtorCookbookApi(config, second, client)
                val latest = (other.read(null) as ReadResult.Full).snapshot
                val theirs = latest.state.recipes.first { it.id == "lemon-rice" }
                other.command("recipe.save", recipeSave(theirs, "Theirs"), Ids.uuid(), latest.revision, latest.householdId)
                online = true
                cookbook.connectivityChanged()
                assertTrue(cookbook.flush())
                val problem = cookbook.status.value.problems.single()
                assertEquals(409, problem.status)
                cookbook.refresh()
                assertEquals("Theirs", cookbook.view.value!!.state.recipes.first { it.id == "lemon-rice" }.title)

                // A new launch with no network and no sign-in opens the saved copy of the last account.
                val offline = Cookbook(
                    config, SupabaseSession(config, InMemorySessionStorage()), store,
                    KtorCookbookApi(config, SupabaseSession(config, InMemorySessionStorage()), client), scope, { false },
                )
                offline.open()
                assertEquals(account, offline.account.value)
                assertEquals(54, offline.view.value!!.state.recipes.size)
                assertTrue(offline.status.value.offline)
                assertTrue(offline.needsSignIn.value)

                // Signing out forgets this device's copy.
                assertTrue(cookbook.signOut())
                assertNull(cookbook.view.value)
                assertNull(store.readSnapshot(account))
                assertNull(store.lastAccount())
                assertNull(session.userId.value)
            }
        } finally {
            scope.cancel()
            client.close()
            dispatcher.close()
        }
    }
}
