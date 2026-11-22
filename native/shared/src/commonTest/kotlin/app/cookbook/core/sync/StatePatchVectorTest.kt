package app.cookbook.core.sync

import app.cookbook.core.domain.State
import app.cookbook.core.domain.withoutExtras
import app.cookbook.core.json.CookbookJson
import app.cookbook.core.json.sameAs
import app.cookbook.core.loadVectors
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertTrue

class StatePatchVectorTest {
    private fun decode(o: JsonObject): State = CookbookJson.decodeFromJsonElement(State.serializer(), o)

    @Test fun patchesMatchTypeScript() {
        var checked = 0
        for (vector in loadVectors()) {
            var previous = decode(vector.initial)
            for ((i, step) in vector.steps.withIndex()) {
                val afterJson = step.after
                if (afterJson == null) continue
                val after = decode(afterJson)
                val recorded = step.patch
                if (recorded != null) {
                    val where = "${vector.name}#$i ${step.type}"
                    val actual = CookbookJson.encodeToJsonElement(StatePatch.serializer(), statePatch(previous, after))
                    assertTrue(actual.sameAs(recorded), "$where patch: expected $recorded but got $actual")
                    val patch = CookbookJson.decodeFromJsonElement(StatePatch.serializer(), recorded)
                    val applied = CookbookJson.encodeToJsonElement(State.serializer(), applyStatePatch(previous, patch).withoutExtras())
                    assertTrue(applied.sameAs(afterJson), "$where apply: expected $afterJson but got $applied")
                    checked++
                }
                previous = after
            }
        }
        println("PATCH_STEPS_CHECKED=$checked")
        assertTrue(checked > 0)
    }
}
