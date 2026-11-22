package app.cookbook.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class VectorsLoadTest {
    private val required = listOf(
        "recipes-basic", "recipes-import", "drafts", "menus", "pantry-ingredients", "shopping",
        "planning", "cooking", "settings", "coercion", "same-millisecond",
    )

    @Test
    fun loadsEveryScenario() {
        val names = loadVectors().map { it.name }
        for (name in required) assertTrue(name in names, "missing scenario $name")
        assertEquals(names.size, names.toSet().size, "scenario names must be unique")
    }

    @Test
    fun everyStepHasExactlyOneOfAfterOrError() {
        for (vector in loadVectors()) {
            assertTrue(vector.steps.isNotEmpty(), "${vector.name} has no steps")
            vector.steps.forEachIndexed { index, step ->
                val where = "${vector.name} step ${index + 1} (${step.type})"
                assertTrue((step.after == null) != (step.error == null), "$where needs exactly one of after or error")
                if (step.error != null) assertNotNull(step.error.message).also { assertTrue(step.patch == null, "$where is an error with a patch") }
                else assertNotNull(step.patch, "$where succeeded without a patch")
            }
        }
    }
}
