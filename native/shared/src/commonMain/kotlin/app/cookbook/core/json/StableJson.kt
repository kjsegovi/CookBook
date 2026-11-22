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
    // Platform printers differ in digit count and in which near-equal digits they pick (the JDK before 19 is not
    // always shortest, and always prints two; Kotlin/Native may pick a 16-digit string that does not round-trip).
    // So search for the shortest digit count that parses back to exactly this double, trying the half-up rounding
    // of the platform digits first and then its neighbours.
    val abs = if (d < 0) -d else d
    val full = digits.take(17)
    for (len in 1..full.length) {
        val head = full.substring(0, len).toLong()
        val roundUp = len < full.length && full[len] >= '5'
        val order = when {
            len == full.length -> listOf(head, head + 1, head - 1)
            roundUp -> listOf(head + 1, head)
            else -> listOf(head, head + 1)
        }
        val hit = order.firstOrNull { it > 0 && "${it}e${n - len}".toDoubleOrNull() == abs } ?: continue
        val text = hit.toString()
        digits = text.trimEnd('0')
        n += text.length - len
        break
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
            // JSON.stringify writes a non-finite number (JSON.parse('1e400') is Infinity) as null.
            out.append(if (number == null) e.toString() else if (jsIsFinite(number)) jsNumberString(number) else "null")
        }
    }
}

/** Canonical text: object keys sorted, numbers spelled like JavaScript, so equal data compares equal. */
fun stableJson(e: JsonElement): String = StringBuilder().also { write(e, it) }.toString()

fun JsonElement.sameAs(other: JsonElement): Boolean = stableJson(this) == stableJson(other)
