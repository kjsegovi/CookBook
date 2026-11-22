package app.cookbook.core.store

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver

actual class DriverFactory {
    actual fun create(): SqlDriver = NativeSqliteDriver(CookbookDatabase.Schema, "cookbook.db")
}
