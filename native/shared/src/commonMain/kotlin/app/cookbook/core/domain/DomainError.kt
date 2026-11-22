package app.cookbook.core.domain

class DomainError(message: String, val status: Int = 400) : Exception(message)

expect object Ids {
    fun uuid(): String
}

val DEFAULT_CATEGORIES = listOf("Breakfast", "Entrées", "Sauces", "Sides", "Snacks", "Pastries & Desserts")

fun initialState(): State = State(
    recipes = emptyList(), pantry = emptyList(), plan = emptyList(), batches = emptyList(),
    shopping = emptyList(), shoppingWeek = "", menus = emptyList(), ingredients = emptyList(),
    drafts = emptyList(), movements = emptyList(), operations = emptyList(),
    settings = Settings(categories = DEFAULT_CATEGORIES, servings = 2.0, weekStartsOn = 1, autoLeftovers = true),
)
