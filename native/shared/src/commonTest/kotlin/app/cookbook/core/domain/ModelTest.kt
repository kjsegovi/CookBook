package app.cookbook.core.domain

import app.cookbook.core.json.CookbookJson
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Ignore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ModelTest {
    @Test fun unknownFieldsSurviveARoundTrip() {
        val json = """{"id":"r","title":"T","description":"","servings":2,"prepMinutes":0,"cookMinutes":0,"category":"Sides","tags":[],"favorite":false,"wantToTry":false,"image":"","sourceUrl":"","author":"","ingredients":[],"steps":[],"notes":"","createdAt":"a","updatedAt":"b","futureField":{"x":1}}"""
        val recipe = CookbookJson.decodeFromString<Recipe>(json)
        assertEquals(JsonObject(mapOf("x" to JsonPrimitive(1))), recipe.extra["futureField"])
        assertTrue(CookbookJson.encodeToString(recipe).contains("\"futureField\":{\"x\":1}"))
    }

    @Test fun initialStateRoundTrips() {
        val s = initialState()
        assertEquals(s, CookbookJson.decodeFromString<State>(CookbookJson.encodeToString(s)))
    }

    @Test fun everyVectorStateDecodes() {
        for (v in app.cookbook.core.loadVectors()) {
            for (o in listOf(v.initial) + v.steps.mapNotNull { it.after }) {
                val st = CookbookJson.decodeFromString<State>(o.toString())
                assertEquals(st, st.withoutExtras(), v.name)
            }
        }
    }

    @Ignore // enabled in Task 3 once stableJson exists
    @Test fun everyVectorStateDecodesAndReencodesWithoutLoss() {}
}
