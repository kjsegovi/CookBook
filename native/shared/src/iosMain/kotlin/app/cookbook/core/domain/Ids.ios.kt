package app.cookbook.core.domain

import platform.Foundation.NSUUID

actual object Ids {
    actual fun uuid(): String = NSUUID().UUIDString().lowercase()
}
