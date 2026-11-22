package app.cookbook.core.commands

import app.cookbook.core.domain.DomainError
import app.cookbook.core.domain.PlanEntry
import app.cookbook.core.domain.PreparedBatch
import app.cookbook.core.domain.autoLeftovers
import app.cookbook.core.domain.clean
import app.cookbook.core.domain.convert
import app.cookbook.core.domain.positive
import app.cookbook.core.domain.reserved
import app.cookbook.core.domain.validDate
import app.cookbook.core.json.jsString
import app.cookbook.core.json.jsTruthy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

// plan.save, plan.move, plan.delete, cook, leftover.eat and batch.update from commands.ts.

private val SLOTS = listOf("Breakfast", "Lunch", "Dinner", "Snack")
private const val EPSILON = 0.000001

/** Portions of the batch already promised to unfinished leftover meals, on the current working state. */
private fun CommandContext.reservedNow(batchId: String, exceptId: String = ""): Double = reserved(state.toState(), batchId, exceptId)

/** Replaces the plan entry that is `entry` (by identity, as TypeScript mutates the object itself). */
private fun CommandContext.replaceEntry(entry: PlanEntry, updated: PlanEntry) {
    state.plan[state.plan.indexOfFirst { it === entry }] = updated
}

internal fun CommandContext.planSave() {
    val kind = if (this["kind"].jsEquals("leftover")) "leftover" else "cook"
    var entry = PlanEntry(
        id = clean(this["id"], 100).ifEmpty { nextId() },
        date = validDate(this["date"]),
        slot = this["slot"].stringValue()?.takeIf { it in SLOTS } ?: "Dinner",
        kind = kind,
        recipeId = clean(this["recipeId"], 100),
        batchId = clean(this["batchId"], 100),
        cookServings = if (kind == "cook") positive(this["cookServings"], "Servings to cook") else 0.0,
        eatServings = positive(this["eatServings"], "Servings to eat", kind == "cook"),
        done = false,
        note = clean(this["note"], 500),
    )
    val old = state.plan.firstOrNull { it.id == entry.id }
    if (old?.done == true) throw DomainError("A completed meal cannot be edited.")
    if (old?.kind == "cook") {
        val dependents = state.plan.filter { it.batchId == old.id && !it.done }
        if (kind != "cook" && dependents.isNotEmpty()) throw DomainError("Remove this batch’s planned leftovers before changing its meal type.")
        if (dependents.any { it.date < entry.date }) throw DomainError("The cooking date must be on or before its planned leftovers.")
    }
    if (kind == "cook") {
        recipeById(JsonPrimitive(entry.recipeId))
        if (entry.eatServings > entry.cookServings) throw DomainError("Servings eaten now cannot exceed the batch size.")
        if (old != null && reservedNow(old.id) > entry.cookServings - entry.eatServings) {
            throw DomainError("This batch already has more leftover portions assigned.")
        }
    } else {
        val batch = state.batches.firstOrNull { it.id == entry.batchId }
        val planned = state.plan.firstOrNull { it.id == entry.batchId && it.kind == "cook" && !it.done }
        if (batch == null && planned == null) throw DomainError("Choose an available or planned batch.")
        val available = batch?.remaining ?: (planned!!.cookServings - planned.eatServings)
        if (reservedNow(entry.batchId, entry.id) + entry.eatServings > available + EPSILON) {
            throw DomainError("There are not enough unassigned portions in that batch.")
        }
        if (planned != null && entry.date < planned.date) throw DomainError("Schedule leftovers on or after the cooking date.")
        entry = entry.copy(recipeId = batch?.recipeId ?: planned!!.recipeId)
    }
    val id = entry.id
    state.plan.removeAll { it.id == id }
    state.plan.add(entry)
}

/** Drag a meal to another day. Leftovers stay on or after their cooking day. */
internal fun CommandContext.planMove() {
    val id = this["id"]
    val entry = state.plan.firstOrNull { id.jsEquals(it.id) } ?: throw DomainError("This meal was removed. Refresh and choose another.", 404)
    if (entry.done) throw DomainError("A completed meal cannot be moved.")
    val date = validDate(this["date"])
    if (entry.kind == "cook" && state.plan.any { it.batchId == entry.id && !it.done && it.date < date }) {
        throw DomainError("Move this batch’s leftover meals first: they would come before the cooking day.")
    }
    val cooking = if (entry.kind == "leftover") state.plan.firstOrNull { it.id == entry.batchId && it.kind == "cook" && !it.done } else null
    if (cooking != null && date < cooking.date) throw DomainError("Leftovers have to come on or after the day the batch is cooked.")
    replaceEntry(entry, entry.copy(date = date, slot = this["slot"].stringValue()?.takeIf { it in SLOTS } ?: entry.slot))
}

internal fun CommandContext.planDelete() {
    val id = this["id"]
    val old = state.plan.firstOrNull { id.jsEquals(it.id) }
    if (old?.done == true) throw DomainError("Completed meals stay in your cooking history.")
    if (state.plan.any { id.jsEquals(it.batchId) && !it.done }) throw DomainError("Remove this batch’s planned leftover meals first.")
    state.plan.removeAll { id.jsEquals(it.id) }
}

