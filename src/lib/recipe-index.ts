import { availability, inventoryIndex, type State, type Recipe, type InventoryIndex } from '../../supabase/functions/_shared/domain.ts';

type Status = ReturnType<typeof availability>;
type Context = { inventory: InventoryIndex; recipes: WeakMap<Recipe, Map<number, Status>> };
const inventories = new WeakMap<State['pantry'], WeakMap<State['ingredients'], Context>>();
const searchText = new WeakMap<Recipe, string>();
function context(state: State): Context {
    let aliases = inventories.get(state.pantry);
    if (!aliases) { aliases = new WeakMap(); inventories.set(state.pantry, aliases); }
    let result = aliases.get(state.ingredients);
    if (!result) { result = { inventory: inventoryIndex(state), recipes: new WeakMap() }; aliases.set(state.ingredients, result); }
    return result;
}
export const cachedInventory = (state: State) => context(state).inventory;
export function cachedAvailability(state: State, recipe: Recipe, servings = recipe.servings): Status {
    const current = context(state);
    let sizes = current.recipes.get(recipe);
    if (!sizes) { sizes = new Map(); current.recipes.set(recipe, sizes); }
    let status = sizes.get(servings);
    if (!status) {
        status = availability(state, recipe, servings, current.inventory);
        if (sizes.size >= 16) sizes.delete(sizes.keys().next().value!);
        sizes.set(servings, status);
    }
    return status;
}
export function recipeSearchText(recipe: Recipe) {
    let text = searchText.get(recipe);
    if (text === undefined) { text = [recipe.title, recipe.description, ...recipe.ingredients.map(item => item.name), ...recipe.tags].join(' ').toLowerCase(); searchText.set(recipe, text); }
    return text;
}
