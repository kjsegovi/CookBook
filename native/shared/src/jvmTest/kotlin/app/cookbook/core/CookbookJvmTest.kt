package app.cookbook.core

import app.cookbook.core.store.DriverFactory
import app.cookbook.core.store.LocalStore
import app.cookbook.core.store.OutboxItem
import app.cookbook.core.store.Snapshot
import app.cookbook.core.store.SqlLocalStore
import app.cookbook.core.sync.FakeServer
import app.cookbook.core.sync.MemoryStore
import app.cookbook.core.sync.pantry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CookbookJvmTest {
    @Test fun anUnreadableSavedCopyIsReadAgainAndTheOutboxKept() = runTest {
        val driver = DriverFactory().create()
        val store = SqlLocalStore(driver)
        val server = FakeServer(shoppingSeed())
        val session = FakeSession()
        val api = FakeApi(server, session)
        val first = Cookbook(CONFIG, session, store, api, backgroundScope, { api.online }, dispatcher = dispatcher)
        first.open()
        api.online = false
        first.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 4) }).getOrThrow()
        assertFalse(first.flush())
        // The saved copy is damaged (or written by a newer version).
        driver.execute(null, "UPDATE snapshot SET state = '{\"recipes\": 7'", 0)
        api.online = true
        api.calls.clear()
        val reopened = Cookbook(CONFIG, session, store, api, backgroundScope, { api.online }, dispatcher = dispatcher)
        reopened.open()
        assertEquals("read:null", api.calls.first(), "a full read")
        assertEquals(1, store.outbox("user").size, "the unsent change survives")
        assertEquals(4, reopened.view.value!!.state.recipes.single().rating, "and is still shown")
        assertTrue(reopened.flush())
        assertEquals(4, server.state.recipes.single().rating)
    }

    @Test fun cookbookWorkRunsOneAtATimeOffTheCallersThread() = runBlocking {
        val caller = Thread.currentThread()
        val threads = Collections.synchronizedSet(mutableSetOf<Thread>())
        val active = AtomicInteger()
        var overlapped = false
        val inner = MemoryStore()
        fun <T> record(block: () -> T): T {
            threads += Thread.currentThread()
            if (active.incrementAndGet() > 1) overlapped = true
            try { Thread.sleep(1); return block() } finally { active.decrementAndGet() }
        }
        val store = object : LocalStore by inner {
            override fun readSnapshot(account: String) = record { inner.readSnapshot(account) }
            override fun writeSnapshot(account: String, snapshot: Snapshot) = record { inner.writeSnapshot(account, snapshot) }
            override fun outbox(account: String) = record { inner.outbox(account) }
            override fun replaceOutbox(account: String, items: List<OutboxItem>) = record { inner.replaceOutbox(account, items) }
            override fun writeConfirmed(account: String, snapshot: Snapshot, outbox: List<OutboxItem>) =
                record { inner.writeConfirmed(account, snapshot, outbox) }
        }
        val server = FakeServer(shoppingSeed())
        val session = FakeSession()
        val scope = CoroutineScope(SupervisorJob())
        try {
            // The default dispatcher: the cookbook confines its own work.
            val cookbook = Cookbook(CONFIG, session, store, FakeApi(server, session), scope, { true })
            cookbook.open()
            (1..20).map { i ->
                async(Dispatchers.Default) { cookbook.save("pantry.save", pantry("p$i", "item $i", 1, "kg")).getOrThrow() }
            }.awaitAll()
            assertTrue(cookbook.flush())
            assertEquals(20, server.state.pantry.size, "no change lost")
            assertEquals(0, cookbook.status.value.pending)
            assertFalse(caller in threads, "store work ran on the caller's thread")
            assertFalse(overlapped, "store work overlapped")
        } finally {
            scope.cancel()
        }
    }
}
