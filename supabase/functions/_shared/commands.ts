import { z } from 'zod';
import { acknowledgeRemindersSync, applyRemindersSync } from './reminders-domain.ts';
import { stableJson } from './state-patch.ts';
import { autoLeftovers, blankRecipe, canonical, clean, convert, DomainError, generatedShopping, normalizeRecipe, positive, reserved, shiftDate, uid, validDate, weekEnd, type State, type PantryItem, type PlanEntry, type PreparedBatch, type ShoppingItem, type ImportDraft, type Recipe } from './domain.ts';

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
    const expectedRecord = type === 'pantry.save' ? s.pantry.find(x => x.id === p.id) : type === 'shopping.save' ? s.shopping.find(x => x.id === p.id) : type === 'plan.save' ? s.plan.find(x => x.id === p.id) : type === 'batch.update' ? s.batches.find(x => x.id === p.id) : type === 'settings.save' ? s.settings : undefined;
    if (p.__expected) {
        let expected: unknown;
        try { expected = JSON.parse(p.__expected); } catch { throw new DomainError('Reopen this form before saving.', 409); }
        if (stableJson(expectedRecord) !== stableJson(expected)) throw new DomainError('This item changed. Close this form and reopen it to review the latest version.', 409);
    }
    switch (type) {
        case 'recipe.favorite': {
            const recipe = recipeById(p.id);
            if (typeof p.favorite !== 'boolean') throw new DomainError('Choose whether to favorite this recipe.');
            if (!p.expectedUpdatedAt || p.expectedUpdatedAt !== recipe.updatedAt) throw new DomainError('This recipe changed. Load the latest version before saving.', 409);
            recipe.favorite = p.favorite;
            recipe.updatedAt = at;
            break;
        }
        case 'reminders.sync':
            applyRemindersSync(s, p.scope, p.observations, p.observationsHash);
            break;
        case 'reminders.ack':
            acknowledgeRemindersSync(s, p.scope);
            break;
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
            if (item.addedToPantry) throw new DomainError('This purchase is already in the pantry.');
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
