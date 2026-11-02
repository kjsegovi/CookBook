import { z } from 'zod';
import { DomainError, normalizeRecipe, type State } from './domain.ts';
const id = z.string().min(1).max(100), text = (max: number) => z.string().max(max);
const amount = z.number().finite().min(0).max(1000000), quantity = amount.nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s + 'T12:00:00Z'); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s; });
const stateSchema = z.object({
    recipes: z.array(z.unknown()).max(2000),
    pantry: z.array(z.object({ id, name: text(200).min(1), amount: quantity, unit: text(40), location: z.enum(['Pantry','Fridge','Freezer']), note: text(500) }).strict()).max(10000),
    plan: z.array(z.object({ id, date, slot: z.enum(['Breakfast','Lunch','Dinner','Snack']), kind: z.enum(['cook','leftover']), recipeId: id, batchId: text(100), cookServings: amount, eatServings: amount, done: z.boolean(), note: text(500) }).strict()).max(10000),
    batches: z.array(z.object({ id, recipeId: id, title: text(200), remaining: amount, cookedServings: amount.positive(), preparedAt: text(40), location: z.enum(['Fridge','Freezer']), planId: text(100) }).strict()).max(10000),
    shopping: z.array(z.object({ id, key: id, name: text(200).min(1), amount: quantity, unit: text(40), note: text(500), group: text(100), checked: z.boolean(), manual: z.boolean(), override: z.boolean(), needed: quantity, uncertain: z.boolean(), addedToPantry: z.boolean() }).strict()).max(10000),
    shoppingWeek: z.union([z.literal(''), date]),
    ingredients: z.array(z.object({ id, name: text(200).min(1), aliases: z.array(text(200)).max(200) }).strict()).max(10000),
    drafts: z.array(z.object({ id, recipe: z.unknown(), text: text(60000), warnings: z.array(text(500)).max(20), createdAt: text(40) }).strict()).max(2000),
    movements: z.array(z.object({ id, name: text(200), amount: z.number().finite().min(-1000000).max(1000000).nullable(), unit: text(40), reason: text(500), at: text(40) }).strict()).max(20000),
    operations: z.array(id).max(50000),
    settings: z.object({ categories: z.array(text(80).min(1)).min(1).max(40), servings: amount.positive(), weekStartsOn: z.union([z.literal(0), z.literal(1)]) }).strict(),
}).strict();
export function readBackup(input: unknown): State {
    const envelope = z.object({ format: z.literal('cookbook-household-v1'), state: stateSchema }).passthrough().safeParse(input);
    if (!envelope.success) throw new DomainError('This is not a valid CookBook household export.');
    const s = envelope.data.state;
    const recipes = s.recipes.map(r => normalizeRecipe(r)), drafts = s.drafts.map(d => ({ ...d, recipe: normalizeRecipe(d.recipe, true) }));
    const state: State = { ...s, recipes, drafts, operations: [] };
    for (const collection of [state.recipes, state.pantry, state.plan, state.batches, state.shopping, state.ingredients, state.drafts, state.movements]) {
        if (new Set(collection.map(row => row.id)).size !== collection.length) throw new DomainError('This backup contains duplicate record IDs.');
    }
    const ids = new Set(state.recipes.map(r => r.id));
    if ([...state.plan, ...state.batches].some(row => !ids.has(row.recipeId))) throw new DomainError('This backup has meals with missing recipes.');
    if (state.plan.some(p => p.kind === 'leftover' && !p.done && !state.batches.some(b => b.id === p.batchId) && !state.plan.some(b => b.id === p.batchId && b.kind === 'cook' && !b.done))) throw new DomainError('This backup has leftovers with missing batches.');
    return state;
}
