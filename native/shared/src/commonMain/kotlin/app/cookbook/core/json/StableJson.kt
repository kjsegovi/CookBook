package app.cookbook.core.json

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * JavaScript `Number#toString` for a double (ECMAScript Number::toString), built from the shortest
 * round-trip digits so the JVM and Kotlin/Native agree regardless of their own exponent formats.
 */
fun jsNumberString(d: Double): String {
    if (d.isNaN()) return "NaN"
    if (d == 0.0) return "0"
    if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
    val sign = if (d < 0) "-" else ""
    val raw = (if (d < 0) -d else d).toString()
    val ePos = raw.indexOfFirst { it == 'E' || it == 'e' }
    val mantissa = if (ePos >= 0) raw.substring(0, ePos) else raw
    val exp = if (ePos >= 0) raw.substring(ePos + 1).toInt() else 0
    val dot = mantissa.indexOf('.')
    val intPart = if (dot >= 0) mantissa.substring(0, dot) else mantissa
    val frac = if (dot >= 0) mantissa.substring(dot + 1) else ""
    var digits = intPart + frac
    var n = intPart.length + exp // decimal point position relative to the start of `digits`
    val lead = digits.indexOfFirst { it != '0' }
    digits = digits.substring(lead)
    n -= lead
    digits = digits.trimEnd('0')
    // The JDK always prints at least two digits ("4.9E-324"); JavaScript wants the shortest, so try one.
    if (digits.length == 2) {
        val abs = if (d < 0) -d else d
        val d0 = digits[0] - '0'
        val candidates = if (digits[1] < '5') listOf(d0, d0 + 1) else listOf(d0 + 1, d0)
        for (c in candidates) {
            val (digit, point) = if (c == 10) 1 to n + 1 else c to n
            if (digit != 0 && "${digit}e${point - 1}".toDoubleOrNull() == abs) { digits = digit.toString(); n = point; break }
        }
    }
    val k = digits.length
    return sign + when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val e = n - 1
            val es = (if (e < 0) "-" else "+") + (if (e < 0) -e else e)
            if (k == 1) digits + "e" + es else digits[0] + "." + digits.substring(1) + "e" + es
        }
    }
}

private fun write(e: JsonElement, out: StringBuilder) {
    when (e) {
        is JsonObject -> {
            out.append('{')
            e.keys.sorted().forEachIndexed { i, k ->
                if (i > 0) out.append(',')
                out.append(JsonPrimitive(k).toString()).append(':')
                write(e.getValue(k), out)
            }
            out.append('}')
        }
        is JsonArray -> {
            out.append('[')
            e.forEachIndexed { i, x -> if (i > 0) out.append(','); write(x, out) }
            out.append(']')
        }
        is JsonNull -> out.append("null")
        is JsonPrimitive -> {
            val number = if (e.isString || e.content == "true" || e.content == "false") null else e.content.toDoubleOrNull()
            out.append(if (number != null) jsNumberString(number) else e.toString())
        }
    }
}

/** Canonical text: object keys sorted, numbers spelled like JavaScript, so equal data compares equal. */
fun stableJson(e: JsonElement): String = StringBuilder().also { write(e, it) }.toString()

fun JsonElement.sameAs(other: JsonElement): Boolean = stableJson(this) == stableJson(other)
