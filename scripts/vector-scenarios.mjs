// Scenarios for the golden command vectors. Each step names a command and its
// payload; export-command-vectors.mjs runs them through the TypeScript commands.
//
// A payload may be a function of the state the step starts from (for values such as
// the current updatedAt). `expect` is 'ok' (the default) or a fragment of the error
// message the step must produce, so a scenario fails loudly if it stops testing what
// it says. Every ingredient and record carries an id: ids are never random.
import { normalizeRecipe, initialState } from '../supabase/functions/_shared/domain.ts';

const BASE = Date.parse('2026-11-21T10:00:00.000Z');
const at = (seconds) => new Date(BASE + seconds * 1000).toISOString();

export const ing = (id, name, amount, unit = '') => ({ id, name, amount, unit, group: '', note: '', raw: '' });
export const rec = (id, over = {}) => ({
    id, title: 'Recipe ' + id, description: '', servings: 4, prepMinutes: 10, cookMinutes: 20, category: 'Entrées', tags: [],
    favorite: false, wantToTry: true, image: '', sourceUrl: '', author: '', ingredients: [ing(id + '-i1', 'rice', 400, 'g')],
    steps: ['Cook.'], notes: '', ...over,
});
const withoutId = ({ id, ...rest }) => rest;

// Step helpers. The default clock moves one minute per step; `clock` and `op` override it.
const ok = (type, payload, o = {}) => ({ type, payload, ...o });
const no = (type, payload, expect, o = {}) => ({ type, payload, expect, ...o });
function scenario(name, steps, initial) {
    return {
        name, ...(initial ? { initial } : {}),
        steps: steps.map((step, index) => ({
            type: step.type, payload: step.payload, expect: step.expect ?? 'ok',
            operationId: step.op ?? 'op-' + String(index + 1).padStart(4, '0'),
            clock: step.clock ?? at((index + 1) * 60),
        })),
    };
}

const recipeOf = (id) => (s) => s.recipes.find(r => r.id === id);
const updatedAt = (id) => (s) => recipeOf(id)(s).updatedAt;
const planOf = (id) => (s) => s.plan.find(x => x.id === id);
const pantryOf = (id) => (s) => s.pantry.find(x => x.id === id);
const rowOf = (name) => (s) => s.shopping.find(x => x.name === name);
const DAY = '2026-11-02';
const settings = (over = {}) => ({ servings: 2, weekStartsOn: 1, categories: 'Entrées', ...over });

