import type { RemindersConnection } from './reminders-domain.ts';

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
    reminders?: RemindersConnection[];
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
export function positive(v: unknown, label: string, allowZero = false) { const n = Number(v); if (!Number.isFinite(n) || n < (allowZero ? 0 : 0.000001) || n > 1000000)
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
export type InventoryIndex = { canonical: (name: string) => string; pantry: Map<string, PantryItem[]> };
export function inventoryIndex(state: Pick<State, 'pantry' | 'ingredients'>): InventoryIndex {
    const aliases = new Map<string, string>();
    for (const ingredient of state.ingredients) for (const name of [ingredient.name, ...ingredient.aliases]) {
        const key = name.toLowerCase(); if (!aliases.has(key)) aliases.set(key, ingredient.id);
    }
    const identify = (name: string) => { const key = name.toLowerCase().trim().replace(/\s+/g, ' '); return aliases.get(key) ?? key; };
    const pantry = new Map<string, PantryItem[]>();
    for (const item of state.pantry) { const key = identify(item.name), rows = pantry.get(key) ?? []; rows.push(item); pantry.set(key, rows); }
    return { canonical: identify, pantry };
}
export function availability(state: State, recipe: Recipe, servings = recipe.servings, inventory?: InventoryIndex) { return requirements(state, [{ recipe, servings }], inventory).map(r => ({ ...r, status: r.uncertain ? 'check' : r.amount === null ? (r.present ? 'ready' : 'missing') : r.missing! > 0.00001 ? 'missing' : 'ready' })); }
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
}[], inventory?: InventoryIndex): Need[] { const identify = inventory?.canonical ?? ((name: string) => canonical(state, name)); const map = new Map<string, Need>(); for (const { recipe, servings } of inputs)
    for (const line of recipe.ingredients) {
        const u = unitInfo(line.unit), key = identify(line.name) + '|' + u[0];
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
    const matches = inventory ? inventory.pantry.get(identify(r.name)) ?? [] : state.pantry.filter(p => identify(p.name) === identify(r.name));
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
export function validDate(v: unknown) { const s = clean(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T12:00:00Z')) || new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) !== s)
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
export function generatedShopping(state: State, week: string): ShoppingItem[] { const inputs = state.plan.filter(p => p.date >= week && p.date <= weekEnd(week) && p.kind === 'cook' && !p.done).map(p => ({ recipe: state.recipes.find(r => r.id === p.recipeId)!, servings: p.cookServings })).filter(x => x.recipe); return requirements(state, inputs).filter(r => r.missing === null ? !r.present : r.missing > 0.00001 || r.uncertain).map<ShoppingItem>(r => ({ id: uid(), key: r.key, name: r.name, amount: r.missing, unit: r.unit, note: r.uncertain ? 'Check amount against your pantry.' : '', group: 'Ingredients', checked: false, manual: false, override: false, needed: r.missing, uncertain: r.uncertain, addedToPantry: false } satisfies ShoppingItem)); }
