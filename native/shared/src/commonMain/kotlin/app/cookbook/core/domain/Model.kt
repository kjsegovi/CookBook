package app.cookbook.core.domain

import app.cookbook.core.json.PreservingSerializer
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.Serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

// Mirrors supabase/functions/_shared/domain.ts. Every record keeps keys it does not declare in `extra`.
// Enum-like strings (PlanEntry.kind, MenuItem.slot) stay plain strings so unexpected values round-trip.

@Serializable(with = IngredientLineSerializer::class)
data class IngredientLine(
    val id: String,
    val name: String,
    val amount: Double?,
    val unit: String,
    val group: String,
    val note: String,
    val raw: String,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = IngredientLine::class)
private object IngredientLineBase

object IngredientLineSerializer : PreservingSerializer<IngredientLine>(IngredientLineBase)

@Serializable(with = NutritionSerializer::class)
data class Nutrition(
    @EncodeDefault(EncodeDefault.Mode.NEVER) val calories: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val protein: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val carbs: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val fat: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val fiber: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val sugar: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val sodium: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val servingSize: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val text: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val estimated: Boolean? = null,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = Nutrition::class)
private object NutritionBase

object NutritionSerializer : PreservingSerializer<Nutrition>(NutritionBase)

@Serializable(with = RecipeSerializer::class)
data class Recipe(
    val id: String,
    val title: String,
    val description: String,
    val servings: Double,
    val prepMinutes: Double,
    val cookMinutes: Double,
    val category: String,
    val tags: List<String>,
    val favorite: Boolean,
    val wantToTry: Boolean,
    val image: String,
    val sourceUrl: String,
    val author: String,
    val ingredients: List<IngredientLine>,
    val steps: List<String>,
    val notes: String,
    val createdAt: String,
    val updatedAt: String,
    val rating: Int = 0,
    val categories: List<String> = emptyList(),
    val images: List<String> = emptyList(),
    val related: List<String> = emptyList(),
    val nutrition: Nutrition? = null,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = Recipe::class)
private object RecipeBase

object RecipeSerializer : PreservingSerializer<Recipe>(RecipeBase)

@Serializable(with = PantryItemSerializer::class)
data class PantryItem(
    val id: String,
    val name: String,
    val amount: Double?,
    val unit: String,
    val location: String,
    val note: String,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = PantryItem::class)
private object PantryItemBase

object PantryItemSerializer : PreservingSerializer<PantryItem>(PantryItemBase)

@Serializable(with = PlanEntrySerializer::class)
data class PlanEntry(
    val id: String,
    val date: String,
    val slot: String,
    val kind: String,
    val recipeId: String,
    val batchId: String,
    val cookServings: Double,
    val eatServings: Double,
    val done: Boolean,
    val note: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val auto: Boolean? = null,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = PlanEntry::class)
private object PlanEntryBase

object PlanEntrySerializer : PreservingSerializer<PlanEntry>(PlanEntryBase)

@Serializable(with = PreparedBatchSerializer::class)
data class PreparedBatch(
    val id: String,
    val recipeId: String,
    val title: String,
    val remaining: Double,
    val cookedServings: Double,
    val preparedAt: String,
    val location: String,
    val planId: String,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = PreparedBatch::class)
private object PreparedBatchBase

object PreparedBatchSerializer : PreservingSerializer<PreparedBatch>(PreparedBatchBase)

@Serializable(with = ShoppingItemSerializer::class)
data class ShoppingItem(
    val id: String,
    val key: String,
    val name: String,
    val amount: Double?,
    val unit: String,
    val note: String,
    val group: String,
    val checked: Boolean,
    val manual: Boolean,
    val override: Boolean,
    val needed: Double?,
    val uncertain: Boolean,
    val addedToPantry: Boolean,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = ShoppingItem::class)
private object ShoppingItemBase

object ShoppingItemSerializer : PreservingSerializer<ShoppingItem>(ShoppingItemBase)

