package app.cookbook.core.domain

// Grocery aisles, ported verbatim from aisles.ts: a remembered aisle wins, then a keyword match, then "Other".
val DEFAULT_AISLES = listOf("Produce", "Bakery", "Meat & Seafood", "Dairy & Eggs", "Pantry", "Spices & Baking", "Canned & Jarred", "Frozen", "Drinks", "Household", "Other")

private val KEYWORDS: List<Pair<String, List<String>>> = listOf(
    "Produce" to listOf("apple", "avocado", "banana", "basil", "bean sprout", "berries", "blueberr", "broccoli", "cabbage", "carrot", "cauliflower", "celery", "chard", "chive", "cilantro", "coriander leaves", "cucumber", "dill", "eggplant", "aubergine", "fennel", "garlic", "ginger", "grape", "green onion", "herbs", "jalapeño", "jalapeno", "kale", "leek", "lemon", "lettuce", "lime", "mango", "mint", "mushroom", "onion", "orange", "parsley", "peach", "pear", "pepper, bell", "bell pepper", "potato", "pumpkin", "radish", "rosemary", "sage", "scallion", "shallot", "spinach", "squash", "strawberr", "sweet potato", "thyme", "tomato", "zucchini", "courgette", "arugula", "rocket", "corn on the cob", "chili pepper", "fresh"),
    "Bakery" to listOf("bagel", "baguette", "bread", "bun", "ciabatta", "croissant", "pita", "roll", "sourdough", "tortilla", "naan", "brioche"),
    "Meat & Seafood" to listOf("bacon", "beef", "chicken", "chorizo", "cod", "crab", "duck", "fish", "ham", "lamb", "mince", "pork", "prawn", "salmon", "sausage", "scallop", "shrimp", "steak", "tuna steak", "turkey", "veal", "anchov"),
    "Dairy & Eggs" to listOf("butter", "buttermilk", "cheddar", "cheese", "cream", "crème fraîche", "egg", "feta", "ghee", "gruyère", "half-and-half", "kefir", "milk", "mozzarella", "parmesan", "ricotta", "sour cream", "yogurt", "yoghurt", "mascarpone"),
    "Frozen" to listOf("frozen", "ice cream", "peas, frozen"),
    "Spices & Baking" to listOf("allspice", "baking powder", "baking soda", "bicarbonate", "cardamom", "cayenne", "chili flakes", "chili powder", "cinnamon", "clove", "cocoa", "coriander", "cornstarch", "cumin", "curry powder", "extract", "flour", "garam masala", "nutmeg", "oregano", "paprika", "pepper", "salt", "sugar", "turmeric", "vanilla", "yeast", "chocolate chips", "bay lea"),
    "Canned & Jarred" to listOf("canned", "tinned", "coconut milk", "beans", "chickpea", "lentil", "passata", "tomato paste", "tomato sauce", "olives", "pickle", "capers", "jam", "peanut butter", "stock", "broth", "salsa"),
    "Pantry" to listOf("rice", "pasta", "spaghetti", "noodle", "oats", "quinoa", "couscous", "oil", "vinegar", "soy sauce", "honey", "maple syrup", "mustard", "ketchup", "mayonnaise", "nuts", "almond", "walnut", "cashew", "seed", "breadcrumb", "cereal", "crackers", "tahini", "fish sauce", "sriracha"),
    "Drinks" to listOf("coffee", "juice", "soda", "sparkling water", "tea", "wine", "beer"),
    "Household" to listOf("foil", "paper towel", "plastic wrap", "detergent", "soap", "baking paper", "parchment"),
)

fun keywordAisle(name: String): String {
    val text = " " + name.lowercase() + " "
    // "frozen peas" is frozen, "tomato paste" is jarred: check the more specific aisles first.
    for (aisle in listOf("Frozen", "Canned & Jarred")) if (KEYWORDS.first { it.first == aisle }.second.any { text.contains(it) }) return aisle
    var best = ""
    var length = 0
    for ((aisle, words) in KEYWORDS) for (word in words) if (word.length > length && text.contains(word)) { best = aisle; length = word.length }
    return best.ifEmpty { "Other" }
}

/** `remembered` is the aisle you last chose for this ingredient, if any. */
fun aisleFor(name: String, remembered: String?): String = if (remembered.isNullOrEmpty()) keywordAisle(name) else remembered

fun aisleOrder(aisles: List<String>?): (String) -> Int {
    val order = if (aisles.isNullOrEmpty()) DEFAULT_AISLES else aisles
    return { group -> order.indexOf(group).let { if (it < 0) order.size else it } }
}