// ---- recipes-basic ----
const recipesBasic = scenario('recipes-basic', [
    ok('recipe.save', rec('r1', { categories: ['Entrées', 'Dinner'], images: ['https://example.com/a.jpg'], tags: ['quick'] })),
    ok('recipe.save', rec('r1', { title: 'Rice bowl v2' })),
    ok('recipe.save', s => ({ ...rec('r1', { title: 'Rice bowl v3' }), expectedUpdatedAt: updatedAt('r1')(s) })),
    no('recipe.save', rec('r1', { expectedUpdatedAt: '1999-01-01T00:00:00.000Z' }), 'This recipe changed'),
    no('recipe.save', rec('bad', { ingredients: [] }), 'Add a title, at least one named ingredient'),
    no('recipe.save', rec('bad', { steps: [] }), 'Add a title, at least one named ingredient'),
    no('recipe.save', rec('bad', { ingredients: [ing('b1', '', 1, 'g')] }), 'Add a title, at least one named ingredient'),
    ok('recipe.save', { ...withoutId(rec('x')), title: 'Generated id' }),
    ok('recipe.save', rec('r2', { title: 'Side', related: ['r1', 'r2'] })),
    ok('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { images: ['https://example.com/b.jpg', 'https://example.com/c.jpg'] } })),
    ok('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { images: [] } })),
    ok('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { categories: ['Sides', 'Sauces'] } })),
    ok('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { categories: [] } })),
    ok('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { image: 'https://example.com/d.jpg', category: 'Snacks' } })),
    ok('recipe.update', s => ({
        recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s),
        changes: { title: 'Updated', favorite: true, ingredients: [{ id: 'r1-i9', name: 'pasta', amount: 200, unit: 'g' }], nutrition: { calories: 100, estimated: true }, related: ['r2'] },
    })),
    no('recipe.update', { recipeId: 'r1', expectedUpdatedAt: '1999-01-01T00:00:00.000Z', changes: { title: 'Stale' } }, 'This recipe changed'),
    no('recipe.update', { recipeId: 'r1', changes: { title: 'No expected' } }, 'This recipe changed'),
    no('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { rating: 9 } }), 'Invalid recipe changes'),
    no('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: {} }), 'Include at least one field to edit'),
    no('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { title: 'x', bogus: 1 } }), 'Invalid recipe changes'),
    no('recipe.update', { recipeId: 'ghost', expectedUpdatedAt: 'x', changes: { title: 'x' } }, 'This recipe was removed'),
    ok('recipe.favorite', { id: 'r1', favorite: true }),
    ok('recipe.favorite', { id: 'r1', favorite: false }),
    no('recipe.favorite', { id: 'r1', favorite: 'yes' }, 'Choose whether to favorite'),
    no('recipe.favorite', { id: 'ghost', favorite: true }, 'This recipe was removed'),
    ok('recipe.rate', { id: 'r1', rating: 4 }),
    ok('recipe.rate', { id: 'r1', rating: 0 }),
    no('recipe.rate', { id: 'r1', rating: 6 }, 'Choose a rating from 0 to 5'),
    no('recipe.rate', { id: 'r1', rating: 2.5 }, 'Choose a rating from 0 to 5'),
    no('recipe.rate', { id: 'r1', rating: -1 }, 'Choose a rating from 0 to 5'),
    no('recipe.rate', { id: 'ghost', rating: 3 }, 'This recipe was removed'),
    ok('menu.save', { id: 'm-both', name: 'Both', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }, { recipeId: 'r2', day: 1, slot: 'Dinner' }] }),
    ok('menu.save', { id: 'm-only', name: 'Only first', items: [{ recipeId: 'r1', day: 2, slot: 'Lunch' }] }),
    ok('plan.save', { id: 'c1', date: DAY, recipeId: 'r1', cookServings: 4, eatServings: 2 }),
    no('recipe.delete', { id: 'r1' }, 'Remove upcoming meals'),
    ok('plan.delete', { id: 'c1' }),
    ok('settings.save', settings({ autoLeftovers: false })),
    ok('plan.save', { id: 'c2', date: DAY, recipeId: 'r1', cookServings: 4, eatServings: 2 }),
    ok('cook', { planId: 'c2', cookServings: 4, eatServings: 2, usage: [] }),
    no('recipe.delete', { id: 'r1' }, 'Remove upcoming meals'),
    ok('leftover.eat', { batchId: 'c2', amount: 2 }),
    ok('recipe.delete', { id: 'r1' }),
    no('recipe.delete', { id: 'ghost' }, 'This recipe was removed'),
]);

// 2,000 recipes already stored: the 2,001st is refused.
const bulkRecipes = Array.from({ length: 2000 }, (_, i) => normalizeRecipe(rec('bulk-' + String(i).padStart(4, '0'), { title: 'Bulk ' + i }), false, at(0)));
const recipesLimit = scenario('recipes-limit', [
    no('recipe.save', rec('one-too-many'), 'Export your collection before adding more than 2,000'),
    no('recipes.import', { recipes: [rec('imported-too-many')] }, 'Export your collection before adding more than 2,000'),
], { ...initialState(), recipes: bulkRecipes });

// ---- recipe-changes ----
// recipe.update validates `changes` with recipeChangesSchema (zod) and reports its first issue. One step per rule,
// so the Kotlin port pins zod's exact message for each. Vector files sort keys, so multi-key payloads list their
// keys alphabetically here too: the order zod sees is then the order the Kotlin port sees.
const change = (changes, expect) => {
    const payload = s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), ...(changes === undefined ? {} : { changes }) });
    return expect ? no('recipe.update', payload, expect) : ok('recipe.update', payload);
};
const many = (n, value) => Array.from({ length: n }, () => value);
const line = (over = {}) => ({ id: 'r1-i1', name: 'rice', amount: 400, unit: 'g', ...over });
const recipeChanges = scenario('recipe-changes', [
    change(undefined, 'Invalid recipe changes: Invalid input: expected object, received undefined'),
    change(null, 'Invalid recipe changes: Invalid input: expected object, received null'),
    change('title', 'Invalid recipe changes: Invalid input: expected object, received string'),
    change(5, 'Invalid recipe changes: Invalid input: expected object, received number'),
    change(true, 'Invalid recipe changes: Invalid input: expected object, received boolean'),
    change([], 'Invalid recipe changes: Invalid input: expected object, received array'),
    change({}, 'Invalid recipe changes: Include at least one field to edit.'),
    change({ bogus: 1 }, 'Invalid recipe changes: Unrecognized key: "bogus"'),
    change({ bogus: 1, zz: 2 }, 'Invalid recipe changes: Unrecognized keys: "bogus", "zz"'),
    change({ bogus: 1, title: 'ok' }, 'Invalid recipe changes: Unrecognized key: "bogus"'),
    change({ title: '   ' }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ title: 'x'.repeat(201) }, 'Invalid recipe changes: Too big: expected string to have <=200 characters'),
    change({ title: 5 }, 'Invalid recipe changes: Invalid input: expected string, received number'),
    change({ title: null }, 'Invalid recipe changes: Invalid input: expected string, received null'),
    change({ description: 'x'.repeat(3001) }, 'Invalid recipe changes: Too big: expected string to have <=3000 characters'),
    change({ servings: 0 }, 'Invalid recipe changes: Too small: expected number to be >=0.000001'),
    change({ servings: 2000000 }, 'Invalid recipe changes: Too big: expected number to be <=1000000'),
    change({ servings: '2' }, 'Invalid recipe changes: Invalid input: expected number, received string'),
    change({ prepMinutes: -1 }, 'Invalid recipe changes: Too small: expected number to be >=0'),
    change({ cookMinutes: 1000001 }, 'Invalid recipe changes: Too big: expected number to be <=1000000'),
    change({ category: ' ' }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ category: 'x'.repeat(81) }, 'Invalid recipe changes: Too big: expected string to have <=80 characters'),
    change({ tags: 'quick' }, 'Invalid recipe changes: Invalid input: expected array, received string'),
    change({ tags: [1] }, 'Invalid recipe changes: Invalid input: expected string, received number'),
    change({ tags: ['ok', ' '] }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ tags: ['x'.repeat(61)] }, 'Invalid recipe changes: Too big: expected string to have <=60 characters'),
    change({ tags: [...many(30, 'ok'), 5] }, 'Invalid recipe changes: Too big: expected array to have <=30 items'),
    change({ favorite: 'yes' }, 'Invalid recipe changes: Invalid input: expected boolean, received string'),
    change({ wantToTry: 0 }, 'Invalid recipe changes: Invalid input: expected boolean, received number'),
    change({ image: 'x'.repeat(2001) }, 'Invalid recipe changes: Too big: expected string to have <=2000 characters'),
    change({ sourceUrl: 'x'.repeat(2001) }, 'Invalid recipe changes: Too big: expected string to have <=2000 characters'),
    change({ author: 'x'.repeat(201) }, 'Invalid recipe changes: Too big: expected string to have <=200 characters'),
    change({ ingredients: [] }, 'Invalid recipe changes: Too small: expected array to have >=1 items'),
    change({ ingredients: many(201, line()) }, 'Invalid recipe changes: Too big: expected array to have <=200 items'),
    change({ ingredients: [null] }, 'Invalid recipe changes: Invalid input: expected object, received null'),
    change({ ingredients: [line({ amount: undefined })] }, 'Invalid recipe changes: Invalid input: expected number, received undefined'),
    change({ ingredients: [line({ unit: undefined })] }, 'Invalid recipe changes: Invalid input: expected string, received undefined'),
    change({ ingredients: [line({ name: ' ' })] }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ ingredients: [line({ id: ' ' })] }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ ingredients: [line({ amount: -1 })] }, 'Invalid recipe changes: Too small: expected number to be >=0'),
    change({ ingredients: [line({ amount: 1000001 })] }, 'Invalid recipe changes: Too big: expected number to be <=1000000'),
    change({ ingredients: [line({ amount: '1' })] }, 'Invalid recipe changes: Invalid input: expected number, received string'),
    change({ ingredients: [line({ unit: 'x'.repeat(41) })] }, 'Invalid recipe changes: Too big: expected string to have <=40 characters'),
    change({ ingredients: [line({ group: 5 })] }, 'Invalid recipe changes: Invalid input: expected string, received number'),
    change({ ingredients: [line({ note: 'x'.repeat(501) })] }, 'Invalid recipe changes: Too big: expected string to have <=500 characters'),
    change({ ingredients: [line({ raw: 'x'.repeat(1001) })] }, 'Invalid recipe changes: Too big: expected string to have <=1000 characters'),
    change({ ingredients: [line({ extra: 1 })] }, 'Invalid recipe changes: Unrecognized key: "extra"'),
    change({ ingredients: [{ id: ' ', zz: 1 }] }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ steps: [] }, 'Invalid recipe changes: Too small: expected array to have >=1 items'),
    change({ steps: many(101, 'Cook.') }, 'Invalid recipe changes: Too big: expected array to have <=100 items'),
    change({ steps: [' ', 5] }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ steps: ['x'.repeat(5001)] }, 'Invalid recipe changes: Too big: expected string to have <=5000 characters'),
    change({ notes: 'x'.repeat(10001) }, 'Invalid recipe changes: Too big: expected string to have <=10000 characters'),
    change({ rating: 2.5 }, 'Invalid recipe changes: Invalid input: expected int, received number'),
    change({ rating: 9.5 }, 'Invalid recipe changes: Invalid input: expected int, received number'),
    change({ rating: 9 }, 'Invalid recipe changes: Too big: expected number to be <=5'),
    change({ rating: -1 }, 'Invalid recipe changes: Too small: expected number to be >=0'),
    change({ rating: 1e300 }, 'Invalid recipe changes: Too big: expected int to be <=9007199254740991'),
    change({ rating: -1e300 }, 'Invalid recipe changes: Too small: expected int to be >=-9007199254740991'),
    change({ rating: '3' }, 'Invalid recipe changes: Invalid input: expected number, received string'),
    change({ categories: [' '] }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ categories: many(11, 'Sides') }, 'Invalid recipe changes: Too big: expected array to have <=10 items'),
    change({ images: many(13, 5) }, 'Invalid recipe changes: Too big: expected array to have <=12 items'),
    change({ images: [5] }, 'Invalid recipe changes: Invalid input: expected string, received number'),
    change({ related: many(31, ' ') }, 'Invalid recipe changes: Too big: expected array to have <=30 items'),
    change({ related: ['x'.repeat(101)] }, 'Invalid recipe changes: Too big: expected string to have <=100 characters'),
    change({ nutrition: 'lots' }, 'Invalid recipe changes: Invalid input: expected object, received string'),
    change({ nutrition: [] }, 'Invalid recipe changes: Invalid input: expected object, received array'),
    change({ nutrition: { calories: -1 } }, 'Invalid recipe changes: Too small: expected number to be >=0'),
    change({ nutrition: { sodium: 1000001 } }, 'Invalid recipe changes: Too big: expected number to be <=1000000'),
    change({ nutrition: { servingSize: 'x'.repeat(81) } }, 'Invalid recipe changes: Too big: expected string to have <=80 characters'),
    change({ nutrition: { text: 5 } }, 'Invalid recipe changes: Invalid input: expected string, received number'),
    change({ nutrition: { estimated: 1 } }, 'Invalid recipe changes: Invalid input: expected boolean, received number'),
    change({ nutrition: { foo: 1 } }, 'Invalid recipe changes: Unrecognized key: "foo"'),
    // Several issues: zod reports the schema's field order first, unknown keys after, and an oversized list before its items.
    change({ bogus: 1, rating: 9 }, 'Invalid recipe changes: Too big: expected number to be <=5'),
    change({ servings: 0, title: '' }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ images: ['a'], title: '', zz: 1 }, 'Invalid recipe changes: Too small: expected string to have >=1 characters'),
    change({ tags: [...many(30, ' '), ' '] }, 'Invalid recipe changes: Too big: expected array to have <=30 items'),
    // Accepted changes.
    change({ title: '  Trimmed title  ' }),
    change({ nutrition: null }),
    change({ nutrition: {} }),
    change({ nutrition: { calories: 120.44, estimated: false, servingSize: ' 1 bowl ' } }),
    change({ categories: [' Sides ', 'Snacks'] }),
    change({ images: ['https://example.com/x.jpg'] }),
    change({ image: 'https://example.com/y.jpg', images: ['https://example.com/x.jpg'] }),
    change({ ingredients: [line({ group: 'Main', name: '  rice  ', note: 'rinsed', raw: '400 g rice' })], steps: ['  Rinse.  ', 'Cook.'] }),
    change({ rating: 5, related: [' r2 ', 'r1'], tags: [' quick '] }),
], { ...initialState(), recipes: [normalizeRecipe(rec('r1', { categories: ['Entrées', 'Dinner'] }), false, at(0)), normalizeRecipe(rec('r2'), false, at(0))] });

