import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/lib/sync-engine.ts';
import { initialState, blankRecipe, parseIngredient } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';
import { fixture } from './fixtures/backend.mjs';

const memory = () => { const data = new Map(); return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; };
const sample = () => ({ ...blankRecipe(), id: 'rice', title: '[Sample] Rice', ingredients: [parseIngredient('100 g rice')], steps: ['Cook.'] });
function setup({ seed, online = { value: true }, storage = memory() } = {}) {
    const f = fixture(); if (seed) f.seed(seed);
    const sent = [];
    const save = async (type, payload, id) => {
        if (!online.value) throw new TypeError('Failed to fetch');
        sent.push(type);
        const r = await f.send('command', { method: 'POST', body: { type, payload, id } });
        if (!r.response.ok) throw Object.assign(new Error(r.data.error), { status: r.response.status });
        return r.data;
    };
    const read = async () => (await f.send('state')).data;
    const make = () => new SyncEngine(f.row, { save, read, storage, key: 'outbox', online: () => online.value, retryDelay: () => 60000 });
    return { f, online, storage, sent, make };
}

test('changes apply on the device at once and sync in order', async () => {
    const { f, make } = setup(), engine = make();
    engine.enqueue('pantry.save', { id: 'rice', name: 'rice', amount: 1, unit: 'kg' });
    engine.enqueue('pantry.save', { id: 'salt', name: 'salt', amount: 1, unit: 'tsp' });
    assert.deepEqual(engine.view.state.pantry.map(p => p.id), ['rice', 'salt'], 'visible before the server answers');
    assert.equal(await engine.flush(), true);
    assert.deepEqual(f.row.state.pantry.map(p => p.id), ['rice', 'salt']); assert.equal(engine.pending, 0);
});

test('invalid changes are refused immediately and never queued', () => {
    const { make } = setup(), engine = make();
    assert.throws(() => engine.enqueue('pantry.save', { name: '', amount: null, unit: '' }), /ingredient name/);
    assert.equal(engine.pending, 0);
});

test('offline changes survive a reload and sync when back online', async () => {
    const online = { value: false }, storage = memory(), { f, make } = setup({ online, storage });
    const first = make();
    first.enqueue('shopping.save', { id: 'lemons', name: 'lemons', amount: 2, unit: '' });
    await first.flush();
    assert.equal(first.pending, 1); assert.equal(first.status.offline, true); assert.equal(f.row.revision, 0);
    first.close();
    const reopened = make();
    assert.equal(reopened.view.state.shopping[0].name, 'lemons', 'the saved outbox is replayed after a reload');
    online.value = true;
    assert.equal(await reopened.flush(), true); assert.equal(f.row.state.shopping[0].name, 'lemons'); assert.equal(storage.data.size, 0);
});

test('consecutive offline edits of the same recipe do not conflict with each other', async () => {
    const online = { value: false }, { f, make } = setup({ online, seed: applyCommand(initialState(), 'recipe.save', sample(), 'seed-rice-1') }), engine = make();
    const edit = notes => engine.enqueue('recipe.update', { recipeId: 'rice', expectedUpdatedAt: engine.view.state.recipes[0].updatedAt, changes: { notes } });
    edit('First'); await new Promise(r => setTimeout(r, 2)); edit('Second');
    assert.equal(engine.view.state.recipes[0].notes, 'Second');
    online.value = true;
    assert.equal(await engine.flush(), true, JSON.stringify(engine.status.problems));
    assert.equal(f.row.state.recipes[0].notes, 'Second');
});

test('consecutive pantry form edits and a cook review keep their checks after syncing', async () => {
    const online = { value: false }, seed = applyCommand(applyCommand(initialState(), 'recipe.save', sample(), 'seed-rice-1'), 'pantry.save', { id: 'stock', name: 'rice', amount: 1000, unit: 'g' }, 'seed-stock-1');
    const { f, make } = setup({ online, seed }), engine = make();
    const stock = () => engine.view.state.pantry[0];
    engine.enqueue('pantry.save', { ...stock(), amount: 900, __expected: JSON.stringify(stock()) });
    engine.enqueue('pantry.save', { ...stock(), amount: 800, __expected: JSON.stringify(stock()) });
    engine.enqueue('cook', { recipeId: 'rice', cookServings: 2, eatServings: 2, usage: [{ pantryId: 'stock', amount: 100, unit: 'g', expected: JSON.stringify(stock()) }] });
    online.value = true;
    assert.equal(await engine.flush(), true, JSON.stringify(engine.status.problems));
    assert.equal(f.row.state.pantry[0].amount, 700);
});

test('a real conflict becomes a problem you can keep or discard', async () => {
    const online = { value: false }, { f, make } = setup({ online, seed: applyCommand(initialState(), 'recipe.save', sample(), 'seed-rice-1') }), engine = make();
    engine.enqueue('recipe.update', { recipeId: 'rice', expectedUpdatedAt: engine.view.state.recipes[0].updatedAt, changes: { notes: 'Mine' } });
    engine.enqueue('pantry.save', { id: 'salt', name: 'salt', amount: 1, unit: 'tsp' });
    // Someone else edits the same recipe first (timestamps have millisecond precision).
    await new Promise(r => setTimeout(r, 2));
    await f.send('command', { method: 'POST', body: { type: 'recipe.update', payload: { recipeId: 'rice', expectedUpdatedAt: f.row.state.recipes[0].updatedAt, changes: { notes: 'Theirs' } }, id: 'other-device-1' } });
    online.value = true;
    assert.equal(await engine.flush(), true, 'later independent changes still sync');
    assert.equal(f.row.state.recipes[0].notes, 'Theirs'); assert.equal(f.row.state.pantry.length, 1);
    const [problem] = engine.status.problems;
    assert.equal(problem.status, 409); assert.equal(problem.type, 'recipe.update');
    await engine.refresh();
    engine.retry(problem.id, { ...problem.payload, expectedUpdatedAt: engine.view.state.recipes[0].updatedAt });
    assert.equal(await engine.flush(), true); assert.equal(f.row.state.recipes[0].notes, 'Mine'); assert.equal(engine.status.problems.length, 0);
});

test('rapid checkmark taps keep only the latest unsent choice', async () => {
    const online = { value: false }, { f, sent, make } = setup({ online, seed: applyCommand(initialState(), 'shopping.save', { id: 'lemons', name: 'lemons', amount: 2, unit: '' }, 'seed-lemons-1') }), engine = make();
    for (const checked of [true, false, true]) engine.enqueue('shopping.toggle', { id: 'lemons', checked });
    assert.equal(engine.pending, 1); assert.equal(engine.view.state.shopping[0].checked, true);
    online.value = true; await engine.flush();
    assert.deepEqual(sent, ['shopping.toggle']); assert.equal(f.row.state.shopping[0].checked, true);
});

test('a change the server already applied is not applied twice after a lost reply', async () => {
    const { f, make } = setup(), engine = make();
    const id = engine.enqueue('pantry.save', { id: 'rice', name: 'rice', amount: 1, unit: 'kg' });
    await engine.flush();
    // Same operation replayed (for example after a crash before the outbox was cleared).
    const again = new SyncEngine(f.row, { save: async (type, payload) => (await f.send('command', { method: 'POST', body: { type, payload, id } })).data, read: async () => f.row, key: 'x' });
    again.enqueue('pantry.save', { id: 'rice', name: 'rice', amount: 1, unit: 'kg' }, id);
    assert.equal(await again.flush(), true); assert.equal(f.row.revision, 1); assert.equal(f.row.state.movements.length, 1);
});
