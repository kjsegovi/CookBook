package app.cookbook.core

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSProcessInfo
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.stringWithContentsOfFile

// The simulator test task is given the resources folder through COOKBOOK_TEST_RESOURCES (see build.gradle.kts).
@OptIn(ExperimentalForeignApi::class)
actual fun readResource(path: String): String {
    val root = NSProcessInfo.processInfo.environment["COOKBOOK_TEST_RESOURCES"] as? String
        ?: error("COOKBOOK_TEST_RESOURCES is not set")
    return NSString.stringWithContentsOfFile("$root/$path", NSUTF8StringEncoding, null)
        ?: error("Test resource not found: $path")
}