// ---- payload-shapes ----
// draft.save takes any object or array as its recipe (JavaScript spreads an array into an object); anything else is refused.
const payloadShapes = scenario('payload-shapes', [
    no('draft.save', { id: 'd1', recipe: 'Soup' }, 'Recipe details are required'),
    no('draft.save', { id: 'd1', recipe: 0 }, 'Recipe details are required'),
    no('draft.save', { id: 'd1', recipe: true }, 'Recipe details are required'),
    no('draft.save', { id: 'd1', recipe: '' }, 'Recipe details are required'),
    ok('draft.save', { id: 'd1', recipe: [] }),
    ok('draft.save', { recipe: [{ title: 'ignored' }, 'x'] }),
    no('recipes.import', { recipes: [['a']] }, 'Each imported recipe needs an id'),
    no('recipes.import', { recipes: ['abc'] }, 'Each imported recipe needs an id'),
    no('recipes.import', { recipes: [null] }, 'Each imported recipe needs an id'),
    no('recipes.import', { recipes: 'abc' }, 'Import between 1 and 25 recipes'),
    no('recipe.save', { id: 'r1', title: 'Shaped', ingredients: 'rice', steps: ['Cook.'] }, 'Add a title, at least one named ingredient'),
    // A new recipe ignores expectedUpdatedAt; an existing one compares it strictly.
    ok('recipe.save', { id: 'r1', title: 'Shaped', ingredients: [{ id: 'i1', name: 'rice', amount: '' }], steps: ['Cook.'], expectedUpdatedAt: '1999-01-01T00:00:00.000Z' }),
    no('recipe.save', { id: 'r1', title: 'Again', ingredients: [{ id: 'i1', name: 'rice' }], steps: ['Cook.'], expectedUpdatedAt: 5 }, 'This recipe changed'),
    // Ids are looked up strictly but stored cleaned: a numeric id never matches the stored text id. (Saving id 7
    // again would add a second menu "7", which a state patch cannot carry, so that step is left out.)
    ok('menu.save', { id: 7, name: 'Numbered', items: [{ recipeId: 'r1', day: 1 }] }),
    no('menu.save', { id: 7, name: 'Numbered again', items: [{ recipeId: 'r1' }, 'not an item'] }, 'This recipe was removed'),
    ok('menu.delete', { id: 7 }),
    ok('menu.delete', { id: '7' }),
    // The form guard runs for every command; with no record to compare, any snapshot is stale.
    no('recipe.favorite', { id: 'r1', favorite: true, __expected: 'null' }, 'This item changed'),
    no('recipe.rate', { id: 'r1', rating: 3, __expected: '{"a":' }, 'Reopen this form before saving'),
    ok('recipe.rate', { id: 'r1', rating: 3, __expected: '' }),
]);

