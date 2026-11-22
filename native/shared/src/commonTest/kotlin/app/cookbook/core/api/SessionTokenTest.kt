package app.cookbook.core.api

import kotlinx.coroutines.test.runTest
import kotlinx.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

/** A saved sign-in whose token expires at [expiresAt]; refreshing hands out the next token. */
private class ExpiringSession(var expiresAt: Instant?, var token: String = "old", val failRefresh: Boolean = false) {
    var refreshes = 0
    suspend fun refresh() {
        refreshes++
        if (failRefresh) throw IOException("offline")
        token = "new"; expiresAt = expiresAt?.plus(60.minutes)
    }
    suspend fun fresh(now: Instant) = freshAccessToken(expiresAt, now, { refresh() }, { if (expiresAt == null) null else token })
}

class SessionTokenTest {
    private val now = Instant.fromEpochMilliseconds(1_800_000_000_000L)

    @Test fun aTokenAboutToExpireIsRefreshedFirst() = runTest {
        val expired = ExpiringSession(now - 5.minutes)
        assertEquals("new", expired.fresh(now))
        assertEquals(1, expired.refreshes)
        val soon = ExpiringSession(now + 30.seconds)
        assertEquals("new", soon.fresh(now))
        assertEquals(1, soon.refreshes)
    }

    @Test fun aValidTokenIsUsedAsItIs() = runTest {
        val valid = ExpiringSession(now + 10.minutes)
        assertEquals("old", valid.fresh(now))
        assertEquals(0, valid.refreshes)
    }

    @Test fun aRefreshThatFailsKeepsTheSavedToken() = runTest {
        val offline = ExpiringSession(now - 5.minutes, failRefresh = true)
        assertEquals("old", offline.fresh(now), "the server decides; a 401 then retries once")
        assertEquals(1, offline.refreshes)
    }

    @Test fun noSavedSignInHasNoToken() = runTest {
        val none = ExpiringSession(null)
        assertNull(none.fresh(now))
        assertEquals(0, none.refreshes)
    }
}
