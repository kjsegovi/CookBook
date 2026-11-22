package app.cookbook.core.store

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver

/** [url] defaults to an in-memory database; pass `jdbc:sqlite:<file>` for a file. */
actual class DriverFactory(private val url: String = JdbcSqliteDriver.IN_MEMORY) {
    actual fun create(): SqlDriver {
        val driver = JdbcSqliteDriver(url)
        val current = driver.executeQuery(null, "PRAGMA user_version", { c ->
            app.cash.sqldelight.db.QueryResult.Value(if (c.next().value) c.getLong(0) ?: 0L else 0L)
        }, 0).value
        val target = CookbookDatabase.Schema.version
        if (current == 0L) {
            CookbookDatabase.Schema.create(driver)
            driver.execute(null, "PRAGMA user_version = $target", 0)
        } else if (current < target) {
            CookbookDatabase.Schema.migrate(driver, current, target)
            driver.execute(null, "PRAGMA user_version = $target", 0)
        }
        return driver
    }
}
