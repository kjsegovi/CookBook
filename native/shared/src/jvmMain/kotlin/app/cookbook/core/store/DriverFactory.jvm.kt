package app.cookbook.core.store

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver

/** [url] defaults to an in-memory database; pass `jdbc:sqlite:<file>` for a file. */
actual class DriverFactory(private val url: String = JdbcSqliteDriver.IN_MEMORY) {
    actual fun create(): SqlDriver {
        val driver = JdbcSqliteDriver(url)
        CookbookDatabase.Schema.create(driver)
        return driver
    }
}
