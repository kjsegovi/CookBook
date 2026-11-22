package app.cookbook.core.domain

actual object Ids {
    actual fun uuid(): String = java.util.UUID.randomUUID().toString()
}
