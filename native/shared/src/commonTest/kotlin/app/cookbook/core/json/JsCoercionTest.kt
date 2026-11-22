package app.cookbook.core.json

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class JsCoercionTest {
    @Test fun coercionMatchesJavaScript() {
        assertEquals("", jsString(null)); assertEquals("", jsString(JsonNull)); assertEquals("2", jsString(JsonPrimitive(2.0)))
        assertEquals("1,2", jsString(JsonArray(listOf(JsonPrimitive(1), JsonPrimitive(2))))); assertEquals("[object Object]", jsString(JsonObject(emptyMap())))
        assertTrue(jsNumber(null).isNaN()); assertEquals(0.0, jsNumber(JsonNull)); assertEquals(0.0, jsNumber(JsonPrimitive(""))); assertEquals(2.0, jsNumber(JsonPrimitive(" 2 ")))
        assertTrue(jsNumber(JsonPrimitive("2a")).isNaN()); assertEquals(1.0, jsNumber(JsonPrimitive(true)))
        assertFalse(jsTruthy(JsonPrimitive(""))); assertFalse(jsTruthy(JsonPrimitive(0))); assertTrue(jsTruthy(JsonPrimitive("0")))
    }

    private fun n(s: String) = jsNumber(JsonPrimitive(s))

    @Test fun stringToNumber() {
        assertEquals(0.0, n("  \n\t ")); assertEquals(2.5, n("\n 2.5\t")); assertEquals(-3.0, n("-3"))
        assertEquals(5.0, n("5.")); assertEquals(0.5, n(".5")); assertEquals(1500.0, n("1.5e3")); assertEquals(0.015, n("1.5E-2"))
        assertEquals(Double.POSITIVE_INFINITY, n("Infinity")); assertEquals(Double.NEGATIVE_INFINITY, n("-Infinity"))
        assertEquals(Double.POSITIVE_INFINITY, n("+Infinity"))
        assertEquals(255.0, n("0xff")); assertEquals(255.0, n("0XFF")); assertEquals(5.0, n("0b101")); assertEquals(8.0, n("0o10"))
        for (bad in listOf("0x", "0b2", "0o8", "-0x10", "1 2", "1e", "e5", ".", "+", "infinity", "1_0", "NaN", "0x1g", "--1"))
            assertTrue(n(bad).isNaN(), bad)
    }

    @Test fun arraysAndObjects() {
        assertEquals(0.0, jsNumber(JsonArray(emptyList())))
        assertEquals(7.0, jsNumber(JsonArray(listOf(JsonPrimitive("7")))))
        assertTrue(jsNumber(JsonArray(listOf(JsonPrimitive(1), JsonPrimitive(2)))).isNaN())
        assertTrue(jsNumber(JsonObject(emptyMap())).isNaN())
        assertEquals(1.0, jsNumber(JsonPrimitive(false)) + 1.0)
        assertEquals("a,,b", jsString(JsonArray(listOf(JsonPrimitive("a"), JsonNull, JsonPrimitive("b")))))
        assertEquals("1,2,3", jsString(JsonArray(listOf(JsonPrimitive(1), JsonArray(listOf(JsonPrimitive(2), JsonPrimitive(3)))))))
        assertEquals("true", jsString(JsonPrimitive(true)))
    }

    @Test fun truthiness() {
        assertFalse(jsTruthy(null)); assertFalse(jsTruthy(JsonNull)); assertFalse(jsTruthy(JsonPrimitive(false)))
        assertFalse(jsTruthy(JsonPrimitive(0.0))); assertTrue(jsTruthy(JsonPrimitive(-1))); assertTrue(jsTruthy(JsonArray(emptyList())))
        assertTrue(jsTruthy(JsonObject(emptyMap())))
    }

    @Test fun finiteness() {
        assertTrue(jsIsFinite(1.0)); assertFalse(jsIsFinite(Double.NaN)); assertFalse(jsIsFinite(Double.POSITIVE_INFINITY))
    }
}
