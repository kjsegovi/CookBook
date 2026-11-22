package app.cookbook.core.json

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Kotlin `null` stands for JavaScript `undefined` throughout. */

private fun isJsSpace(c: Char): Boolean = when (c) {
    '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
    else -> c in ' '..' '
}

internal fun jsTrim(s: String): String = s.dropWhile(::isJsSpace).dropLastWhile(::isJsSpace)

private val decimalLiteral = Regex("""[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?""")

private fun radixValue(digits: String, radix: Int): Double {
    if (digits.isEmpty()) return Double.NaN
    var acc = 0.0
    for (c in digits) {
        val v = when (c) { in '0'..'9' -> c - '0'; in 'a'..'z' -> c - 'a' + 10; in 'A'..'Z' -> c - 'A' + 10; else -> return Double.NaN }
        if (v >= radix) return Double.NaN
        acc = acc * radix + v
    }
    return acc
}

/** ECMAScript StringToNumber. */
private fun stringToNumber(raw: String): Double {
    val s = jsTrim(raw)
    if (s.isEmpty()) return 0.0
    if (s.length > 2 && s[0] == '0') {
        when (s[1]) {
            'x', 'X' -> return radixValue(s.substring(2), 16)
            'b', 'B' -> return radixValue(s.substring(2), 2)
            'o', 'O' -> return radixValue(s.substring(2), 8)
        }
    }
    when (s) {
        "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
        "-Infinity" -> return Double.NEGATIVE_INFINITY
    }
    if (!decimalLiteral.matches(s)) return Double.NaN
    return s.toDoubleOrNull() ?: Double.NaN
}

private fun primitiveNumber(p: JsonPrimitive): Double = when {
    p is JsonNull -> 0.0
    p.isString -> stringToNumber(p.content)
    p.content == "true" -> 1.0
    p.content == "false" -> 0.0
    else -> p.content.toDoubleOrNull() ?: Double.NaN
}

/** `String(v ?? '')` */
fun jsString(v: JsonElement?): String = when (v) {
    null, is JsonNull -> ""
    is JsonArray -> v.joinToString(",") { jsString(it) }
    is JsonObject -> "[object Object]"
    is JsonPrimitive -> when {
        v.isString -> v.content
        v.content == "true" || v.content == "false" -> v.content
        else -> v.content.toDoubleOrNull()?.let(::jsNumberString) ?: v.content
    }
}

/** `Number(v)` */
fun jsNumber(v: JsonElement?): Double = when (v) {
    null -> Double.NaN
    is JsonNull -> 0.0
    is JsonArray -> stringToNumber(jsString(v))
    is JsonObject -> Double.NaN
    is JsonPrimitive -> primitiveNumber(v)
}

/** `!!v` */
fun jsTruthy(v: JsonElement?): Boolean = when (v) {
    null, is JsonNull -> false
    is JsonArray, is JsonObject -> true
    is JsonPrimitive -> when {
        v.isString -> v.content.isNotEmpty()
        v.content == "true" -> true
        v.content == "false" -> false
        else -> primitiveNumber(v).let { it != 0.0 && !it.isNaN() }
    }
}

fun jsIsFinite(d: Double): Boolean = !d.isNaN() && !d.isInfinite()
