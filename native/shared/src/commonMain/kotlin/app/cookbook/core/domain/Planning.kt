package app.cookbook.core.domain

import app.cookbook.core.json.jsTrim

// Requirements, availability, leftovers and generated shopping, ported from domain.ts.

data class Requirement(
    val key: String,
    val name: String,
    val amount: Double?,
    val unit: String,
    val missing: Double?,
    val uncertain: Boolean,
    val present: Boolean,
)

data class Availability(
    val key: String,
    val name: String,
    val amount: Double?,
    val unit: String,
    val missing: Double?,
    val uncertain: Boolean,
    val present: Boolean,
    val status: String,
)

private class Need(val key: String, val name: String, var amount: Double?, val unit: String) {
    var missing: Double? = null
    var uncertain = false
    var present = false
}

fun requirements(state: State, inputs: List<Pair<Recipe, Double>>, inventory: InventoryIndex? = null): List<Requirement> {
    val identify: (String) -> String = inventory?.canonical ?: { name -> canonical(state, name) }
    val map = LinkedHashMap<String, Need>()
    for ((recipe, servings) in inputs) for (line in recipe.ingredients) {
        val u = unitInfo(line.unit)
        val key = identify(line.name) + "|" + u.first
        val amount = line.amount?.let { it * servings / recipe.servings * u.second }
        val r = map[key]
        if (r != null) {
            if (r.amount == null || amount == null) {
                r.uncertain = true
                r.amount = if (r.amount == null) amount else r.amount
            } else r.amount = r.amount!! + amount
        } else map[key] = Need(key, line.name, amount, u.third)
    }
    for (r in map.values) {
        val id = identify(r.name)
        val matches = if (inventory != null) inventory.pantry[id] ?: emptyList() else state.pantry.filter { identify(it.name) == id }
        r.present = matches.any { it.amount == null || it.amount > 0 }
        var stock = 0.0
        var unknownStock = false
        for (p in matches) {
            val v = if (p.amount == null) null else convert(p.amount, p.unit, r.unit)
            if (v == null) {
                if (r.amount != null) unknownStock = true
            } else stock += v
        }
        r.missing = r.amount?.let { maxOf(0.0, it - stock) }
        if (unknownStock && (r.missing ?: 0.0) > 0.00001) r.uncertain = true
        if (r.amount == null && !r.present) r.uncertain = true
    }
    return map.values.map { Requirement(it.key, it.name, it.amount, it.unit, it.missing, it.uncertain, it.present) }
}

fun availability(state: State, recipe: Recipe, servings: Double = recipe.servings, inventory: InventoryIndex? = null): List<Availability> =
    requirements(state, listOf(recipe to servings), inventory).map { r ->
        val status = if (r.uncertain) "check" else if (r.amount == null) (if (r.present) "ready" else "missing") else if (r.missing!! > 0.00001) "missing" else "ready"
        Availability(r.key, r.name, r.amount, r.unit, r.missing, r.uncertain, r.present, status)
    }

fun reserved(state: State, batchId: String, exceptId: String = ""): Double =
    state.plan.filter { it.kind == "leftover" && it.batchId == batchId && !it.done && it.id != exceptId }.fold(0.0) { n, p -> n + p.eatServings }

const val AUTO_LEFTOVER_DAYS = 4

/** Dates and portions of the leftover meals to schedule after cooking. */
fun autoLeftovers(state: State, batchId: String, remaining: Double, startDate: String): List<Pair<String, Double>> {
    val meals = mutableListOf<Pair<String, Double>>()
    if (state.settings.autoLeftovers == false) return meals
    val taken = state.plan.filter { it.kind == "leftover" && it.batchId == batchId && !it.done }.map { it.date }.toSet()
    var left = remaining - reserved(state, batchId)
    var day = 1
    while (day <= AUTO_LEFTOVER_DAYS && left > 0.000001) {
        val date = shiftDate(startDate, day)
        if (date !in taken) {
            val portions = minOf(state.settings.servings, left)
            meals.add(date to portions)
            left -= portions
        }
        day++
    }
    return meals
}

fun rememberedAisle(state: State, key: String, name: String): String? {
    val lower = jsTrim(name.lowercase())
    return state.ingredients.firstOrNull { i -> i.id == key || i.name.lowercase() == lower || i.aliases.any { it.lowercase() == lower } }?.aisle
}

fun generatedShopping(state: State, week: String, makeId: () -> String): List<ShoppingItem> {
    val end = weekEnd(week)
    val inputs = state.plan.filter { it.date >= week && it.date <= end && it.kind == "cook" && !it.done }
        .mapNotNull { p -> state.recipes.firstOrNull { it.id == p.recipeId }?.let { it to p.cookServings } }
    return requirements(state, inputs)
        .filter { r -> if (r.missing == null) !r.present else r.missing > 0.00001 || r.uncertain }
        .map { r ->
            ShoppingItem(
                id = makeId(), key = r.key, name = r.name, amount = r.missing, unit = r.unit,
                note = if (r.uncertain) "Check amount against your pantry." else "",
                group = aisleFor(r.name, rememberedAisle(state, r.key, r.name)),
                checked = false, manual = false, override = false, needed = r.missing, uncertain = r.uncertain, addedToPantry = false,
            )
        }
}
