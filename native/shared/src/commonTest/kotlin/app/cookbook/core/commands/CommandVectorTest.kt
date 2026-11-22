package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.State
import app.cookbook.core.domain.withoutExtras
import app.cookbook.core.forEachVectorPrefixStep
import app.cookbook.core.forEachVectorStep
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.sameAs
import app.cookbook.core.VectorStep
import app.cookbook.core.skippedScenarios
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Command types ported so far. Task 7 adds the rest. */
val IMPLEMENTED = setOf(
    "recipe.favorite", "recipe.rate", "recipe.update", "recipe.save", "recipe.delete", "recipes.import",
    "draft.save", "draft.delete", "menu.save", "menu.delete", "menu.plan",
)

/** Applies a vector step and checks it against the TypeScript result; returns the state for the next step. */
fun checkStep(previous: State, step: VectorStep): State {
    val result = runCatching { applyCommand(previous, step.type, step.payload, step.operationId, step.clock) }
    val expectedError = step.error
    return if (expectedError != null) {
        val e = assertIs<DomainError>(result.exceptionOrNull(), "expected DomainError \"${expectedError.message}\" but got ${result.exceptionOrNull() ?: "success"}")
        assertEquals(expectedError.message, e.message)
        assertEquals(expectedError.status, e.status)
        previous
    } else {
        val after = result.getOrThrow()
        val actual = CookbookJson.encodeToJsonElement(State.serializer(), after.withoutExtras())
        assertTrue(actual.sameAs(step.after!!), "${step.type}: expected ${step.after} but got $actual")
        after
    }
}

class CommandVectorTest {
    @Test fun commandsMatchTypeScript() {
        forEachVectorStep(implemented = IMPLEMENTED, check = ::checkStep)
        println("SKIPPED_SCENARIOS=$skippedScenarios")
        for (name in listOf("recipes-limit", "recipe-changes", "payload-shapes", "recipes-import", "drafts", "menus", "menus-limit", "same-millisecond")) {
            assertTrue(name !in skippedScenarios, "$name should run")
        }
    }

    /** Scenarios that need later commands still check their steps up to the first one not ported yet. */
    @Test fun scenarioPrefixesMatchTypeScript() {
        val count = forEachVectorPrefixStep(implemented = IMPLEMENTED, check = ::checkStep)
        println("PREFIX_STEPS_CHECKED=$count")
        assertTrue(count > 0)
    }
}
