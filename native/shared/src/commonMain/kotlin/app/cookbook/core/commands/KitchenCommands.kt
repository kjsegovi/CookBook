package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.Ingredient
import app.cookbook.core.domain.PantryItem
import app.cookbook.core.domain.ShoppingItem
import app.cookbook.core.domain.canonical
import app.cookbook.core.domain.clean
import app.cookbook.core.domain.convert
import app.cookbook.core.domain.generatedShopping
import app.cookbook.core.domain.positive
import app.cookbook.core.domain.validDate
import app.cookbook.core.json.jsNumber
import app.cookbook.core.json.jsTrim
import app.cookbook.core.json.jsTruthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

// pantry.save, pantry.delete, ingredient.save, shopping.generate, shopping.save, shopping.toggle, shopping.delete,
// shopping.purchase and settings.save from commands.ts.

private val LOCATIONS = listOf("Pantry", "Fridge", "Freezer")

/** The text of a JSON string; anything else (numbers included) is null, so `list.includes(value)` stays strict. */
internal fun JsonElement?.stringValue(): String? = if (this is JsonPrimitive && this !is JsonNull && isString) content else null

/** `value === null || value === ''`: an amount left blank. A missing value (`undefined`) is not blank. */
internal fun JsonElement?.isBlankAmount(): Boolean = this is JsonNull || (stringValue() == "")

/** `value === undefined || value === null` */
internal fun JsonElement?.isNullish(): Boolean = this == null || this is JsonNull

/**
 * `value.key` for an element of a payload array. Reading a field of `null` throws a TypeError in TypeScript, so it
 * throws here too (not a DomainError); other non-objects have no such field.
 */
internal fun JsonElement?.field(key: String): JsonElement? {
    if (this.isNullish()) throw IllegalArgumentException("Cannot read properties of null (reading '$key')")
    return asJsObject()?.get(key)
}

/** `a !== b` for two numbers that may be null. */
private fun differs(a: Double?, b: Double?): Boolean = if (a == null || b == null) (a == null) != (b == null) else a != b

internal fun CommandContext.pantrySave() {
    val amountInput = this["amount"]
    val item = PantryItem(
        id = clean(this["id"], 100).ifEmpty { nextId() },
        name = clean(this["name"], 200),
        amount = if (amountInput.isBlankAmount()) null else positive(amountInput, "Amount", true),
        unit = clean(this["unit"], 40),
        location = this["location"].stringValue()?.takeIf { it in LOCATIONS } ?: "Pantry",
        note = clean(this["note"], 500),
    )
    if (item.name.isEmpty()) throw DomainError("Enter an ingredient name.")
    val i = state.pantry.indexOfFirst { it.id == item.id }
    if (i < 0) state.pantry.add(item) else state.pantry[i] = item
    movement(item.name, item.amount, item.unit, "Stock adjusted")
}

internal fun CommandContext.pantryDelete() {
    val id = this["id"]
    state.pantry.removeAll { id.jsEquals(it.id) }
}

internal fun CommandContext.ingredientSave() {
    val name = clean(this["name"], 200)
    val aliases = clean(this["aliases"], 2000).split(',').map { jsTrim(it) }.filter { it.isNotEmpty() }
    if (name.isEmpty()) throw DomainError("Enter a canonical ingredient name.")
    val id = clean(this["id"], 100).ifEmpty { nextId() }
    for (existing in state.ingredients.filter { it.id != id }) {
        val names = (listOf(existing.name) + existing.aliases).map { it.lowercase() }
        if ((listOf(name) + aliases).any { it.lowercase() in names }) {
            throw DomainError("That ingredient name or alias already belongs to another ingredient.")
        }
    }
    val aisle = state.ingredients.firstOrNull { it.id == id }?.aisle
    state.ingredients.removeAll { it.id == id }
    state.ingredients.add(Ingredient(id = id, name = name, aliases = aliases, aisle = aisle?.takeIf { it.isNotEmpty() }))
}

internal fun CommandContext.shoppingGenerate() {
    val week = validDate(this["week"])
    val old = state.shopping.toList()
    val generated = generatedShopping(state.toState(), week, nextId).map { generatedItem ->
        var item = generatedItem
        val previous = old.firstOrNull { !it.manual && it.key == item.key && !it.addedToPantry }
        if (previous != null) {
            item = item.copy(id = previous.id, checked = state.shoppingWeek == week && previous.checked, addedToPantry = previous.addedToPantry)
            if (previous.override) {
                item = item.copy(amount = previous.amount, unit = previous.unit, note = previous.note, group = previous.group, override = true)
            }
            if (differs(previous.needed, item.needed) && !item.addedToPantry) item = item.copy(checked = false)
        }
        item
    }
    state.shopping = (generated + old.filter { x -> x.manual || (generated.none { it.key == x.key } && (x.override || x.checked)) }).toMutableList()
    state.shoppingWeek = week
}