@Serializable(with = ImportDraftSerializer::class)
data class ImportDraft(
    val id: String,
    val recipe: Recipe,
    val text: String,
    val warnings: List<String>,
    val createdAt: String,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = ImportDraft::class)
private object ImportDraftBase

object ImportDraftSerializer : PreservingSerializer<ImportDraft>(ImportDraftBase)

@Serializable(with = MenuItemSerializer::class)
data class MenuItem(
    val recipeId: String,
    val day: Int,
    val slot: String,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = MenuItem::class)
private object MenuItemBase

object MenuItemSerializer : PreservingSerializer<MenuItem>(MenuItemBase)

@Serializable(with = MenuSerializer::class)
data class Menu(
    val id: String,
    val name: String,
    val description: String,
    val items: List<MenuItem>,
    val createdAt: String,
    val updatedAt: String,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = Menu::class)
private object MenuBase

object MenuSerializer : PreservingSerializer<Menu>(MenuBase)

@Serializable(with = IngredientSerializer::class)
data class Ingredient(
    val id: String,
    val name: String,
    val aliases: List<String>,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val aisle: String? = null,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = Ingredient::class)
private object IngredientBase

object IngredientSerializer : PreservingSerializer<Ingredient>(IngredientBase)

@Serializable(with = MovementSerializer::class)
data class Movement(
    val id: String,
    val name: String,
    val amount: Double?,
    val unit: String,
    val reason: String,
    val at: String,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = Movement::class)
private object MovementBase

object MovementSerializer : PreservingSerializer<Movement>(MovementBase)

@Serializable(with = SettingsSerializer::class)
data class Settings(
    val categories: List<String>,
    val servings: Double,
    val weekStartsOn: Int,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val autoLeftovers: Boolean? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val aisles: List<String>? = null,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = Settings::class)
private object SettingsBase

object SettingsSerializer : PreservingSerializer<Settings>(SettingsBase)

@Serializable(with = StateSerializer::class)
data class State(
    val recipes: List<Recipe>,
    val pantry: List<PantryItem>,
    val plan: List<PlanEntry>,
    val batches: List<PreparedBatch>,
    val shopping: List<ShoppingItem>,
    val shoppingWeek: String,
    val menus: List<Menu> = emptyList(),
    val ingredients: List<Ingredient>,
    val drafts: List<ImportDraft>,
    val movements: List<Movement>,
    val operations: List<String>,
    val settings: Settings,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val reminders: JsonArray? = null,
    val extra: JsonObject = JsonObject(emptyMap()),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializer(forClass = State::class)
private object StateBase

object StateSerializer : PreservingSerializer<State>(StateBase)

/** Clears `extra` everywhere; TypeScript output never carries unknown keys, so vector comparisons use this. */
fun State.withoutExtras(): State = copy(
    recipes = recipes.map { it.withoutExtras() },
    pantry = pantry.map { it.copy(extra = NO_EXTRA) },
    plan = plan.map { it.copy(extra = NO_EXTRA) },
    batches = batches.map { it.copy(extra = NO_EXTRA) },
    shopping = shopping.map { it.copy(extra = NO_EXTRA) },
    menus = menus.map { m -> m.copy(items = m.items.map { it.copy(extra = NO_EXTRA) }, extra = NO_EXTRA) },
    ingredients = ingredients.map { it.copy(extra = NO_EXTRA) },
    drafts = drafts.map { it.copy(recipe = it.recipe.withoutExtras(), extra = NO_EXTRA) },
    movements = movements.map { it.copy(extra = NO_EXTRA) },
    settings = settings.copy(extra = NO_EXTRA),
    extra = NO_EXTRA,
)

private val NO_EXTRA = JsonObject(emptyMap())

private fun Recipe.withoutExtras(): Recipe = copy(
    ingredients = ingredients.map { it.copy(extra = NO_EXTRA) },
    nutrition = nutrition?.copy(extra = NO_EXTRA),
    extra = NO_EXTRA,
)