// ---- recipes-import ----
const incomplete = (id, over = {}) => ({ id, title: 'Partial ' + id, ingredients: [], steps: [], ...over });
const recipesImport = scenario('recipes-import', [
    ok('recipes.import', { recipes: [rec('p1', { createdAt: '2026-01-01T00:00:00.000Z' }), rec('p2')] }),
    ok('recipes.import', { recipes: [rec('p1', { title: 'Skipped change' })], mode: 'skip' }),
    ok('recipes.import', { recipes: [rec('p1', { title: 'Replaced' })], mode: 'replace' }),
    ok('recipes.import', { recipes: [incomplete('p2', { title: 'Replace with incomplete' })], mode: 'replace' }),
    ok('recipes.import', { recipes: [incomplete('q1'), incomplete('q2', { ingredients: [ing('q2-i1', 'flour', 1, 'cup')] }), rec('q3', { ingredients: [ing('q3-i1', '', 1, '')] })] }),
    ok('recipes.import', { recipes: [incomplete('q1', { title: 'Second pass' })] }),
    ok('recipes.import', { recipes: [rec('q1')] }),
    no('recipes.import', { recipes: [{ title: 'No id', ingredients: [], steps: [] }] }, 'Each imported recipe needs an id'),
    no('recipes.import', { recipes: [] }, 'Import between 1 and 25 recipes'),
    no('recipes.import', {}, 'Import between 1 and 25 recipes'),
    no('recipes.import', { recipes: Array.from({ length: 26 }, (_, i) => rec('bulk-' + i)) }, 'Import between 1 and 25 recipes'),
    ok('recipes.import', { recipes: Array.from({ length: 25 }, (_, i) => rec('batch-' + i)) }),
]);

// ---- drafts ----
const drafts = scenario('drafts', [
    ok('draft.save', { id: 'd1', recipe: rec('dr1', { title: 'Draft recipe' }), text: '  pasted text  ', warnings: ['  check amounts  ', 'second'] }),
    ok('draft.save', s => ({ id: 'd1', recipe: rec('dr1', { title: 'Draft recipe 2' }), expectedUpdatedAt: s.drafts[0].recipe.updatedAt, text: 'again' })),
    no('draft.save', { id: 'd1', recipe: rec('dr1'), expectedUpdatedAt: '1999-01-01T00:00:00.000Z' }, 'This draft changed'),
    no('draft.save', { id: 'brand-new', recipe: rec('dr9'), expectedUpdatedAt: '2026-11-21T10:00:00.000Z' }, 'This draft changed'),
    ok('draft.save', { recipe: withoutId(rec('x', { title: 'Generated ids', ingredients: [ing('g1', 'egg', 1)] })) }),
    ok('draft.save', { id: 'd3', recipe: rec('dr3', { ingredients: [], steps: [] }), warnings: Array.from({ length: 25 }, (_, i) => 'w' + i), text: 'x'.repeat(60100) }),
    no('draft.save', { id: 'd4', recipe: null }, 'Recipe details are required'),
    no('draft.save', { id: 'd4' }, 'Recipe details are required'),
    ok('recipe.save', rec('dr1', { title: 'Published' })),
    ok('draft.delete', { id: 'd3' }),
    ok('draft.delete', { id: 'ghost' }),
]);

// ---- menus ----
const menus = scenario('menus', [
    ok('recipe.save', rec('r1', { servings: 2 })),
    ok('recipe.save', rec('r2', { title: 'Soup', servings: 6 })),
    ok('menu.save', { id: 'm1', name: '  Holiday  ', description: ' feast ', items: [{ recipeId: 'r1', day: 0, slot: 'Dinner' }, { recipeId: 'r2', day: 40, slot: 'Brunch' }, { recipeId: 'r1', day: '2', slot: 'Lunch' }] }),
    ok('menu.save', s => ({ id: 'm1', name: 'Holiday', items: [{ recipeId: 'r2', day: 1, slot: 'Breakfast' }, { recipeId: 'r1', day: 2.6, slot: 'Snack' }], expectedUpdatedAt: s.menus[0].updatedAt })),
    no('menu.save', { id: 'm1', name: 'Stale', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }], expectedUpdatedAt: '1999-01-01T00:00:00.000Z' }, 'This menu changed'),
    ok('menu.save', { id: 'm1', name: 'No expected', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }] }),
    ok('menu.save', { name: 'Generated id', items: [{ recipeId: 'r2', day: 3 }] }),
    no('menu.save', { id: 'm2', name: 'Ghost recipe', items: [{ recipeId: 'ghost', day: 1, slot: 'Dinner' }] }, 'This recipe was removed'),
    no('menu.save', { id: 'm2', name: '   ', items: [{ recipeId: 'r1', day: 1 }] }, 'Give the menu a name'),
    no('menu.save', { id: 'm2', name: 'Empty', items: [] }, 'Add at least one recipe'),
    no('menu.save', { id: 'm2', name: 'No items' }, 'Add at least one recipe'),
    ok('menu.plan', { menuId: 'm1', date: DAY, servings: 3 }),
    ok('menu.plan', { menuId: 'm1', date: '2026-11-09' }),
    ok('menu.plan', { menuId: 'm1', date: '2026-12-30', servings: 1 }),
    no('menu.plan', { menuId: 'ghost', date: DAY }, 'This menu was removed'),
    no('menu.plan', { menuId: 'm1', date: '2026-02-30' }, 'Choose a valid date'),
    no('menu.plan', { menuId: 'm1', date: DAY, servings: 'many' }, 'Servings must be a positive number'),
    ok('menu.delete', { id: 'm1' }),
    ok('menu.delete', { id: 'ghost' }),
]);

// 500 menus already stored: a new one is refused, an existing one can still change.
const bulkMenus = Array.from({ length: 500 }, (_, i) => ({ id: 'bulk-' + String(i).padStart(3, '0'), name: 'Menu ' + i, description: '', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }], createdAt: at(0), updatedAt: at(0) }));
const menusLimit = scenario('menus-limit', [
    no('menu.save', { id: 'one-too-many', name: 'New', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }] }, 'Remove a menu before adding more than 500'),
    ok('menu.save', { id: 'bulk-007', name: 'Renamed', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }] }),
], { ...initialState(), recipes: [normalizeRecipe(rec('r1'), false, at(0))], menus: bulkMenus });

