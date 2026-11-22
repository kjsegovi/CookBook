package app.cookbook.core.domain

import app.cookbook.core.json.jsTrim

// Ingredient parsing and the ingredient/pantry lookups from domain.ts.

private const val FRACTIONS = "¼½¾⅓⅔⅛⅜⅝⅞"

// JavaScript's `.` skips line terminators, which Java's skips only in part, so the class is explicit.
private const val ANY = "[^\\n\\r  ]"
private val digitThenFraction = Regex("([0-9])([$FRACTIONS])")
private val rangePattern = Regex("([0-9]+(?:\\.[0-9]+)?[$JS_SPACE]*[-–][$JS_SPACE]*[0-9]+(?:\\.[0-9]+)?)[$JS_SPACE]+($ANY+)")
private val quantityPattern = Regex(
    "((?:[0-9]+[$JS_SPACE]+(?:[0-9]+/[0-9]+|[$FRACTIONS])|[0-9]+/[0-9]+|[0-9]+(?:\\.[0-9]+)?|[$FRACTIONS]))(?:[$JS_SPACE]+|(?=[a-zA-Z]))($ANY+)",
)
private val unitPattern = Regex("(fl oz|[a-zA-Z]+)\\.?[$JS_SPACE]+($ANY+)")
private val packageUnit = Regex("(cans?|bottles?|cloves?|bunch(?:es)?|packages?|slices?|stalks?)", RegexOption.IGNORE_CASE)

/** Splits a line such as `1 1/2 cups flour` into amount, unit and name. A quantity range is kept in the note for review. */
fun parseIngredient(raw: String, id: String = Ids.uuid()): IngredientLine {
    val text = clean(raw, 1000)
    val normalized = text.replace(digitThenFraction, "\$1 \$2")
    val range = rangePattern.matchEntire(normalized)
    val m = quantityPattern.matchEntire(normalized)
    var amount: Double? = null
    var unit = ""
    var name = text
    var note = ""
    if (range != null) {
        name = range.groupValues[2]
        note = "Quantity range " + range.groupValues[1] + ": confirm the amount."
    } else if (m != null) {
        amount = fractionOf(m.groupValues[1])
        name = jsTrim(m.groupValues[2])
    }
    val u = unitPattern.matchEntire(name)
    if ((range != null || m != null) && u != null && (UNIT.containsKey(u.groupValues[1].lowercase()) || packageUnit.matches(u.groupValues[1]))) {
        unit = u.groupValues[1].lowercase()
        name = u.groupValues[2]
    }
    return IngredientLine(id = id, name = name.ifEmpty { text }, amount = amount, unit = unit, group = "", note = note, raw = text)
}

private fun identifyName(name: String): String = jsTrim(name.lowercase()).replace(jsSpaceRun, " ")

/** The id of the ingredient `name` (or one of its aliases) refers to, else the normalised name. */
fun canonical(state: State, name: String): String {
    val n = identifyName(name)
    val match = state.ingredients.firstOrNull { i -> i.name.lowercase() == n || i.aliases.any { it.lowercase() == n } }
    return match?.id ?: n
}

class InventoryIndex(val canonical: (String) -> String, val pantry: Map<String, List<PantryItem>>)

fun inventoryIndex(state: State): InventoryIndex {
    val aliases = HashMap<String, String>()
    for (ingredient in state.ingredients) for (name in listOf(ingredient.name) + ingredient.aliases) {
        aliases.getOrPut(name.lowercase()) { ingredient.id }
    }
    val identify = { name: String -> identifyName(name).let { aliases[it] ?: it } }
    val pantry = LinkedHashMap<String, MutableList<PantryItem>>()
    for (item in state.pantry) pantry.getOrPut(identify(item.name)) { mutableListOf() }.add(item)
    return InventoryIndex(identify, pantry)
}
