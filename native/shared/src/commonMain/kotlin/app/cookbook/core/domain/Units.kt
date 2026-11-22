package app.cookbook.core.domain

import app.cookbook.core.json.jsNumberString
import app.cookbook.core.json.jsTrim

// Port of the unit table and conversions in domain.ts.

internal val UNIT: Map<String, Triple<String, Double, String>> = mapOf(
    "g" to Triple("mass", 1.0, "g"), "gram" to Triple("mass", 1.0, "g"), "grams" to Triple("mass", 1.0, "g"),
    "kg" to Triple("mass", 1000.0, "g"), "kilogram" to Triple("mass", 1000.0, "g"), "kilograms" to Triple("mass", 1000.0, "g"),
    "oz" to Triple("mass", 28.349523125, "g"), "ounce" to Triple("mass", 28.349523125, "g"), "ounces" to Triple("mass", 28.349523125, "g"),
    "lb" to Triple("mass", 453.59237, "g"), "lbs" to Triple("mass", 453.59237, "g"), "pound" to Triple("mass", 453.59237, "g"), "pounds" to Triple("mass", 453.59237, "g"),
    "ml" to Triple("volume", 1.0, "ml"), "milliliter" to Triple("volume", 1.0, "ml"), "milliliters" to Triple("volume", 1.0, "ml"),
    "l" to Triple("volume", 1000.0, "ml"), "liter" to Triple("volume", 1000.0, "ml"), "liters" to Triple("volume", 1000.0, "ml"),
    "tsp" to Triple("volume", 4.92892159375, "ml"), "teaspoon" to Triple("volume", 4.92892159375, "ml"), "teaspoons" to Triple("volume", 4.92892159375, "ml"),
    "tbsp" to Triple("volume", 14.78676478125, "ml"), "tablespoon" to Triple("volume", 14.78676478125, "ml"), "tablespoons" to Triple("volume", 14.78676478125, "ml"),
    "cup" to Triple("volume", 236.5882365, "ml"), "cups" to Triple("volume", 236.5882365, "ml"),
    "fl oz" to Triple("volume", 29.5735295625, "ml"),
    "" to Triple("count", 1.0, ""), "each" to Triple("count", 1.0, ""), "piece" to Triple("count", 1.0, ""), "pieces" to Triple("count", 1.0, ""),
)

private val packagePlurals = mapOf(
    "cans" to "can", "bottles" to "bottle", "cloves" to "clove", "bunches" to "bunch", "packages" to "package", "slices" to "slice", "stalks" to "stalk",
)

/** The unit's family (`mass`, `volume`, `count` or `package:<name>`), its size in the family's base unit, and that base unit. */
fun unitInfo(unit: String): Triple<String, Double, String> {
    var u = jsTrim(unit.lowercase())
    if (u in listOf("egg", "eggs", "item", "items")) u = ""
    u = packagePlurals[u] ?: u
    return UNIT[u] ?: Triple("package:$u", 1.0, u)
}

/** `amount` expressed in `to`, or null when the two units are of different kinds. */
fun convert(amount: Double, from: String, to: String): Double? {
    val a = unitInfo(from)
    val b = unitInfo(to)
    return if (a.first == b.first) amount * a.second / b.second else null
}

fun formatAmount(n: Double?, unit: String = ""): String {
    if (n == null) return if (unit.isNotEmpty()) "On hand · $unit" else "On hand"
    val rounded = jsRound(n * 100) / 100
    return jsNumberString(rounded) + (if (unit.isNotEmpty()) " $unit" else "")
}
