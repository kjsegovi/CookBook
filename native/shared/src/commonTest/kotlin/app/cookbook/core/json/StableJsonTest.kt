package app.cookbook.core.json

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class StableJsonTest {
    @Test fun numbersFormatLikeJavaScript() {
        assertEquals("2", jsNumberString(2.0)); assertEquals("0.1", jsNumberString(0.1))
        assertEquals("0.3333333333333333", jsNumberString(1.0 / 3)); assertEquals("1e-7", jsNumberString(1e-7))
        assertEquals("1e+21", jsNumberString(1e21)); assertEquals("-0.5", jsNumberString(-0.5))
    }

    @Test fun moreNumberShapes() {
        assertEquals("0", jsNumberString(0.0)); assertEquals("0", jsNumberString(-0.0))
        assertEquals("NaN", jsNumberString(Double.NaN)); assertEquals("-Infinity", jsNumberString(Double.NEGATIVE_INFINITY))
        assertEquals("100000000000000000000", jsNumberString(1e20)); assertEquals("1.5e+21", jsNumberString(1.5e21))
        assertEquals("0.000001", jsNumberString(1e-6)); assertEquals("1.5e-7", jsNumberString(1.5e-7))
        assertEquals("123456789012", jsNumberString(123456789012.0)); assertEquals("1234.5", jsNumberString(1234.5))
        assertEquals("1.7976931348623157e+308", jsNumberString(Double.MAX_VALUE))
        assertEquals("5e-324", jsNumberString(Double.MIN_VALUE))
    }

    @Test fun keyOrderAndNumberSpellingDoNotMatter() {
        assertTrue(Json.parseToJsonElement("""{"b":2,"a":1.0}""").sameAs(Json.parseToJsonElement("""{"a":1,"b":2.0}""")))
    }

    @Test fun stableJsonSortsNestedKeys() {
        assertEquals("""{"a":[{"x":1,"y":"s"}],"b":null}""", stableJson(Json.parseToJsonElement("""{"b":null,"a":[{"y":"s","x":1.0}]}""")))
    }
}