// ---- pantry-ingredients ----
const pantryIngredients = scenario('pantry-ingredients', [
    ok('pantry.save', { id: 'p1', name: ' rice ', amount: 500, unit: ' g ', location: 'Pantry', note: ' basmati ' }),
    ok('pantry.save', { id: 'p2', name: 'milk', amount: '', unit: 'l', location: 'Fridge' }),
    ok('pantry.save', { id: 'p3', name: 'peas', amount: null, unit: '', location: 'Garage' }),
    ok('pantry.save', { id: 'p4', name: 'beans', amount: '2.5', unit: 'cans', location: 'Freezer' }),
    ok('pantry.save', { name: 'generated id', amount: 0, unit: '' }),
    ok('pantry.save', { id: 'p1', name: 'rice', amount: 250, unit: 'g', location: 'Pantry' }),
    ok('pantry.save', s => ({ ...pantryOf('p1')(s), amount: 100, __expected: JSON.stringify(pantryOf('p1')(s)) })),
    no('pantry.save', { id: 'p1', name: 'rice', amount: 5, unit: 'g', __expected: JSON.stringify({ id: 'p1', name: 'rice', amount: 1, unit: 'g', location: 'Pantry', note: '' }) }, 'This item changed'),
    no('pantry.save', { id: 'p1', name: 'rice', amount: 5, unit: 'g', __expected: 'not json' }, 'Reopen this form before saving'),
    no('pantry.save', { id: 'p9', name: 'new', amount: 1, unit: '', __expected: '{}' }, 'This item changed'),
    no('pantry.save', { id: 'p5', name: '   ', amount: 1, unit: 'g' }, 'Enter an ingredient name'),
    no('pantry.save', { id: 'p5', name: 'salt', amount: -1, unit: 'g' }, 'Amount must be zero or a positive number'),
    no('pantry.save', { id: 'p5', name: 'salt', amount: 2000000, unit: 'g' }, 'Amount must be zero or a positive number'),
    ok('pantry.delete', { id: 'p4' }),
    ok('pantry.delete', { id: 'ghost' }),
    ok('ingredient.save', { id: 'i1', name: 'scallions', aliases: 'green onions, spring onions,, ' }),
    ok('ingredient.save', { name: 'generated', aliases: '' }),
    ok('ingredient.save', { id: 'i1', name: 'Scallions', aliases: 'green onions, spring onions, shallots' }),
    no('ingredient.save', { id: 'i2', name: 'other', aliases: 'GREEN ONIONS' }, 'already belongs to another ingredient'),
    no('ingredient.save', { id: 'i2', name: 'Spring Onions', aliases: '' }, 'already belongs to another ingredient'),
    no('ingredient.save', { id: 'i2', name: 'shallots2', aliases: 'scallions' }, 'already belongs to another ingredient'),
    no('ingredient.save', { id: 'i2', name: '  ', aliases: 'x' }, 'Enter a canonical ingredient name'),
    ok('shopping.save', { id: 'sh1', name: 'scallions', amount: 2, unit: '', group: 'Produce' }),
    ok('ingredient.save', { id: 'i1', name: 'scallions', aliases: 'green onions, chives' }),
]);

// ---- shopping ----
const shoppingSetup = [
    ok('recipe.save', rec('r1', { ingredients: [ing('r1-i1', 'rice', 400, 'g'), ing('r1-i2', 'onion', 2, ''), ing('r1-i3', 'salt', null, '')] })),
    ok('pantry.save', { id: 'p1', name: 'rice', amount: 300, unit: 'g', location: 'Pantry' }),
    ok('plan.save', { id: 'c1', date: DAY, recipeId: 'r1', cookServings: 4, eatServings: 2 }),
];
const shopping = scenario('shopping', [
    ...shoppingSetup,
    ok('shopping.generate', { week: DAY }),
    no('shopping.generate', { week: 'next week' }, 'Choose a valid date'),
    ok('shopping.toggle', s => ({ id: rowOf('rice')(s).id, checked: true })),
    no('shopping.toggle', { id: 'ghost', checked: true }, 'Shopping item not found'),
    ok('shopping.save', s => ({ ...rowOf('rice')(s), amount: 200, note: 'bigger bag' })),
    ok('shopping.save', s => ({ ...rowOf('onion')(s), group: 'Produce' })),
    ok('shopping.save', s => ({ ...rowOf('onion')(s), group: 'Pantry Staples' })),
    ok('shopping.save', { id: 'm1', name: 'dish soap', amount: 1, unit: 'bottle', group: 'Household' }),
    ok('shopping.save', { id: 'm2', name: 'bread', amount: '', unit: '', group: '' }),
    no('shopping.save', { id: 'm3', name: '  ', amount: 1 }, 'Enter an item name'),
    no('shopping.save', { id: 'm3', name: 'butter', amount: -1 }, 'Purchase amount must be zero or a positive number'),
    ok('pantry.save', { id: 'p1', name: 'rice', amount: 200, unit: 'g', location: 'Pantry' }),
    ok('shopping.generate', { week: DAY }),
    ok('shopping.toggle', s => ({ id: rowOf('rice')(s).id, checked: true })),
    ok('shopping.toggle', s => ({ id: rowOf('onion')(s).id, checked: true })),
    ok('shopping.toggle', { id: 'm1', checked: true }),
    ok('shopping.purchase', s => ({ items: [{ id: rowOf('rice')(s).id, amount: 1, unit: 'kg', location: 'Pantry' }] })),
    ok('shopping.purchase', s => ({ items: [{ id: rowOf('onion')(s).id, amount: 2, unit: '', location: 'Fridge' }] })),
    ok('shopping.purchase', { items: [{ id: 'm1', amount: '', unit: 'bottle', location: 'Garage' }] }),
    no('shopping.purchase', s => ({ items: [{ id: rowOf('rice')(s).id, amount: 1, unit: 'g' }] }), 'A purchase changed or was already added'),
    no('shopping.toggle', s => ({ id: rowOf('rice')(s).id, checked: false }), 'This purchase is already in the pantry'),
    no('shopping.save', s => ({ ...rowOf('rice')(s), amount: 5 }), 'This purchase is already in the pantry'),
    ok('shopping.save', { id: 'm4', name: 'tea', amount: 1, unit: 'box', group: 'Drinks' }),
    ok('shopping.save', { id: 'm5', name: 'coffee', amount: 1, unit: 'bag' }),
    ok('shopping.toggle', { id: 'm4', checked: true }),
    no('shopping.purchase', { items: [{ id: 'm4', amount: 1, unit: 'box' }, { id: 'm4', amount: 1, unit: 'box' }] }, 'Duplicate purchase'),
    no('shopping.purchase', { items: [{ id: 'm5', amount: 1, unit: 'bag' }] }, 'A purchase changed or was already added'),
    no('shopping.purchase', { items: [{ id: 'ghost', amount: 1, unit: 'bag' }] }, 'A purchase changed or was already added'),
    no('shopping.purchase', { items: [{ id: 'm4', amount: -1, unit: 'box' }] }, 'Purchased amount must be zero or a positive number'),
    no('shopping.purchase', { items: 'm4' }, 'Review the purchases first'),
    ok('shopping.purchase', { items: [{ id: 'm4', amount: 1, unit: 'box', location: 'Pantry' }] }),
    ok('shopping.delete', { id: 'm5' }),
    ok('shopping.delete', { id: 'ghost' }),
    ok('plan.save', { id: 'c2', date: '2026-11-09', recipeId: 'r1', cookServings: 4, eatServings: 2 }),
    ok('shopping.generate', { week: '2026-11-09' }),
]);

