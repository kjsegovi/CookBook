package app.cookbook.core.commands

import app.cookbook.core.domain.civilFromDays
import app.cookbook.core.domain.daysFromCivil
import app.cookbook.core.domain.daysIn
import app.cookbook.core.domain.floorDiv
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

// The parts of JavaScript's Date the commands use: Date.parse, toISOString and the current time.

private const val DAY_MS = 86_400_000L
private const val MAX_TIME = 8_640_000_000_000_000L

private val isoFormat = Regex(
    """([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?""",
)

/**
 * `Date.parse(s)` for the ECMAScript date-time string format (what toISOString writes), as milliseconds or NaN.
 * A date-time without an offset counts as UTC, as on the server; JavaScript would read it as device-local time.
 * Other formats V8 accepts by heuristics are NaN here.
 */
internal fun jsDateParse(s: String): Double {
    val m = isoFormat.matchEntire(s) ?: return Double.NaN
    val g = m.groupValues
    if (g[1] == "-000000") return Double.NaN
    val year = g[1].toInt()
    val month = g[2].ifEmpty { "1" }.toInt()
    val day = g[3].ifEmpty { "1" }.toInt()
    val hour = g[4].ifEmpty { "0" }.toInt()
    val minute = g[5].ifEmpty { "0" }.toInt()
    val second = g[6].ifEmpty { "0" }.toInt()
    val millis = if (g[7].isEmpty()) 0 else g[7].take(3).padEnd(3, '0').toInt()
    if (month !in 1..12 || day !in 1..daysIn(year, month) || minute > 59 || second > 59) return Double.NaN
    if (hour > 24 || (hour == 24 && (minute != 0 || second != 0 || millis != 0))) return Double.NaN
    var offsetMinutes = 0
    val zone = g[8]
    if (zone.isNotEmpty() && zone != "Z") {
        val oh = zone.substring(1, 3).toInt()
        val om = zone.substring(4, 6).toInt()
        if (oh > 23 || om > 59) return Double.NaN
        offsetMinutes = (if (zone[0] == '-') -1 else 1) * (oh * 60 + om)
    }
    val time = daysFromCivil(year, month, day) * DAY_MS + ((hour * 60L + minute - offsetMinutes) * 60L + second) * 1000L + millis
    return if (time < -MAX_TIME || time > MAX_TIME) Double.NaN else time.toDouble()
}

/** `new Date(ms).toISOString()`; throws like JavaScript's RangeError outside the Date range. */
internal fun jsIsoString(ms: Long): String {
    require(ms in -MAX_TIME..MAX_TIME) { "Invalid time value" }
    val days = floorDiv(ms, DAY_MS)
    val rest = ms - days * DAY_MS
    val (y, mo, d) = civilFromDays(days)
    val year = if (y in 0..9999) y.toString().padStart(4, '0') else (if (y < 0) "-" else "+") + (if (y < 0) -y else y).toString().padStart(6, '0')
    fun two(n: Long) = n.toString().padStart(2, '0')
    return "$year-${two(mo.toLong())}-${two(d.toLong())}T${two(rest / 3_600_000)}:${two(rest / 60_000 % 60)}:${two(rest / 1000 % 60)}." +
        (rest % 1000).toString().padStart(3, '0') + "Z"
}

/** `new Date().toISOString()` */
@OptIn(ExperimentalTime::class)
internal fun nowIso(): String = jsIsoString(Clock.System.now().toEpochMilliseconds())
