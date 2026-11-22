package app.cookbook.core

import app.cookbook.core.domain.State
import app.cookbook.core.json.CookbookJson
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

/** Scenario files, listed in `vectors/index.json` by `npm run vectors:export` from the TypeScript commands. */
val vectorNames: List<String> by lazy {
    (Json.parseToJsonElement(readResource("vectors/index.json")) as JsonArray).map { it.jsonPrimitive.content }
}

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

private val vectorCache: List<Vector> by lazy { vectorNames.map { parseVector(readResource("vectors/$it.json")) } }

fun loadVectors(): List<Vector> = vectorCache

/** Scenarios [forEachVectorStep] skipped because a step type is not implemented yet, with the missing types. */
val skippedScenarios: MutableMap<String, Set<String>> = linkedMapOf()

private fun decodeState(o: JsonObject): State = CookbookJson.decodeFromJsonElement(State.serializer(), o)

private fun runSteps(vector: Vector, steps: List<VectorStep>, check: (previous: State, step: VectorStep) -> State) {
    var state = decodeState(vector.initial)
    steps.forEachIndexed { index, step ->
        state = try {
            check(state, step)
        } catch (e: Throwable) {
            throw AssertionError("${vector.name} step ${index + 1} (${step.type}, ${step.operationId}): ${e.message}", e)
        }
    }
}

/**
 * Runs every step of every scenario whose step types are all in [implemented], starting from the scenario's
 * `initial` state and passing the state [check] returns on to the next step. Other scenarios are recorded in
 * [skippedScenarios].
 */
fun forEachVectorStep(implemented: Set<String>, check: (previous: State, step: VectorStep) -> State) {
    for (vector in loadVectors()) {
        val missing = vector.steps.map { it.type }.filter { it !in implemented }.toSet()
        if (missing.isNotEmpty()) {
            skippedScenarios[vector.name] = missing
            continue
        }
        skippedScenarios.remove(vector.name)
        runSteps(vector, vector.steps, check)
    }
}

/** Like [forEachVectorStep], but runs each scenario's steps up to (not including) its first unimplemented step. */
fun forEachVectorPrefixStep(implemented: Set<String>, check: (previous: State, step: VectorStep) -> State): Int {
    var count = 0
    for (vector in loadVectors()) {
        val prefix = vector.steps.takeWhile { it.type in implemented }
        runSteps(vector, prefix, check)
        count += prefix.size
    }
    return count
}
