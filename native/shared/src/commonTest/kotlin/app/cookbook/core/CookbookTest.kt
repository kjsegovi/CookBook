package app.cookbook.core

import app.cookbook.core.domain.DomainError
import app.cookbook.core.sync.SyncFailure
import app.cookbook.core.sync.UPDATE_APP
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CookbookTest {
    private val Cookbook.state get() = view.value!!.state

    @Test fun opensFromTheServerAndRemembersTheAccount() = runTest {
        val w = World(this)
        w.cookbook.open()
        assertEquals("user", w.cookbook.account.value)
        assertEquals(listOf("rice"), w.cookbook.state.recipes.map { it.id })
        assertEquals(w.server.snapshot, w.store.readSnapshot("user"), "saved for opening offline")
        assertEquals("user", w.store.lastAccount())
        assertEquals(listOf("read:null"), w.api.calls)
    }

    @Test fun opensOfflineFromTheSavedCopyOfTheLastAccount() = runTest {
        val first = World(this)
        first.cookbook.open()
        // A new launch: no saved sign-in and no network.
        val api = FakeApi(first.server).also { it.online = false }
        val cookbook = Cookbook(CONFIG, FakeSession(signedIn = false), first.store, api, backgroundScope, { false }, dispatcher = dispatcher)
        cookbook.open()
        assertEquals("user", cookbook.account.value)
        assertEquals(listOf("rice"), cookbook.state.recipes.map { it.id })
        assertTrue(cookbook.status.value.offline)
        assertTrue(cookbook.needsSignIn.value)
    }

    @Test fun withNoSavedCopyAndNoNetworkOpenFails() = runTest {
        val w = World(this)
        w.online = false; w.api.online = false
        val failure = assertFailsWith<SyncFailure> { w.cookbook.open() }
        assertEquals(0, failure.status)
        assertNull(w.cookbook.view.value)
        assertTrue(w.cookbook.status.value.offline)
        val signedOut = World(this, signedIn = false)
        assertEquals(401, assertFailsWith<SyncFailure> { signedOut.cookbook.open() }.status)
        assertTrue(signedOut.cookbook.needsSignIn.value)
    }

    @Test fun reachableButFailingRefreshShowsOffline() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.online = false  // the device thinks it is online, but the server can't be reached
        assertFailsWith<SyncFailure> { w.cookbook.refresh() }
        assertTrue(w.cookbook.status.value.offline)
        w.api.online = true
        w.cookbook.refresh()
        assertFalse(w.cookbook.status.value.offline)
    }

    @Test fun flagsUseTheFastPathAndApplyItsDelta() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.cookbook.save("shopping.toggle", buildJsonObject { put("id", "lemons"); put("checked", true) }).getOrThrow()
        w.cookbook.save("pantry.save", buildJsonObject { put("name", "rice"); put("amount", 1); put("unit", "kg") }).getOrThrow()
        assertTrue(w.cookbook.flush())
        assertEquals(listOf("read:null", "flag:shopping.toggle:lemons:true", "command:pantry.save"), w.api.calls)
        assertEquals(w.server.revision, w.cookbook.view.value!!.revision)
        assertTrue(w.cookbook.state.shopping.single().checked)
        assertEquals(w.server.state, w.cookbook.state)
    }

    @Test fun aDeltaForAnotherRevisionFallsBackToAFullRead() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.staleDelta = true
        w.cookbook.save("shopping.toggle", buildJsonObject { put("id", "lemons"); put("checked", true) }).getOrThrow()
        assertTrue(w.cookbook.flush())
        assertEquals("read:null", w.api.calls.last())
        assertTrue(w.cookbook.state.shopping.single().checked)
    }

    @Test fun invalidChangesFailAtOnce() = runTest {
        val w = World(this)
        assertTrue(w.cookbook.save("pantry.save", buildJsonObject {}).exceptionOrNull() is DomainError, "not open yet")
        w.cookbook.open()
        val failure = w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 9) }).exceptionOrNull()
        assertTrue(failure is DomainError)
        assertEquals(0, w.cookbook.status.value.pending)
    }

    @Test fun signInExpiryKeepsChangesUntilSignedInAgain() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.signedIn = false
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 4) }).getOrThrow()
        assertFalse(w.cookbook.flush())
        assertTrue(w.cookbook.needsSignIn.value)
        assertEquals(1, w.cookbook.status.value.pending)
        assertEquals(1, w.store.outbox("user").size)
        w.api.signedIn = true
        w.cookbook.signIn("qa@example.test", "local-qa-password")
        assertFalse(w.cookbook.needsSignIn.value)
        assertTrue(w.cookbook.flush())
        assertEquals(4, w.server.state.recipes.single().rating)
    }

    @Test fun importOfflineKeepsTheLinkAsADraft() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.goOffline()
        val id = w.cookbook.importLink("https://www.example.com/soup?x=1")
        val draft = w.cookbook.state.drafts.single { it.id == id }
        assertEquals("https://www.example.com/soup?x=1", draft.recipe.sourceUrl)
        assertEquals("example.com", draft.recipe.title)
        assertEquals("https://www.example.com/soup?x=1", draft.text)
        assertEquals(
            listOf("Saved while offline. When you’re back online, use Import a link with this address to bring in the recipe."),
            draft.warnings,
        )
        assertEquals(1, w.cookbook.status.value.pending)
        w.goOnline()
        assertTrue(w.cookbook.flush())
        assertEquals(listOf(id), w.server.state.drafts.map { it.id })
    }

    @Test fun importOnlineFlushesFirstAndAcceptsTheServersCookbook() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 3) }).getOrThrow()
        assertEquals("draft-1", w.cookbook.importLink("https://example.com/soup"))
        assertEquals(listOf("read:null", "command:recipe.rate", "import"), w.api.calls)
        assertEquals(listOf("draft-1"), w.cookbook.state.drafts.map { it.id })
        assertEquals(w.server.revision, w.cookbook.view.value!!.revision)
    }

    @Test fun aServerErrorOnRefreshKeepsTheSavedCopyOpen() = runTest {
        val first = World(this)
        first.cookbook.open()
        first.api.readFailure = 503
        val cookbook = Cookbook(CONFIG, first.session, first.store, first.api, backgroundScope, { true }, dispatcher = dispatcher)
        cookbook.open()  // returns normally
        assertEquals(listOf("rice"), cookbook.state.recipes.map { it.id }, "the saved copy")
        assertEquals("The cookbook is busy. Please try again.", cookbook.lastError.value)
        first.api.readFailure = null
        first.server.edit("pantry.save", buildJsonObject { put("name", "rice"); put("amount", 1); put("unit", "kg") })
        cookbook.refresh()
        assertNull(cookbook.lastError.value, "cleared after a successful read")
        assertEquals(1, cookbook.state.pantry.size)
    }

    @Test fun signingOutDuringASendDoesNotWriteTheAccountBack() = runTest {
        val w = World(this)
        w.cookbook.open()
        val gate = CompletableDeferred<Unit>()
        w.api.gate = gate
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 5) }).getOrThrow()
        runCurrent()
        assertTrue(w.cookbook.status.value.syncing)
        assertTrue(w.cookbook.signOut(force = true))
        gate.complete(Unit)
        runCurrent()
        assertNull(w.store.readSnapshot("user"))
        assertEquals(0, w.store.outbox("user").size)
        assertNull(w.cookbook.view.value)
    }

    @Test fun signOutWaitsForUnsentChangesUnlessForced() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.goOffline()
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 2) }).getOrThrow()
        assertFalse(w.cookbook.signOut())
        assertEquals("user", w.session.userId.value, "nothing happened")
        assertEquals(1, w.store.outbox("user").size)
        assertTrue(w.cookbook.signOut(force = true))
        assertNull(w.session.userId.value)
        assertNull(w.cookbook.view.value)
        assertNull(w.cookbook.account.value)
        assertNull(w.store.readSnapshot("user"))
        assertEquals(0, w.store.outbox("user").size)
        assertNull(w.store.lastAccount())
    }

    @Test fun anExpiredTokenIsRefreshedOnceBeforeAskingToSignIn() = runTest {
        val w = World(this)
        w.session.token = "expired"; w.session.refreshedToken = "fresh"; w.api.requiredToken = "fresh"
        w.cookbook.open()
        assertFalse(w.cookbook.needsSignIn.value)
        assertEquals(1, w.session.refreshes)
        assertEquals(listOf("read:null"), w.api.calls)
        // The token expires again while a change waits: one refresh, then the change is sent.
        w.session.refreshedToken = "fresher"; w.api.requiredToken = "fresher"
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 4) }).getOrThrow()
        assertTrue(w.cookbook.flush())
        assertFalse(w.cookbook.needsSignIn.value)
        assertEquals(2, w.session.refreshes)
        assertEquals(4, w.server.state.recipes.single().rating)
        // A sign-in the server still refuses after refreshing asks to sign in again.
        w.session.refreshedToken = "refused"; w.api.requiredToken = "never"
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 2) }).getOrThrow()
        assertFalse(w.cookbook.flush())
        assertTrue(w.cookbook.needsSignIn.value)
        assertEquals(3, w.session.refreshes)
        assertEquals(1, w.cookbook.status.value.pending)
    }

    @Test fun aDeltaThatCannotBeAppliedFallsBackToAFullRead() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.brokenDelta = true
        w.cookbook.save("shopping.toggle", buildJsonObject { put("id", "lemons"); put("checked", true) }).getOrThrow()
        assertTrue(w.cookbook.flush())
        assertEquals("read:null", w.api.calls.last())
        assertTrue(w.cookbook.state.shopping.single().checked)
        assertTrue(w.cookbook.status.value.problems.isEmpty())
    }

    @Test fun anAnswerThisVersionCannotReadIsShownOnceInsteadOfRetrying() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.api.undecodable = true
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 4) }).getOrThrow()
        assertTrue(w.cookbook.flush())
        val problem = w.cookbook.status.value.problems.single()
        assertEquals(426, problem.status)
        assertEquals(UPDATE_APP, problem.message)
        val calls = w.api.calls.size
        advanceTimeBy(10 * 60_000L)
        runCurrent()
        assertEquals(calls, w.api.calls.size, "no retry loop")
    }

    @Test fun unexpectedFailuresWhileSavingAreReturned() = runTest {
        val w = World(this)
        w.cookbook.open()
        w.server.failNext(409)
        w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 4) }).getOrThrow()
        assertTrue(w.cookbook.flush())
        val problem = w.cookbook.status.value.problems.single()
        w.clockFailure = IllegalArgumentException("Invalid time value")
        val saved = w.cookbook.save("recipe.rate", buildJsonObject { put("id", "rice"); put("rating", 5) })
        assertTrue(saved.exceptionOrNull() is IllegalArgumentException)
        val retried = w.cookbook.retry(problem.item.id, problem.item.payload)
        assertTrue(retried.exceptionOrNull() is IllegalArgumentException)
        assertEquals(0, w.cookbook.status.value.pending)
    }

    @Test fun signingOutOrSwitchingAccountsForgetsTheHousehold() = runTest {
        val w = World(this)
        w.cookbook.open()
        val opened = w.api.resets
        w.session.become("someone-else")
        w.cookbook.open()
        assertEquals("someone-else", w.cookbook.account.value)
        assertEquals(opened + 1, w.api.resets, "switching accounts")
        assertTrue(w.cookbook.signOut(force = true))
        assertEquals(opened + 2, w.api.resets, "signing out")
    }
}