// ---- planning ----
const planning = scenario('planning', [
    ok('recipe.save', rec('r1')),
    ok('plan.save', { id: 'c1', date: DAY, slot: 'Lunch', recipeId: 'r1', cookServings: 4, eatServings: 2, note: '  first  ' }),
    ok('plan.save', { id: 'l1', kind: 'leftover', batchId: 'c1', date: '2026-11-03', slot: 'Brunch', eatServings: 1, recipeId: 'ignored' }),
    ok('plan.save', { id: 'l1', kind: 'leftover', batchId: 'c1', date: '2026-11-04', slot: 'Lunch', eatServings: 2 }),
    no('plan.save', { id: 'x', date: '2026-02-30', recipeId: 'r1', cookServings: 4, eatServings: 2 }, 'Choose a valid date'),
    no('plan.save', { id: 'x', date: DAY, recipeId: 'r1', cookServings: 0, eatServings: 0 }, 'Servings to cook must be a positive number'),
    no('plan.save', { id: 'x', date: DAY, recipeId: 'r1', cookServings: 4, eatServings: -1 }, 'Servings to eat must be zero or a positive number'),
    no('plan.save', { id: 'x', date: DAY, recipeId: 'r1', cookServings: 2, eatServings: 3 }, 'Servings eaten now cannot exceed the batch size'),
    no('plan.save', { id: 'x', date: DAY, recipeId: 'ghost', cookServings: 2, eatServings: 1 }, 'This recipe was removed'),
    no('plan.save', { id: 'x', kind: 'leftover', batchId: 'nope', date: DAY, eatServings: 1 }, 'Choose an available or planned batch'),
    no('plan.save', { id: 'x', kind: 'leftover', batchId: 'c1', date: '2026-11-05', eatServings: 0 }, 'Servings to eat must be a positive number'),
    no('plan.save', { id: 'l2', kind: 'leftover', batchId: 'c1', date: '2026-11-05', eatServings: 1 }, 'There are not enough unassigned portions'),
    no('plan.save', { id: 'c1', date: '2026-11-05', recipeId: 'r1', cookServings: 4, eatServings: 2 }, 'The cooking date must be on or before its planned leftovers'),
    no('plan.save', { id: 'c1', kind: 'leftover', batchId: 'c1', date: DAY, eatServings: 1 }, 'Remove this batch’s planned leftovers before changing its meal type'),
    no('plan.save', { id: 'c1', date: DAY, recipeId: 'r1', cookServings: 4, eatServings: 3 }, 'This batch already has more leftover portions assigned'),
    no('plan.delete', { id: 'c1' }, 'Remove this batch’s planned leftover meals first'),
    ok('plan.move', { id: 'l1', date: '2026-11-05', slot: 'Dinner' }),
    ok('plan.move', { id: 'l1', date: '2026-11-05', slot: 'Brunch' }),
    no('plan.move', { id: 'l1', date: '2026-11-01' }, 'Leftovers have to come on or after the day the batch is cooked'),
    no('plan.move', { id: 'c1', date: '2026-11-06' }, 'Move this batch’s leftover meals first'),
    no('plan.move', { id: 'ghost', date: DAY }, 'This meal was removed'),
    no('plan.move', { id: 'l1', date: 'soon' }, 'Choose a valid date'),
    ok('plan.save', { id: 'c3', date: '2026-11-10', recipeId: 'r1', cookServings: 8, eatServings: 2 }),
    no('plan.save', { id: 'l3', kind: 'leftover', batchId: 'c3', date: '2026-11-09', eatServings: 1 }, 'Schedule leftovers on or after the cooking date'),
    ok('plan.save', { id: 'c1', date: '2026-11-01', recipeId: 'r1', cookServings: 4, eatServings: 2 }),
    ok('plan.move', { id: 'c1', date: DAY }),
    ok('plan.save', s => ({ ...planOf('c3')(s), cookServings: 6, __expected: JSON.stringify(planOf('c3')(s)) })),
    no('plan.save', s => ({ ...planOf('c3')(s), cookServings: 5, __expected: JSON.stringify({ ...planOf('c3')(s), cookServings: 1 }) }), 'This item changed'),
    ok('plan.save', { id: 'c4', date: '2026-11-12', recipeId: 'r1', cookServings: 2, eatServings: 2 }),
    ok('settings.save', settings({ autoLeftovers: false })),
    ok('cook', { planId: 'c4', cookServings: 2, eatServings: 2, usage: [] }),
    no('plan.save', { id: 'c4', date: '2026-11-13', recipeId: 'r1', cookServings: 2, eatServings: 1 }, 'A completed meal cannot be edited'),
    no('plan.move', { id: 'c4', date: '2026-11-13' }, 'A completed meal cannot be moved'),
    no('plan.delete', { id: 'c4' }, 'Completed meals stay in your cooking history'),
    ok('cook', { recipeId: 'r1', cookServings: 4, eatServings: 1, usage: [] }, { op: 'cook-adhoc' }),
    ok('plan.save', { id: 'l5', kind: 'leftover', batchId: 'cook-adhoc', date: '2026-11-14', eatServings: 2 }),
    no('plan.save', { id: 'l6', kind: 'leftover', batchId: 'cook-adhoc', date: '2026-11-15', eatServings: 2 }, 'There are not enough unassigned portions'),
    ok('plan.delete', { id: 'l5' }),
    ok('plan.delete', { id: 'l1' }),
    ok('plan.delete', { id: 'c1' }),
    ok('plan.delete', { id: 'ghost' }),
]);

