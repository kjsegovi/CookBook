import { z } from 'zod';

export const DEFAULT_CATEGORIES = ['Breakfast', 'Entrées', 'Sauces', 'Sides', 'Snacks', 'Pastries & Desserts'];
export type IngredientLine = {
    id: string;
    name: string;
    amount: number | null;
    unit: string;
    group: string;
    note: string;
    raw: string;
};
export type Recipe = {
    id: string;
    title: string;
    description: string;
    servings: number;
    prepMinutes: number;
    cookMinutes: number;
    category: string;
    tags: string[];
    favorite: boolean;
    wantToTry: boolean;
    image: string;
    sourceUrl: string;
    author: string;
    ingredients: IngredientLine[];
    steps: string[];
    notes: string;
    createdAt: string;
    updatedAt: string;
};
export type PantryItem = {
    id: string;
    name: string;
    amount: number | null;
    unit: string;
    location: string;
    note: string;
};
export type PlanEntry = {
    id: string;
    date: string;
    slot: string;
    kind: 'cook' | 'leftover';
    recipeId: string;
    batchId: string;
    cookServings: number;
    eatServings: number;
    done: boolean;
    note: string;
    auto?: boolean;
};
export type PreparedBatch = {
    id: string;
    recipeId: string;
    title: string;
    remaining: number;
    cookedServings: number;
    preparedAt: string;
    location: string;
    planId: string;
};
export type ShoppingItem = {
    id: string;
    key: string;
    name: string;
    amount: number | null;
    unit: string;
    note: string;
    group: string;
    checked: boolean;
    manual: boolean;
    override: boolean;
    needed: number | null;
    uncertain: boolean;
    addedToPantry: boolean;
};
export type ImportDraft = {
    id: string;
    recipe: Recipe;
    text: string;
    warnings: string[];
    createdAt: string;
};
export type State = {
    recipes: Recipe[];
    pantry: PantryItem[];
    plan: PlanEntry[];
    batches: PreparedBatch[];
    shopping: ShoppingItem[];
    shoppingWeek: string;
    ingredients: {
        id: string;
        name: string;
        aliases: string[];
    }[];
    drafts: ImportDraft[];
    movements: {
        id: string;
        name: string;
        amount: number | null;
        unit: string;
        reason: string;
        at: string;
    }[];
    operations: string[];
    settings: {
        categories: string[];
        servings: number;
        weekStartsOn: number;
        autoLeftovers?: boolean;
    };
};
export class DomainError extends Error {
    status: number;
    constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const uid = () => crypto.randomUUID();
export const initialState = (): State => ({ recipes: [], pantry: [], plan: [], batches: [], shopping: [], shoppingWeek: '', ingredients: [], drafts: [], movements: [], operations: [], settings: { categories: [...DEFAULT_CATEGORIES], servings: 2, weekStartsOn: 1, autoLeftovers: true } });
export const clean = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);
export function number(v: unknown, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function positive(v: unknown, label: string, allowZero = false) { const n = Number(v); if (!Number.isFinite(n) || n < (allowZero ? 0 : 0.000001) || n > 1000000)
    throw new DomainError(`${label} must be ${allowZero ? 'zero or ' : ''}a positive number.`); return n; }
export function fraction(v: unknown): number | null { let s = clean(v, 100).replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, '$1 $2'); const f: Record<string, string> = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' }; s = s.replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, c => f[c]); if (!s)
    return null; const p = s.split(/\s+/); if (p.length > 2)
    return null; let sum = 0; for (const x of p) {
    if (/^\d+(\.\d+)?$/.test(x)) {
        sum += Number(x);
    }
    else if (/^\d+\/\d+$/.test(x)) {
        const [a, b] = x.split('/').map(Number);
        if (!b)
            return null;
        sum += a / b;
    }
    else {
        return null;
    }
} return Number.isFinite(sum) ? sum : null; }
const UNIT: Record<string, [
    string,
    number,
    string
]> = { g: ['mass', 1, 'g'], gram: ['mass', 1, 'g'], grams: ['mass', 1, 'g'], kg: ['mass', 1000, 'g'], kilogram: ['mass', 1000, 'g'], kilograms: ['mass', 1000, 'g'], oz: ['mass', 28.349523125, 'g'], ounce: ['mass', 28.349523125, 'g'], ounces: ['mass', 28.349523125, 'g'], lb: ['mass', 453.59237, 'g'], lbs: ['mass', 453.59237, 'g'], pound: ['mass', 453.59237, 'g'], pounds: ['mass', 453.59237, 'g'], ml: ['volume', 1, 'ml'], milliliter: ['volume', 1, 'ml'], milliliters: ['volume', 1, 'ml'], l: ['volume', 1000, 'ml'], liter: ['volume', 1000, 'ml'], liters: ['volume', 1000, 'ml'], tsp: ['volume', 4.92892159375, 'ml'], teaspoon: ['volume', 4.92892159375, 'ml'], teaspoons: ['volume', 4.92892159375, 'ml'], tbsp: ['volume', 14.78676478125, 'ml'], tablespoon: ['volume', 14.78676478125, 'ml'], tablespoons: ['volume', 14.78676478125, 'ml'], cup: ['volume', 236.5882365, 'ml'], cups: ['volume', 236.5882365, 'ml'], 'fl oz': ['volume', 29.5735295625, 'ml'], '': ['count', 1, ''], each: ['count', 1, ''], piece: ['count', 1, ''], pieces: ['count', 1, ''] };
export function unitInfo(unit: string): [
    string,
    number,
    string
] { let u = unit.toLowerCase().trim(); if (['egg', 'eggs', 'item', 'items'].includes(u))
    u = ''; const packages: Record<string, string> = { cans: 'can', bottles: 'bottle', cloves: 'clove', bunches: 'bunch', packages: 'package', slices: 'slice', stalks: 'stalk' }; u = packages[u] ?? u; return UNIT[u] ?? ['package:' + u, 1, u]; }
