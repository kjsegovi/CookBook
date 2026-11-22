package app.cookbook.core.sync

import app.cookbook.core.store.DriverFactory
import app.cookbook.core.store.SqlLocalStore
import kotlinx.coroutines.test.runTest
import kotlin.test.Test

class SqlOutboxRestartTest {
    // One in-memory SQLite connection stands in for the database file both engines open.
    @Test fun outboxSurvivesRestart() = runTest {
        restartScenario(Setup(backgroundScope, online = false, store = SqlLocalStore(DriverFactory().create())))
    }
}
