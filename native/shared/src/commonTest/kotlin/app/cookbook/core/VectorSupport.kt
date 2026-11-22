package app.cookbook.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Reads a test resource such as `vectors/recipes-basic.json` as text. */
expect fun readResource(path: String): String

data class VectorError(val message: String, val status: Int)

data class VectorStep(
    val type: String,
    val payload: JsonObject,
    val operationId: String,
    val clock: String,
    val after: JsonObject?,
    val patch: JsonObject?,
    val error: VectorError?,
)

data class Vector(val name: String, val initial: JsonObject, val steps: List<VectorStep>)

/** Scenario files, as written by `npm run vectors:export` from the TypeScript commands. */
val vectorNames = listOf(
    "recipes-basic", "recipes-limit", "recipes-import", "drafts", "menus", "menus-limit", "pantry-ingredients",
    "shopping", "planning", "cooking", "settings", "coercion", "same-millisecond",
)

private fun objectOrNull(element: kotlinx.serialization.json.JsonElement?): JsonObject? =
    if (element == null || element is JsonNull) null else element.jsonObject

fun parseVector(text: String): Vector {
    val root = Json.parseToJsonElement(text).jsonObject
    val steps = (root.getValue("steps") as JsonArray).map { element ->
        val step = element.jsonObject
        val error = objectOrNull(step["error"])?.let {
            VectorError(it.getValue("message").jsonPrimitive.content, it.getValue("status").jsonPrimitive.int)
        }
        VectorStep(
            type = step.getValue("type").jsonPrimitive.content,
            payload = step.getValue("payload").jsonObject,
            operationId = step.getValue("operationId").jsonPrimitive.content,
            clock = step.getValue("clock").jsonPrimitive.content,
            after = objectOrNull(step["after"]),
            patch = objectOrNull(step["patch"]),
            error = error,
        )
    }
    return Vector(root.getValue("name").jsonPrimitive.content, root.getValue("initial").jsonObject, steps)
}

fun loadVectors(): List<Vector> = vectorNames.map { parseVector(readResource("vectors/$it.json")) }