// ---- cooking ----
const cookingSetup = [
    ok('recipe.save', rec('r1', { ingredients: [ing('r1-i1', 'rice', 400, 'g')] })),
    ok('recipe.save', rec('r2', { servings: 6 })),
    ok('pantry.save', { id: 'p1', name: 'rice', amount: 500, unit: 'g', location: 'Pantry' }),
    ok('pantry.save', { id: 'p2', name: 'salt', amount: null, unit: '', location: 'Pantry' }),
    ok('pantry.save', { id: 'p3', name: 'milk', amount: 1, unit: 'l', location: 'Fridge' }),
];
const reversedKeys = (record) => JSON.stringify(Object.fromEntries(Object.entries(record).reverse()));
const cooking = scenario('cooking', [
    ...cookingSetup,
    ok('plan.save', { id: 'c1', date: DAY, slot: 'Dinner', recipeId: 'r1', cookServings: 4, eatServings: 2 }),
    ok('plan.save', { id: 'l1', kind: 'leftover', batchId: 'c1', date: '2026-11-03', eatServings: 2 }),
    no('cook', { planId: 'ghost', cookServings: 1, eatServings: 0, usage: [] }, 'This recipe was removed'),
    no('cook', { planId: 'l1', cookServings: 1, eatServings: 0, usage: [] }, 'Use Eat leftovers for a prepared meal'),
    no('cook', { planId: 'c1', cookServings: 0, eatServings: 0, usage: [] }, 'Servings cooked must be a positive number'),
    no('cook', { planId: 'c1', cookServings: 2, eatServings: 3, usage: [] }, 'Servings eaten cannot exceed servings cooked'),
    no('cook', { planId: 'c1', cookServings: 3, eatServings: 2, usage: [] }, 'The actual batch has fewer portions than your planned leftovers'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: 'rice' }, 'Review your ingredient usage first'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2 }, 'Review your ingredient usage first'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: Array.from({ length: 201 }, () => ({ amount: 1 })) }, 'Review your ingredient usage first'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'nope', amount: 1, unit: 'g' }] }, 'A pantry item changed. Refresh and review usage'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p1', amount: 1, unit: 'g', expected: JSON.stringify({ id: 'p1', name: 'rice', amount: 1, unit: 'g', location: 'Pantry', note: '' }) }] }, 'An ingredient changed'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p1', amount: 1, unit: 'g', expected: 'not json' }] }, 'An ingredient changed'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p2', amount: 1, unit: '' }] }, 'Set a measured pantry amount'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p1', amount: 1, unit: 'ml' }] }, 'Set a measured pantry amount'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p1', amount: 1, unit: 'kg' }] }, 'Not enough rice'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p1', amount: 'lots', unit: 'g' }] }, 'Usage must be zero or a positive number'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p1', unit: 'g' }] }, 'Usage must be zero or a positive number'),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [{ pantryId: 'p1', amount: -2, unit: 'g' }] }, 'Usage must be zero or a positive number'),
    ok('plan.delete', { id: 'l1' }),
    ok('cook', s => ({
        planId: 'c1', cookServings: 4, eatServings: 2, location: 'Freezer',
        usage: [
            { pantryId: 'p1', amount: 0.2, unit: 'kg', expected: reversedKeys(pantryOf('p1')(s)) },
            { pantryId: 'p3', amount: null },
            { amount: 5, unit: 'g' },
        ],
    })),
    no('cook', { planId: 'c1', cookServings: 4, eatServings: 2, usage: [] }, 'This meal is already cooked'),
    ok('cook', { recipeId: 'r2', cookServings: 6, eatServings: 1, usage: [{ pantryId: 'p1', amount: 100, unit: 'g' }] }, { op: 'cook-adhoc' }),
    ok('batch.update', { id: 'cook-adhoc', remaining: 3, location: 'Freezer' }),
    ok('batch.update', { id: 'cook-adhoc', remaining: 3, location: 'Pantry' }),
    no('batch.update', { id: 'ghost', remaining: 1 }, 'Batch not found'),
    no('batch.update', { id: 'cook-adhoc', remaining: -1 }, 'Remaining portions must be zero or a positive number'),
    ok('leftover.eat', s => ({ planId: s.plan.find(x => x.auto && x.batchId === 'cook-adhoc' && !x.done).id })),
    no('leftover.eat', s => ({ planId: s.plan.find(x => x.auto && x.batchId === 'cook-adhoc' && x.done).id }), 'This meal has already been eaten'),
    ok('plan.save', { id: 'c2', date: '2026-11-20', recipeId: 'r1', cookServings: 4, eatServings: 2 }),
    ok('plan.save', { id: 'l2', kind: 'leftover', batchId: 'c2', date: '2026-11-21', eatServings: 2 }),
    no('leftover.eat', { planId: 'c2' }, 'This is a cooking entry'),
    no('leftover.eat', { planId: 'l2' }, 'Cook this batch before eating its leftovers'),
    no('leftover.eat', { batchId: 'nope', amount: 1 }, 'Cook this batch before eating its leftovers'),
    ok('settings.save', settings({ autoLeftovers: false })),
    ok('cook', { recipeId: 'r1', cookServings: 4, eatServings: 0, usage: [] }, { op: 'cook-manual' }),
    ok('plan.save', { id: 'lm', kind: 'leftover', batchId: 'cook-manual', date: '2026-11-22', eatServings: 3 }),
    no('batch.update', { id: 'cook-manual', remaining: 2 }, 'Remove leftover meal assignments before reducing below reserved portions'),
    no('leftover.eat', { batchId: 'cook-manual', amount: 2 }, 'Those portions are assigned to another meal'),
    no('leftover.eat', { batchId: 'cook-manual', amount: 0 }, 'Portions must be a positive number'),
    ok('batch.update', { id: 'cook-manual', remaining: 4, location: 'Freezer' }),
    ok('leftover.eat', { planId: 'lm' }),
    ok('leftover.eat', { batchId: 'cook-manual', amount: 1 }),
]);

// ---- settings ----
const manyLines = (n) => Array.from({ length: n }, (_, i) => 'Category ' + i).join('\n');
const settingsScenario = scenario('settings', [
    ok('settings.save', { servings: 3, weekStartsOn: 0, categories: '  Breakfast \n\nDinner / Pasta\nBreakfast', aisles: 'Produce\n Dairy \nProduce\n' + 'x'.repeat(150) }),
    ok('settings.save', s => ({ servings: '4', weekStartsOn: 5, categories: 'Entrées', autoLeftovers: false, __expected: JSON.stringify(s.settings) })),
    no('settings.save', { servings: 2, weekStartsOn: 1, categories: 'Entrées', __expected: JSON.stringify({ categories: [], servings: 1, weekStartsOn: 1 }) }, 'This item changed'),
    no('settings.save', { servings: 2, weekStartsOn: 1, categories: 'Entrées', __expected: 'not json' }, 'Reopen this form before saving'),
    no('settings.save', settings({ categories: '' }), 'Enter between 1 and 100 categories'),
    no('settings.save', settings({ categories: ' \n \n' }), 'Enter between 1 and 100 categories'),
    no('settings.save', settings({ categories: manyLines(101) }), 'Enter between 1 and 100 categories'),
    ok('settings.save', settings({ categories: manyLines(100) })),
    no('settings.save', settings({ servings: 0 }), 'Default servings must be a positive number'),
    ok('settings.save', settings()),
    ok('settings.save', settings({ aisles: 'Produce\nDairy' })),
    ok('settings.save', settings({ autoLeftovers: true })),
    ok('settings.save', settings()),
    ok('settings.save', settings({ aisles: '' })),
    ok('settings.save', settings({ aisles: 'Produce' })),
    no('settings.save', settings({ aisles: Array.from({ length: 61 }, (_, i) => 'Aisle ' + i).join('\n') }), 'Enter up to 60 aisles'),
    ok('settings.save', settings({ aisles: Array.from({ length: 60 }, (_, i) => 'Aisle ' + i).join('\n') })),
    no('recipe.favorite', { id: 'r1', favorite: true, __expected: '{}' }, 'This item changed'),
    no('nonsense.command', {}, 'Unknown action'),
    ok('settings.save', settings({ servings: 9 }), { op: 'op-0001' }),
]);

