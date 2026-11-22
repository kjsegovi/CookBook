package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.State
import app.cookbook.core.domain.withoutExtras
import app.cookbook.core.forEachVectorStep
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.sameAs
import app.cookbook.core.VectorStep
import app.cookbook.core.skippedScenarios
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Every command type commands.ts knows. */
val COMMAND_TYPES = setOf(
    "recipe.favorite", "recipe.rate", "recipes.import", "menu.save", "menu.delete", "menu.plan", "reminders.sync",
    "reminders.ack", "recipe.update", "recipe.save", "recipe.delete", "pantry.save", "pantry.delete", "ingredient.save",
    "plan.save", "plan.move", "plan.delete", "cook", "leftover.eat", "batch.update", "shopping.generate", "shopping.save",
    "shopping.toggle", "shopping.delete", "shopping.purchase", "draft.save", "draft.delete", "settings.save",
)

/** Command types the apps run: all but the server-only reminders commands. */
val IMPLEMENTED = COMMAND_TYPES - setOf("reminders.sync", "reminders.ack")

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
        val count = forEachVectorStep(notPorted = COMMAND_TYPES - IMPLEMENTED, check = ::checkStep)
        println("VECTOR_STEPS_CHECKED=$count")
        assertTrue(count > 0)
    }

    @Test fun everyScenarioRuns() {
        forEachVectorStep(notPorted = COMMAND_TYPES - IMPLEMENTED, check = ::checkStep)
        assertTrue(skippedScenarios.isEmpty(), "skipped scenarios: $skippedScenarios")
    }
}
