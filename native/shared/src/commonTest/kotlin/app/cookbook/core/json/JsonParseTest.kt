package app.cookbook.core.json

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class JsonParseTest {
    @Test fun acceptsWhatJsonParseAccepts() {
        assertTrue(jsonParse(" 1 ").sameAs(JsonPrimitive(1)))
        assertTrue(jsonParse("-0").sameAs(JsonPrimitive(0)))
        assertEquals(JsonNull, jsonParse("null"))
        assertTrue(jsonParse("""{"a":[1,2.5e3,"x\u0041\n"],"b":{}, "a":true}""").sameAs(jsonParse("""{"b":{},"a":true}""")))
        assertEquals(JsonArray(emptyList()), jsonParse("\t[ ]\r\n"))
        assertEquals("\"é\"", stableJson(jsonParse("\"\\u00e9\"")))
    }

    @Test fun refusesWhatJsonParseRefuses() {
        for (bad in listOf("", "01", "1.", ".5", "+1", "[1,]", "{\"a\":1,}", "\"a\tb\"", "\u00a01", "tru", "'a'", "{a:1}", "NaN", "1 2", "\"\\x41\"", "[", "not json", "-", "1e", "\"\\u12\"")) {
            assertFailsWith<IllegalArgumentException>(bad) { jsonParse(bad) }
        }
    }

    @Test fun overflowingNumbersBecomeNullInStableJson() {
        // JSON.parse('1e400') is Infinity, which JSON.stringify writes as null.
        assertEquals("[null,null]", stableJson(jsonParse("[1e400,-1e400]")))
    }
}