export function convert(amount: number, from: string, to: string) { const a = unitInfo(from), b = unitInfo(to); return a[0] === b[0] ? amount * a[1] / b[1] : null; }
export function formatAmount(n: number | null, unit = '') { if (n === null)
    return unit ? 'On hand · ' + unit : 'On hand'; const rounded = Math.round(n * 100) / 100; return `${rounded}${unit ? ' ' + unit : ''}`; }
export function canonical(state: State, name: string) { const n = name.toLowerCase().trim().replace(/\s+/g, ' '); const match = state.ingredients.find(i => i.name.toLowerCase() === n || i.aliases.some(a => a.toLowerCase() === n)); return match?.id ?? n; }
export function parseIngredient(raw: string): IngredientLine {
    const text = clean(raw, 1000), normalized = text.replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, '$1 $2');
    const range = normalized.match(/^(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?)\s+(.+)$/);
    const m = normalized.match(/^((?:\d+\s+(?:\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]))(?:\s+|(?=[a-zA-Z]))(.+)$/);
    let amount: number | null = null, unit = '', name = text, note = '';
    if (range) {
        name = range[2];
        note = 'Quantity range ' + range[1] + ': confirm the amount.';
    }
    else if (m) {
        amount = fraction(m[1]);
        name = m[2].trim();
    }
    const u = name.match(/^(fl oz|[a-zA-Z]+)\.?\s+(.+)$/);
    if ((range || m) && u && (UNIT[u[1].toLowerCase()] || /^(cans?|bottles?|cloves?|bunch(?:es)?|packages?|slices?|stalks?)$/i.test(u[1]))) {
        unit = u[1].toLowerCase();
        name = u[2];
    }
    return { id: uid(), name: name || text, amount, unit, group: '', note, raw: text };
}
export function blankRecipe(): Recipe { return { id: uid(), title: '', description: '', servings: 2, prepMinutes: 0, cookMinutes: 0, category: 'Entrées', tags: [], favorite: false, wantToTry: true, image: '', sourceUrl: '', author: '', ingredients: [], steps: [], notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }
export function httpUrl(input: unknown) { const s = clean(input, 2000); if (!s)
    return ''; try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        throw 0;
    return u.href;
}
catch {
    throw new DomainError('Enter a valid http or https link.');
} }
export function normalizeRecipe(input: any, allowIncomplete = false): Recipe { if (!input || typeof input !== 'object')
    throw new DomainError('Recipe details are required.'); const now = new Date().toISOString(); const recipe: Recipe = { id: clean(input.id, 100) || uid(), title: clean(input.title, 200), description: clean(input.description, 3000), servings: positive(input.servings ?? 2, 'Servings'), prepMinutes: positive(input.prepMinutes ?? 0, 'Preparation time', true), cookMinutes: positive(input.cookMinutes ?? 0, 'Cooking time', true), category: clean(input.category, 80) || 'Entrées', tags: (Array.isArray(input.tags) ? input.tags : []).slice(0, 30).map((x: unknown) => clean(x, 60)).filter(Boolean), favorite: !!input.favorite, wantToTry: !!input.wantToTry, image: /^photo:[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(clean(input.image, 2000)) ? clean(input.image, 2000) : httpUrl(input.image), sourceUrl: httpUrl(input.sourceUrl), author: clean(input.author, 200), ingredients: (Array.isArray(input.ingredients) ? input.ingredients : []).slice(0, 200).map((x: any) => ({ id: clean(x.id, 100) || uid(), name: clean(x.name, 200), amount: x.amount === null || x.amount === '' || x.amount === undefined ? null : positive(x.amount, 'Ingredient amount', true), unit: clean(x.unit, 40), group: clean(x.group, 120), note: clean(x.note, 500), raw: clean(x.raw, 1000) })), steps: (Array.isArray(input.steps) ? input.steps : []).slice(0, 100).map((x: unknown) => clean(x, 5000)).filter(Boolean), notes: clean(input.notes, 10000), createdAt: clean(input.createdAt, 40) || now, updatedAt: now }; if (!allowIncomplete && (!recipe.title || !recipe.ingredients.length || recipe.ingredients.some(i => !i.name) || !recipe.steps.length))
    throw new DomainError('Add a title, at least one named ingredient, and instructions before saving.'); return recipe; }
export function availability(state: State, recipe: Recipe, servings = recipe.servings) { return requirements(state, [{ recipe, servings }]).map(r => ({ ...r, status: r.uncertain ? 'check' : r.amount === null ? (r.present ? 'ready' : 'missing') : r.missing! > 0.00001 ? 'missing' : 'ready' })); }
type Need = {
    key: string;
    name: string;
    amount: number | null;
    unit: string;
    missing: number | null;
    uncertain: boolean;
    present: boolean;
};
export function requirements(state: State, inputs: {
    recipe: Recipe;
    servings: number;
}[]): Need[] { const map = new Map<string, Need>(); for (const { recipe, servings } of inputs)
    for (const line of recipe.ingredients) {
        const u = unitInfo(line.unit), key = canonical(state, line.name) + '|' + u[0];
        const amount = line.amount === null ? null : line.amount * servings / recipe.servings * u[1];
        const r = map.get(key);
        if (r) {
            if (r.amount === null || amount === null) {
                r.uncertain = true;
                r.amount = r.amount === null ? amount : r.amount;
            }
            else
                r.amount += amount;
        }
        else
            map.set(key, { key, name: line.name, amount, unit: u[2], missing: null, uncertain: false, present: false });
    } for (const r of map.values()) {
    const matches = state.pantry.filter(p => canonical(state, p.name) === canonical(state, r.name));
    r.present = matches.some(p => p.amount === null || p.amount > 0);
    let stock = 0, unknownStock = false;
    for (const p of matches) {
        const v = p.amount === null ? null : convert(p.amount, p.unit, r.unit);
        if (v === null) {
            if (r.amount !== null)
                unknownStock = true;
        }
        else
            stock += v;
    }
    r.missing = r.amount === null ? null : Math.max(0, r.amount - stock);
    if (unknownStock && (r.missing ?? 0) > 0.00001)
        r.uncertain = true;
    if (r.amount === null && !r.present)
        r.uncertain = true;
} return [...map.values()]; }
export function weekEnd(week: string) { const d = new Date(week + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); }
function validDate(v: unknown) { const s = clean(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T12:00:00Z')) || new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) !== s)
    throw new DomainError('Choose a valid date.'); return s; }
export function reserved(state: State, batchId: string, exceptId = '') { return state.plan.filter(p => p.kind === 'leftover' && p.batchId === batchId && !p.done && p.id !== exceptId).reduce((n, p) => n + p.eatServings, 0); }
export function shiftDate(date: string, days: number) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export const AUTO_LEFTOVER_DAYS = 4;
export function autoLeftovers(state: State, batchId: string, remaining: number, startDate: string) {
    const meals: { date: string; portions: number }[] = [];
    if (state.settings.autoLeftovers === false)
        return meals;
    const taken = new Set(state.plan.filter(p => p.kind === 'leftover' && p.batchId === batchId && !p.done).map(p => p.date));
    let left = remaining - reserved(state, batchId);
    for (let day = 1; day <= AUTO_LEFTOVER_DAYS && left > 0.000001; day++) {
        const date = shiftDate(startDate, day);
        if (taken.has(date))
            continue;
        const portions = Math.min(state.settings.servings, left);
        meals.push({ date, portions });
        left -= portions;
    }
    return meals;
}
const recipeChangesSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(3000),
    servings: z.number().min(0.000001).max(1000000),
    prepMinutes: z.number().min(0).max(1000000),
    cookMinutes: z.number().min(0).max(1000000),
    category: z.string().trim().min(1).max(80),
    tags: z.array(z.string().trim().min(1).max(60)).max(30),
    favorite: z.boolean(),
    wantToTry: z.boolean(),
    image: z.string().max(2000),
    sourceUrl: z.string().max(2000),
    author: z.string().max(200),
    ingredients: z.array(z.object({
        id: z.string().trim().min(1).max(100).optional(),
        name: z.string().trim().min(1).max(200),
        amount: z.number().min(0).max(1000000).nullable(),
        unit: z.string().max(40),
        group: z.string().max(120).optional(),
        note: z.string().max(500).optional(),
        raw: z.string().max(1000).optional(),
    }).strict()).min(1).max(200),
    steps: z.array(z.string().trim().min(1).max(5000)).min(1).max(100),
    notes: z.string().max(10000),
}).partial().strict().refine(changes => Object.keys(changes).length > 0, 'Include at least one field to edit.');
export function generatedShopping(state: State, week: string): ShoppingItem[] { const inputs = state.plan.filter(p => p.date >= week && p.date <= weekEnd(week) && p.kind === 'cook' && !p.done).map(p => ({ recipe: state.recipes.find(r => r.id === p.recipeId)!, servings: p.cookServings })).filter(x => x.recipe); return requirements(state, inputs).filter(r => r.missing === null ? !r.present : r.missing > 0.00001 || r.uncertain).map<ShoppingItem>(r => ({ id: uid(), key: r.key, name: r.name, amount: r.missing, unit: r.unit, note: r.uncertain ? 'Check amount against your pantry.' : '', group: 'Ingredients', checked: false, manual: false, override: false, needed: r.missing, uncertain: r.uncertain, addedToPantry: false } satisfies ShoppingItem)); }
export function applyCommand(original: State, type: string, p: any, operationId: string): State {
    if (original.operations.includes(operationId))
        return original;
    if (!p || typeof p !== 'object')
        throw new DomainError('Action details are required.');
    const s: State = structuredClone(original);
    const at = new Date().toISOString();
    const recipeById = (id: string) => { const r = s.recipes.find(r => r.id === id); if (!r)
        throw new DomainError('This recipe was removed. Refresh and choose another.', 404); return r; };
    const movement = (name: string, amount: number | null, unit: string, reason: string) => s.movements.push({ id: uid(), name, amount, unit, reason, at });
    const expectedRecord = type === 'pantry.save' ? s.pantry.find(x => x.id === p.id) : type === 'shopping.save' ? s.shopping.find(x => x.id === p.id) : type === 'plan.save' ? s.plan.find(x => x.id === p.id) : type === 'batch.update' ? s.batches.find(x => x.id === p.id) : undefined;
    if (p.__expected && JSON.stringify(expectedRecord) !== p.__expected)
        throw new DomainError('This item changed. Close this form and reopen it to review the latest version.', 409);
    switch (type) {
        case 'recipe.update': {
            const existing = recipeById(p.recipeId);
            if (typeof p.expectedUpdatedAt !== 'string' || !p.expectedUpdatedAt || existing.updatedAt !== p.expectedUpdatedAt)
                throw new DomainError('This recipe changed. Load the latest version before saving.', 409);
            const changes = recipeChangesSchema.safeParse(p.changes);
            if (!changes.success)
                throw new DomainError('Invalid recipe changes: ' + changes.error.issues[0].message);
            const updated = normalizeRecipe({ ...existing, ...changes.data });
            s.recipes[s.recipes.findIndex(r => r.id === existing.id)] = updated;
            break;
        }
        case 'recipe.save': {
            const r = normalizeRecipe(p);
            const old = s.recipes.findIndex(x => x.id === r.id);
            if (old >= 0 && p.expectedUpdatedAt && s.recipes[old].updatedAt !== p.expectedUpdatedAt)
                throw new DomainError('This recipe changed. Load the latest version before saving.', 409);
            if (old < 0) {
                if (s.recipes.length >= 2000)
                    throw new DomainError('Export your collection before adding more than 2,000 recipes.');
                s.recipes.push(r);
            }
            else
                s.recipes[old] = r;
            s.drafts = s.drafts.filter(d => d.recipe.id !== r.id);
            break;
        }
        case 'recipe.delete': {
            recipeById(p.id);
            if (s.plan.some(x => x.recipeId === p.id && !x.done) || s.batches.some(b => b.recipeId === p.id && b.remaining > 0))
                throw new DomainError('Remove upcoming meals and use or discard this recipe’s leftovers first.');
            s.recipes = s.recipes.filter(r => r.id !== p.id);
            break;
        }
        case 'pantry.save': {
            const item: PantryItem = { id: clean(p.id, 100) || uid(), name: clean(p.name, 200), amount: p.amount === null || p.amount === '' ? null : positive(p.amount, 'Amount', true), unit: clean(p.unit, 40), location: ['Pantry', 'Fridge', 'Freezer'].includes(p.location) ? p.location : 'Pantry', note: clean(p.note, 500) };
            if (!item.name)
                throw new DomainError('Enter an ingredient name.');
            const i = s.pantry.findIndex(x => x.id === item.id);
            if (i < 0)
                s.pantry.push(item);
            else
                s.pantry[i] = item;
            movement(item.name, item.amount, item.unit, 'Stock adjusted');
            break;
        }
        case 'pantry.delete':
            s.pantry = s.pantry.filter(x => x.id !== p.id);
            break;
        case 'ingredient.save': {
            const name = clean(p.name, 200), aliases = clean(p.aliases, 2000).split(',').map(a => a.trim()).filter(Boolean);
            if (!name)
                throw new DomainError('Enter a canonical ingredient name.');
            const id = clean(p.id, 100) || uid();
            for (const existing of s.ingredients.filter(x => x.id !== id)) {
                const names = [existing.name, ...existing.aliases].map(x => x.toLowerCase());
                if ([name, ...aliases].some(x => names.includes(x.toLowerCase())))
                    throw new DomainError('That ingredient name or alias already belongs to another ingredient.');
            }
            s.ingredients = s.ingredients.filter(x => x.id !== id);
            s.ingredients.push({ id, name, aliases });
            break;
        }
        case 'plan.save': {
            const kind = p.kind === 'leftover' ? 'leftover' : 'cook';
            const entry: PlanEntry = { id: clean(p.id, 100) || uid(), date: validDate(p.date), slot: ['Breakfast', 'Lunch', 'Dinner', 'Snack'].includes(p.slot) ? p.slot : 'Dinner', kind, recipeId: clean(p.recipeId, 100), batchId: clean(p.batchId, 100), cookServings: kind === 'cook' ? positive(p.cookServings, 'Servings to cook') : 0, eatServings: positive(p.eatServings, 'Servings to eat', kind === 'cook'), done: false, note: clean(p.note, 500) };
            const old = s.plan.find(x => x.id === entry.id);
            if (old?.done)
                throw new DomainError('A completed meal cannot be edited.');
            if (old?.kind === 'cook') {
                const dependents = s.plan.filter(x => x.batchId === old.id && !x.done);
                if (kind !== 'cook' && dependents.length)
                    throw new DomainError('Remove this batch’s planned leftovers before changing its meal type.');
                if (dependents.some(x => x.date < entry.date))
                    throw new DomainError('The cooking date must be on or before its planned leftovers.');
            }
            if (kind === 'cook') {
                recipeById(entry.recipeId);
                if (entry.eatServings > entry.cookServings)
                    throw new DomainError('Servings eaten now cannot exceed the batch size.');
                if (old && reserved(s, old.id) > entry.cookServings - entry.eatServings)
                    throw new DomainError('This batch already has more leftover portions assigned.');
            }
            else {
                const batch = s.batches.find(b => b.id === entry.batchId), planned = s.plan.find(x => x.id === entry.batchId && x.kind === 'cook' && !x.done);
                if (!batch && !planned)
                    throw new DomainError('Choose an available or planned batch.');
                const available = batch ? batch.remaining : planned!.cookServings - planned!.eatServings;
                if (reserved(s, entry.batchId, entry.id) + entry.eatServings > available + 0.000001)
                    throw new DomainError('There are not enough unassigned portions in that batch.');
                if (planned && entry.date < planned.date)
                    throw new DomainError('Schedule leftovers on or after the cooking date.');
                entry.recipeId = batch?.recipeId ?? planned!.recipeId;
            }
            s.plan = s.plan.filter(x => x.id !== entry.id);
            s.plan.push(entry);
            break;
        }
        case 'plan.delete': {
            const old = s.plan.find(x => x.id === p.id);
            if (old?.done)
                throw new DomainError('Completed meals stay in your cooking history.');
            if (s.plan.some(x => x.batchId === p.id && !x.done))
                throw new DomainError('Remove this batch’s planned leftover meals first.');
            s.plan = s.plan.filter(x => x.id !== p.id);
            break;
        }
        case 'cook': {
            const entry = s.plan.find(x => x.id === p.planId);
            if (entry?.done)
                throw new DomainError('This meal is already cooked.');
            if (entry && entry.kind !== 'cook')
                throw new DomainError('Use Eat leftovers for a prepared meal.');
            const r = recipeById(entry?.recipeId ?? p.recipeId);
            const cooked = positive(p.cookServings, 'Servings cooked'), eaten = positive(p.eatServings, 'Servings eaten', true);
            if (eaten > cooked)
                throw new DomainError('Servings eaten cannot exceed servings cooked.');
            const batchId = entry?.id ?? operationId;
            if (reserved(s, batchId) > cooked - eaten)
                throw new DomainError('The actual batch has fewer portions than your planned leftovers. Adjust those meals first.');
            if (!Array.isArray(p.usage) || p.usage.length > 200)
                throw new DomainError('Review your ingredient usage first.');
            for (const u of p.usage) {
                if (!u.pantryId)
                    continue;
                const stock = s.pantry.find(x => x.id === u.pantryId);
                if (!stock)
                    throw new DomainError('A pantry item changed. Refresh and review usage.');
                if (u.expected && JSON.stringify(stock) !== u.expected)
                    throw new DomainError('An ingredient changed. Close this review and reopen it to check the latest pantry amounts.', 409);
                if (u.amount === null)
                    continue;
                const amount = positive(u.amount, 'Usage', true), converted = convert(amount, clean(u.unit, 40), stock.unit);
                if (stock.amount === null || converted === null)
                    throw new DomainError('Set a measured pantry amount or leave this item unchanged.');
                if (converted > stock.amount + 0.000001)
                    throw new DomainError(`Not enough ${stock.name}. Adjust its stock or actual usage.`);
                stock.amount = Math.max(0, stock.amount - converted);
                movement(stock.name, -converted, stock.unit, 'Cooked ' + r.title);
            }
            s.batches.push({ id: batchId, recipeId: r.id, title: r.title, remaining: cooked - eaten, cookedServings: cooked, preparedAt: at, location: p.location === 'Freezer' ? 'Freezer' : 'Fridge', planId: entry?.id ?? '' });
            if (entry)
                entry.done = true;
            for (const meal of autoLeftovers(s, batchId, cooked - eaten, entry?.date ?? at.slice(0, 10)))
                s.plan.push({ id: uid(), date: meal.date, slot: entry?.slot ?? 'Dinner', kind: 'leftover', recipeId: r.id, batchId, cookServings: 0, eatServings: meal.portions, done: false, note: '', auto: true });
            r.wantToTry = false;
            break;
        }
        case 'leftover.eat': {
            const entry = s.plan.find(x => x.id === p.planId);
            if (entry?.done)
                throw new DomainError('This meal has already been eaten.');
            if (entry && entry.kind !== 'leftover')
                throw new DomainError('This is a cooking entry.');
            const batch = s.batches.find(x => x.id === (entry?.batchId ?? p.batchId));
            if (!batch)
                throw new DomainError('Cook this batch before eating its leftovers.');
            const amount = positive(entry?.eatServings ?? p.amount, 'Portions');
            if (amount + reserved(s, batch.id, entry?.id) > batch.remaining + 0.000001)
                throw new DomainError('Those portions are assigned to another meal. Adjust the plan first.');
            batch.remaining = Math.max(0, batch.remaining - amount);
            if (entry)
                entry.done = true;
            break;
        }
        case 'batch.update': {
            const b = s.batches.find(x => x.id === p.id);
            if (!b)
                throw new DomainError('Batch not found.');
            const n = positive(p.remaining, 'Remaining portions', true);
            let excess = reserved(s, b.id) - n;
            if (excess > 0.000001)
                for (const planned of s.plan.filter(x => x.auto && x.kind === 'leftover' && x.batchId === b.id && !x.done).sort((x, y) => y.date.localeCompare(x.date)))
                    if (excess > 0.000001) {
                        const trim = Math.min(excess, planned.eatServings);
                        if (trim >= planned.eatServings - 0.000001)
                            s.plan = s.plan.filter(x => x.id !== planned.id);
                        else
                            planned.eatServings -= trim;
                        excess -= trim;
                    }
            if (n < reserved(s, b.id))
                throw new DomainError('Remove leftover meal assignments before reducing below reserved portions.');
            b.remaining = n;
            b.location = p.location === 'Freezer' ? 'Freezer' : 'Fridge';
            break;
        }
        case 'shopping.generate': {
            const week = validDate(p.week);
            const generated = generatedShopping(s, week), old = s.shopping;
            for (const item of generated) {
                const previous = old.find(x => !x.manual && x.key === item.key && !x.addedToPantry);
                if (previous) {
                    item.id = previous.id;
                    item.checked = s.shoppingWeek === week && previous.checked;
                    item.addedToPantry = previous.addedToPantry;
                    if (previous.override) {
                        item.amount = previous.amount;
                        item.unit = previous.unit;
                        item.note = previous.note;
                        item.group = previous.group;
                        item.override = true;
                    }
                    if (previous.needed !== item.needed && !item.addedToPantry)
                        item.checked = false;
                }
            }
            s.shopping = [...generated, ...old.filter(x => x.manual || (!generated.some(g => g.key === x.key) && (x.override || x.checked)))];
            s.shoppingWeek = week;
            break;
        }
        case 'shopping.save': {
            const old = s.shopping.find(x => x.id === p.id);
            if (old?.addedToPantry)
                throw new DomainError('This purchase is already in the pantry. Add a new item for another purchase.');
            const item: ShoppingItem = { id: clean(p.id, 100) || uid(), key: old?.key ?? uid(), name: clean(p.name, 200), amount: p.amount === null || p.amount === '' ? null : positive(p.amount, 'Purchase amount', true), unit: clean(p.unit, 40), note: clean(p.note, 500), group: clean(p.group, 100) || 'Other', checked: !!p.checked, manual: old?.manual ?? true, override: old ? !old.manual : false, needed: old?.needed ?? null, uncertain: old?.uncertain ?? false, addedToPantry: false };
            if (!item.name)
                throw new DomainError('Enter an item name.');
            s.shopping = s.shopping.filter(x => x.id !== item.id);
            s.shopping.push(item);
            break;
        }
        case 'shopping.toggle': {
            const item = s.shopping.find(x => x.id === p.id);
            if (!item)
                throw new DomainError('Shopping item not found.');
            item.checked = !!p.checked;
            break;
        }
        case 'shopping.delete':
            s.shopping = s.shopping.filter(x => x.id !== p.id);
            break;
        case 'shopping.purchase': {
            if (!Array.isArray(p.items) || p.items.length > 500)
                throw new DomainError('Review the purchases first.');
            const seen = new Set<string>();
            for (const row of p.items) {
                if (seen.has(row.id))
                    throw new DomainError('Duplicate purchase.');
                seen.add(row.id);
                const item = s.shopping.find(x => x.id === row.id);
                if (!item || !item.checked || item.addedToPantry)
                    throw new DomainError('A purchase changed or was already added. Refresh and review.');
                const amount = row.amount === null || row.amount === '' ? null : positive(row.amount, 'Purchased amount', true), unit = clean(row.unit, 40);
                const existing = s.pantry.find(x => canonical(s, x.name) === canonical(s, item.name) && x.location === (row.location ?? 'Pantry') && x.amount !== null && amount !== null && convert(amount, unit, x.unit) !== null);
                if (existing && amount !== null)
                    existing.amount = existing.amount! + convert(amount, unit, existing.unit)!;
                else
                    s.pantry.push({ id: uid(), name: item.name, amount, unit, location: ['Pantry', 'Fridge', 'Freezer'].includes(row.location) ? row.location : 'Pantry', note: '' });
                item.addedToPantry = true;
                movement(item.name, amount, unit, 'Purchased');
            }
            break;
        }
        case 'draft.save': {
            const existing = s.drafts.find(x => x.id === p.id);
            if (p.expectedUpdatedAt && existing?.recipe.updatedAt !== p.expectedUpdatedAt)
                throw new DomainError('This draft changed. Load the latest version before saving.', 409);
            const recipe = normalizeRecipe(p.recipe, true), draft: ImportDraft = { id: clean(p.id, 100) || uid(), recipe, text: clean(p.text, 60000), warnings: (Array.isArray(p.warnings) ? p.warnings : []).slice(0, 20).map((v: unknown) => clean(v, 500)), createdAt: at };
            s.drafts = s.drafts.filter(x => x.id !== draft.id);
            s.drafts.push(draft);
            break;
        }
        case 'draft.delete':
            s.drafts = s.drafts.filter(x => x.id !== p.id);
            break;
        case 'settings.save': {
            s.settings.servings = positive(p.servings, 'Default servings');
            s.settings.weekStartsOn = p.weekStartsOn === 0 ? 0 : 1;
            s.settings.autoLeftovers = p.autoLeftovers === undefined ? s.settings.autoLeftovers !== false : !!p.autoLeftovers;
            const cats = clean(p.categories, 2000).split('\n').map(c => c.trim()).filter(Boolean);
            if (!cats.length || cats.length > 40)
                throw new DomainError('Enter between 1 and 40 categories.');
            s.settings.categories = [...new Set(cats)];
            break;
        }
        default: throw new DomainError('Unknown action.');
    }
    s.operations.push(operationId);
    return s;
}