internal fun CommandContext.shoppingSave() {
    val old = state.shopping.firstOrNull { this["id"].jsEquals(it.id) }
    if (old?.addedToPantry == true) throw DomainError("This purchase is already in the pantry. Add a new item for another purchase.")
    val amountInput = this["amount"]
    val item = ShoppingItem(
        id = clean(this["id"], 100).ifEmpty { nextId() },
        key = old?.key ?: nextId(),
        name = clean(this["name"], 200),
        amount = if (amountInput.isBlankAmount()) null else positive(amountInput, "Purchase amount", true),
        unit = clean(this["unit"], 40),
        note = clean(this["note"], 500),
        group = clean(this["group"], 100).ifEmpty { "Other" },
        checked = jsTruthy(this["checked"]),
        manual = old?.manual ?: true,
        override = if (old != null) !old.manual else false,
        needed = old?.needed,
        uncertain = old?.uncertain ?: false,
        addedToPantry = false,
    )
    if (item.name.isEmpty()) throw DomainError("Enter an item name.")
    state.shopping.removeAll { it.id == item.id }
    state.shopping.add(item)
    // Moving an item to another aisle is remembered for that ingredient.
    if (clean(this["group"], 100).isNotEmpty() && item.group != (old?.group ?: "") && item.group !in listOf("Other", "Ingredients")) {
        val lower = item.name.lowercase()
        val known = state.ingredients.indexOfFirst { i -> i.id == item.key || i.name.lowercase() == lower || i.aliases.any { it.lowercase() == lower } }
        if (known >= 0) state.ingredients[known] = state.ingredients[known].copy(aisle = item.group)
        else if (state.ingredients.size < 10000) state.ingredients.add(Ingredient(id = nextId(), name = item.name, aliases = emptyList(), aisle = item.group))
    }
}

internal fun CommandContext.shoppingToggle() {
    val id = this["id"]
    val index = state.shopping.indexOfFirst { id.jsEquals(it.id) }
    if (index < 0) throw DomainError("Shopping item not found.")
    if (state.shopping[index].addedToPantry) throw DomainError("This purchase is already in the pantry.")
    state.shopping[index] = state.shopping[index].copy(checked = jsTruthy(this["checked"]))
}

internal fun CommandContext.shoppingDelete() {
    val id = this["id"]
    state.shopping.removeAll { id.jsEquals(it.id) }
}

/** The key a JavaScript Set compares `value` by (SameValueZero): primitives by value, objects by identity. */
private fun setKey(value: JsonElement?): Any = when {
    value == null -> "undefined"
    value is JsonNull -> "null"
    value is JsonPrimitive && value.isString -> "s:" + value.content
    value is JsonPrimitive -> if (value.content == "true" || value.content == "false") "b:" + value.content else "n:" + (jsNumber(value) + 0.0)
    else -> Any()
}

internal fun CommandContext.shoppingPurchase() {
    val items = this["items"] as? JsonArray
    if (items == null || items.size > 500) throw DomainError("Review the purchases first.")
    val seen = HashSet<Any>()
    for (row in items) {
        val rowId = row.field("id")
        if (!seen.add(setKey(rowId))) throw DomainError("Duplicate purchase.")
        val index = state.shopping.indexOfFirst { rowId.jsEquals(it.id) }
        val item = state.shopping.getOrNull(index)
        if (item == null || !item.checked || item.addedToPantry) throw DomainError("A purchase changed or was already added. Refresh and review.")
        val amountInput = row.field("amount")
        val amount = if (amountInput.isBlankAmount()) null else positive(amountInput, "Purchased amount", true)
        val unit = clean(row.field("unit"), 40)
        val location = row.field("location")
        // Ingredients do not change while purchasing, so one snapshot serves every canonical() lookup.
        val names = state.toState()
        val itemName = canonical(names, item.name)
        val existing = state.pantry.indexOfFirst { x ->
            canonical(names, x.name) == itemName &&
                (if (location.isNullish()) x.location == "Pantry" else location.jsEquals(x.location)) &&
                x.amount != null && amount != null && convert(amount, unit, x.unit) != null
        }
        if (existing >= 0 && amount != null) {
            val stock = state.pantry[existing]
            state.pantry[existing] = stock.copy(amount = stock.amount!! + convert(amount, unit, stock.unit)!!)
        } else {
            state.pantry.add(
                PantryItem(id = nextId(), name = item.name, amount = amount, unit = unit, location = location.stringValue()?.takeIf { it in LOCATIONS } ?: "Pantry", note = ""),
            )
        }
        state.shopping[index] = item.copy(addedToPantry = true)
        movement(item.name, amount, unit, "Purchased")
    }
}

internal fun CommandContext.settingsSave() {
    var settings = state.settings.copy(servings = positive(this["servings"], "Default servings"))
    val weekStartsOn = this["weekStartsOn"]
    val isZero = weekStartsOn is JsonPrimitive && weekStartsOn !is JsonNull && !weekStartsOn.isString &&
        weekStartsOn.content != "true" && weekStartsOn.content != "false" && jsNumber(weekStartsOn) == 0.0
    settings = settings.copy(weekStartsOn = if (isZero) 0 else 1)
    val auto = this["autoLeftovers"]
    settings = settings.copy(autoLeftovers = if (auto == null) settings.autoLeftovers != false else jsTruthy(auto))
    val cats = clean(this["categories"], 2000).split('\n').map { jsTrim(it) }.filter { it.isNotEmpty() }
    if (cats.isEmpty() || cats.size > 100) throw DomainError("Enter between 1 and 100 categories. Use “Dinner / Pasta” for a category inside another.")
    settings = settings.copy(categories = cats.distinct())
    if (payload.containsKey("aisles")) {
        val aisles = clean(this["aisles"], 3000).split('\n').map { jsTrim(it).take(100) }.filter { it.isNotEmpty() }.distinct()
        if (aisles.size > 60) throw DomainError("Enter up to 60 aisles.")
        settings = settings.copy(aisles = aisles.ifEmpty { null })
    }
    state.settings = settings
}
