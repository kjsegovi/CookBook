package app.cookbook.core.store

import app.cash.sqldelight.db.SqlDriver

/** Platform SQLite driver; each platform actual has its own constructor. */
expect class DriverFactory {
    fun create(): SqlDriver
}
