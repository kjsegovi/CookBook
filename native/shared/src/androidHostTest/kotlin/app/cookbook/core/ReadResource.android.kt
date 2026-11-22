package app.cookbook.core

private object ResourceAnchor

actual fun readResource(path: String): String {
    val stream = ResourceAnchor::class.java.classLoader!!.getResourceAsStream(path)
        ?: error("Test resource not found: $path")
    return stream.use { it.readBytes().decodeToString() }
}