// ---- coercion ----
const photo = 'photo:11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg';
const coercion = scenario('coercion', [
    ok('recipe.save', {
        id: 'r1', title: '  Padded title  ', description: null, servings: '6', prepMinutes: '5', cookMinutes: '0', favorite: 'false', wantToTry: '',
        tags: [1, ' a ', '', 'x'.repeat(70)], rating: '7', category: '  ', image: photo,
        ingredients: [
            { id: 'i1', name: 'a', amount: '' }, { id: 'i2', name: 'b', amount: '2' }, { id: 'i3', name: 'c', amount: null }, { id: 'i4', name: 'd' },
            { id: 'i5', name: 'e', amount: '0' }, { id: 'i6', name: ' f ', amount: 2.5, unit: '  cups ' },
        ],
        steps: ['  one ', ' ', 2], notes: null, nutrition: { calories: '250.46', protein: '', fat: null, carbs: 'x', estimated: 1, servingSize: ' 1 cup ' },
    }),
    ok('recipe.save', rec('r2', { title: 'T'.repeat(250), servings: undefined, rating: 'x', related: ['r1', 'r1', ' '], sourceUrl: 'https://example.com/page' })),
    no('recipe.save', rec('r3', { ingredients: [{ id: 'i1', name: 'a', amount: 'abc' }] }), 'Ingredient amount must be zero or a positive number'),
    no('recipe.save', rec('r3', { ingredients: [{ id: 'i1', name: 'a', amount: -1 }] }), 'Ingredient amount must be zero or a positive number'),
    no('recipe.save', rec('r3', { servings: '0' }), 'Servings must be a positive number'),
    no('recipe.save', rec('r3', { prepMinutes: -1 }), 'Preparation time must be zero or a positive number'),
    no('recipe.save', rec('r3', { sourceUrl: 'ftp://example.com' }), 'Enter a valid http or https link'),
    no('recipe.save', rec('r3', { image: 'not a url' }), 'Enter a valid http or https link'),
    ok('recipe.rate', { id: 'r1', rating: '3' }),
    ok('recipe.rate', { id: 'r1', rating: '' }),
    ok('recipe.rate', { id: 'r1', rating: null }),
    no('recipe.rate', { id: 'r1' }, 'Choose a rating from 0 to 5'),
    no('recipe.favorite', { id: 'r1', favorite: 'true' }, 'Choose whether to favorite'),
    ok('pantry.save', { id: 'p1', name: 'a', amount: '', unit: '' }),
    ok('pantry.save', { id: 'p2', name: 'b', amount: null, unit: '' }),
    ok('pantry.save', { id: 'p3', name: 'c', amount: '2.5', unit: 'g' }),
    no('pantry.save', { id: 'p4', name: 'd', unit: 'g' }, 'Amount must be zero or a positive number'),
    no('pantry.save', { id: 'p4', name: 'd', amount: 'abc', unit: 'g' }, 'Amount must be zero or a positive number'),
    ok('plan.save', { id: 'c1', date: DAY, recipeId: 'r1', cookServings: '4', eatServings: '2' }),
    ok('plan.save', { id: 'l1', kind: 'leftover', batchId: 'c1', date: '2026-11-03', eatServings: '1' }),
    ok('shopping.save', { id: 's1', name: 'x', amount: '3', unit: '', checked: 'false' }),
    ok('shopping.save', { id: 's2', name: 'y', amount: '', unit: '', checked: 0 }),
    no('shopping.save', { id: 's3', name: 'z', unit: '' }, 'Purchase amount must be zero or a positive number'),
    ok('menu.save', { id: 'm1', name: 'M', items: [{ recipeId: 'r1', day: '3', slot: 'lunch' }, { recipeId: 'r1', day: null }, { recipeId: 'r1', day: 'x', slot: 'Snack' }, { recipeId: 'r1' }] }),
    ok('cook', { planId: 'c1', cookServings: '4', eatServings: '', usage: [{ pantryId: 'p3', amount: '', unit: 'g' }] }),
    ok('settings.save', { servings: '3', weekStartsOn: '0', categories: 'Entrées' }),
]);

// ---- same-millisecond ----
const sameClock = at(100);
const sameMillisecond = scenario('same-millisecond', [
    ok('recipe.save', rec('r1'), { clock: sameClock }),
    ok('recipe.save', rec('r1', { title: 'Second save' }), { clock: sameClock }),
    ok('recipe.update', s => ({ recipeId: 'r1', expectedUpdatedAt: updatedAt('r1')(s), changes: { notes: 'Update in the same millisecond' } }), { clock: sameClock }),
    ok('recipe.save', rec('r1', { title: 'Clock went backwards' }), { clock: at(50) }),
    ok('menu.save', { id: 'm1', name: 'Menu', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }] }, { clock: sameClock }),
    ok('menu.save', { id: 'm1', name: 'Menu again', items: [{ recipeId: 'r1', day: 1, slot: 'Dinner' }] }, { clock: sameClock }),
    ok('recipes.import', { recipes: [rec('r1', { title: 'Imported over' })], mode: 'replace' }, { clock: sameClock }),
    ok('draft.save', { id: 'd1', recipe: rec('dr1'), text: '' }, { clock: sameClock }),
    ok('draft.save', { id: 'd1', recipe: rec('dr1', { title: 'Again' }), text: '' }, { clock: sameClock }),
]);

export const scenarios = [
    recipesBasic, recipesLimit, recipeChanges, payloadShapes, recipesImport, drafts, menus, menusLimit, pantryIngredients, shopping, planning, cooking, settingsScenario, coercion, sameMillisecond,
];