internal fun CommandContext.cook() {
    val planId = this["planId"]
    val entry = state.plan.firstOrNull { planId.jsEquals(it.id) }
    if (entry?.done == true) throw DomainError("This meal is already cooked.")
    if (entry != null && entry.kind != "cook") throw DomainError("Use Eat leftovers for a prepared meal.")
    val recipeIndex = recipeIndex(if (entry != null) JsonPrimitive(entry.recipeId) else this["recipeId"])
    val r = state.recipes[recipeIndex]
    val cooked = positive(this["cookServings"], "Servings cooked")
    val eaten = positive(this["eatServings"], "Servings eaten", true)
    if (eaten > cooked) throw DomainError("Servings eaten cannot exceed servings cooked.")
    val batchId = entry?.id ?: operationId
    if (reservedNow(batchId) > cooked - eaten) {
        throw DomainError("The actual batch has fewer portions than your planned leftovers. Adjust those meals first.")
    }
    val usage = this["usage"] as? JsonArray
    if (usage == null || usage.size > 200) throw DomainError("Review your ingredient usage first.")
    for (u in usage) {
        val pantryId = u.field("pantryId")
        if (!jsTruthy(pantryId)) continue
        val index = state.pantry.indexOfFirst { pantryId.jsEquals(it.id) }
        if (index < 0) throw DomainError("A pantry item changed. Refresh and review usage.")
        val stock = state.pantry[index]
        val expected = u.field("expected")
        if (jsTruthy(expected) && !sameRecord(stock, jsString(expected))) {
            throw DomainError("An ingredient changed. Close this review and reopen it to check the latest pantry amounts.", 409)
        }
        val amountInput = u.field("amount")
        if (amountInput is JsonNull) continue
        val amount = positive(amountInput, "Usage", true)
        val converted = convert(amount, clean(u.field("unit"), 40), stock.unit)
        if (stock.amount == null || converted == null) throw DomainError("Set a measured pantry amount or leave this item unchanged.")
        if (converted > stock.amount + EPSILON) throw DomainError("Not enough ${stock.name}. Adjust its stock or actual usage.")
        state.pantry[index] = stock.copy(amount = maxOf(0.0, stock.amount - converted))
        movement(stock.name, -converted, stock.unit, "Cooked " + r.title)
    }
    state.batches.add(
        PreparedBatch(
            id = batchId, recipeId = r.id, title = r.title, remaining = cooked - eaten, cookedServings = cooked, preparedAt = at,
            location = if (this["location"].jsEquals("Freezer")) "Freezer" else "Fridge", planId = entry?.id ?: "",
        ),
    )
    if (entry != null) replaceEntry(entry, entry.copy(done = true))
    for ((date, portions) in autoLeftovers(state.toState(), batchId, cooked - eaten, entry?.date ?: at.take(10))) {
        state.plan.add(
            PlanEntry(
                id = nextId(), date = date, slot = entry?.slot ?: "Dinner", kind = "leftover", recipeId = r.id, batchId = batchId,
                cookServings = 0.0, eatServings = portions, done = false, note = "", auto = true,
            ),
        )
    }
    state.recipes[recipeIndex] = state.recipes[recipeIndex].copy(wantToTry = false)
}

internal fun CommandContext.leftoverEat() {
    val planId = this["planId"]
    val entry = state.plan.firstOrNull { planId.jsEquals(it.id) }
    if (entry?.done == true) throw DomainError("This meal has already been eaten.")
    if (entry != null && entry.kind != "leftover") throw DomainError("This is a cooking entry.")
    val batchIdInput = if (entry != null) JsonPrimitive(entry.batchId) else this["batchId"]
    val index = state.batches.indexOfFirst { batchIdInput.jsEquals(it.id) }
    if (index < 0) throw DomainError("Cook this batch before eating its leftovers.")
    val batch = state.batches[index]
    val amount = positive(if (entry != null) JsonPrimitive(entry.eatServings) else this["amount"], "Portions")
    if (amount + reservedNow(batch.id, entry?.id ?: "") > batch.remaining + EPSILON) {
        throw DomainError("Those portions are assigned to another meal. Adjust the plan first.")
    }
    state.batches[index] = batch.copy(remaining = maxOf(0.0, batch.remaining - amount))
    if (entry != null) replaceEntry(entry, entry.copy(done = true))
}

internal fun CommandContext.batchUpdate() {
    val id = this["id"]
    val index = state.batches.indexOfFirst { id.jsEquals(it.id) }
    if (index < 0) throw DomainError("Batch not found.")
    val b = state.batches[index]
    val n = positive(this["remaining"], "Remaining portions", true)
    var excess = reservedNow(b.id) - n
    if (excess > EPSILON) {
        // Trim automatic leftover meals, latest first, until the reserved portions fit.
        val automatic = state.plan.filter { it.auto == true && it.kind == "leftover" && it.batchId == b.id && !it.done }.sortedByDescending { it.date }
        for (planned in automatic) {
            if (excess > EPSILON) {
                val trim = minOf(excess, planned.eatServings)
                if (trim >= planned.eatServings - EPSILON) state.plan.removeAll { it.id == planned.id }
                else replaceEntry(planned, planned.copy(eatServings = planned.eatServings - trim))
                excess -= trim
            }
        }
    }
    if (n < reservedNow(b.id)) throw DomainError("Remove leftover meal assignments before reducing below reserved portions.")
    state.batches[index] = b.copy(remaining = n, location = if (this["location"].jsEquals("Freezer")) "Freezer" else "Fridge")
}
