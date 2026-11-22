package app.cookbook.core.domain

import app.cookbook.core.json.jsIsFinite
import app.cookbook.core.json.jsNumber
import app.cookbook.core.json.jsString
import app.cookbook.core.json.jsTrim
import kotlinx.serialization.json.JsonElement
import kotlin.math.floor

// Ports of the text, number and date helpers in supabase/functions/_shared/domain.ts.
// JavaScript's `\s` and `trim()` share one whitespace set that Kotlin's `\s` does not cover, so it is spelled out here.

/** The characters JavaScript's `\s` matches, as the inside of a character class. */
internal const val JS_SPACE = "\t\n\u000B\u000C\r    -     　﻿"

/** `s.replace(/\s+/g, ' ')` */
internal val jsSpaceRun = Regex("[$JS_SPACE]+")

/** `s.split(/\s+/)` */
internal fun jsSplitSpace(s: String): List<String> = s.split(jsSpaceRun)

/** `Math.round`: halves round toward positive infinity. */
internal fun jsRound(x: Double): Double {
    if (!jsIsFinite(x)) return x
    val f = floor(x)
    return if (x - f >= 0.5) f + 1 else f
}

/** `String(v ?? '').trim().slice(0, max)` */
fun clean(v: JsonElement?, max: Int = 500): String = clean(jsString(v), max)

fun clean(s: String, max: Int = 500): String = jsTrim(s).take(max)

/** `positive(v, label, allowZero)`: a finite number between the lower bound and 1,000,000. */
fun positive(v: JsonElement?, label: String, allowZero: Boolean = false): Double {
    val n = jsNumber(v)
    if (!jsIsFinite(n) || n < (if (allowZero) 0.0 else 0.000001) || n > 1000000) {
        throw DomainError("$label must be ${if (allowZero) "zero or " else ""}a positive number.")
    }
    return n
}

private const val UNICODE_FRACTIONS = "¼½¾⅓⅔⅛⅜⅝⅞"
private val digitThenFraction = Regex("([0-9])([$UNICODE_FRACTIONS])")
private val fractionChar = Regex("[$UNICODE_FRACTIONS]")
private val unicodeFraction = mapOf('¼' to "1/4", '½' to "1/2", '¾' to "3/4", '⅓' to "1/3", '⅔' to "2/3", '⅛' to "1/8", '⅜' to "3/8", '⅝' to "5/8", '⅞' to "7/8")
private val plainNumber = Regex("[0-9]+(\\.[0-9]+)?")
private val ratio = Regex("[0-9]+/[0-9]+")

/** Parses quantities such as `1`, `2.5`, `1/2`, `1 1/2`, `½` and `1½`. */
fun fraction(v: JsonElement?): Double? = fractionOf(clean(v, 100))

internal fun fractionOf(text: String): Double? {
    var s = clean(text, 100).replace(digitThenFraction, "\$1 \$2")
    s = s.replace(fractionChar) { unicodeFraction.getValue(it.value[0]) }
    if (s.isEmpty()) return null
    val parts = jsSplitSpace(s)
    if (parts.size > 2) return null
    var sum = 0.0
    for (x in parts) {
        if (plainNumber.matches(x)) {
            sum += x.toDouble()
        } else if (ratio.matches(x)) {
            val (a, b) = x.split('/').map { it.toDouble() }
            if (b == 0.0) return null
            sum += a / b
        } else {
            return null
        }
    }
    return if (jsIsFinite(sum)) sum else null
}

/** A valid `http` or `https` link in WHATWG `URL.href` form, or an empty string for blank input. */
fun httpUrl(v: JsonElement?): String {
    val s = clean(v, 2000)
    if (s.isEmpty()) return ""
    return parseHttpUrl(s) ?: throw DomainError("Enter a valid http or https link.")
}

private val dateShape = Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")

private fun isLeap(y: Int) = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0

internal fun daysIn(y: Int, m: Int) = when (m) { 2 -> if (isLeap(y)) 29 else 28; 4, 6, 9, 11 -> 30; else -> 31 }

internal fun daysFromCivil(year: Int, month: Int, day: Int): Long {
    val y = (if (month <= 2) year - 1 else year).toLong()
    val era = floorDiv(y, 400)
    val yoe = y - era * 400
    val doy = (153 * (month + (if (month > 2) -3 else 9)) + 2) / 5 + day - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

internal fun floorDiv(a: Long, b: Long): Long = if (a >= 0) a / b else -((-a + b - 1) / b)

internal fun civilFromDays(z0: Long): Triple<Int, Int, Int> {
    val z = z0 + 719468
    val era = floorDiv(z, 146097)
    val doe = z - era * 146097
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
    val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
    val y = (yoe + era * 400 + (if (m <= 2) 1 else 0)).toInt()
    return Triple(y, m, d)
}

private fun isoDate(days: Long): String {
    val (y, m, d) = civilFromDays(days)
    val year = if (y in 0..9999) y.toString().padStart(4, '0') else (if (y < 0) "-" else "+") + (if (y < 0) -y else y).toString().padStart(6, '0')
    return "$year-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}"
}

private fun daysOf(date: String): Long {
    require(dateShape.matches(date)) { "Invalid time value" }
    val y = date.substring(0, 4).toInt(); val m = date.substring(5, 7).toInt(); val d = date.substring(8, 10).toInt()
    require(m in 1..12 && d in 1..daysIn(y, m)) { "Invalid time value" }
    return daysFromCivil(y, m, d)
}

/** The date six days after `week` (the last day of a week that starts on `week`). */
fun weekEnd(week: String): String = shiftDate(week, 6)

fun validDate(v: JsonElement?): String {
    val s = clean(v, 10)
    val valid = dateShape.matches(s) && s.substring(5, 7).toInt().let { m -> m in 1..12 && s.substring(8, 10).toInt() in 1..daysIn(s.substring(0, 4).toInt(), m) }
    if (!valid) throw DomainError("Choose a valid date.")
    return s
}

fun shiftDate(date: String, days: Int): String = isoDate(daysOf(date) + days)
