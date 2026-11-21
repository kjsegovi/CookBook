import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, blankRecipe, parseIngredient } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';
import { fixture, householdId } from './fixtures/backend.mjs';

const sample = () => ({ ...blankRecipe(), title: '[Sample] Rice', ingredients: [parseIngredient('100 g rice')], steps: ['Cook.'] });
const mcp = (f, name, args = {}) => f.send('mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
const command = (f, type, payload, extra = {}) => f.send('command', { method: 'POST', body: { type, payload, id: crypto.randomUUID(), ...extra } });

test('an unrelated change between get_recipe and update_recipe no longer conflicts', async () => {
    const f = fixture(), r = sample();
    f.seed(applyCommand(applyCommand(initialState(), 'recipe.save', r, crypto.randomUUID()), 'shopping.save', { id: 'lemons', name: 'lemons', amount: 2, unit: '' }, crypto.randomUUID()));
    const current = (await mcp(f, 'get_recipe', { recipeId: r.id })).data.result.structuredContent;
    assert.equal((await command(f, 'shopping.toggle', { id: 'lemons', checked: true }, { revision: f.row.revision })).response.status, 200);
    const saved = await mcp(f, 'update_recipe', { recipeId: r.id, revision: current.revision, expectedUpdatedAt: current.updatedAt, operationId: crypto.randomUUID(), changes: { notes: 'Covered pot' } });
    assert.equal(saved.data.result.isError, undefined, JSON.stringify(saved.data));
    assert.equal(f.row.state.recipes[0].notes, 'Covered pot'); assert.equal(f.row.state.shopping[0].checked, true);
});

test('MCP save_recipe works without a revision and a retry applies once', async () => {
    const f = fixture(), operationId = crypto.randomUUID(), recipe = sample();
    const call = () => mcp(f, 'save_recipe', { recipe, operationId });
    const first = await call(), second = await call();
    assert.equal(first.data.result.isError, undefined, JSON.stringify(first.data)); assert.equal(second.data.result.isError, undefined);
    assert.equal(f.row.revision, 1); assert.equal(f.row.state.recipes.length, 1);
});

test('commands without a revision are accepted', async () => {
    const f = fixture();
    const { response } = await command(f, 'pantry.save', { name: 'rice', amount: 1, unit: 'kg' });
    assert.equal(response.status, 200); assert.equal(f.row.state.pantry.length, 1);
});

test('a favourite does not change updatedAt, so an open edit still saves', async () => {
    const f = fixture(), r = sample(); f.seed(applyCommand(initialState(), 'recipe.save', r, crypto.randomUUID()));
    const before = f.row.state.recipes[0];
    assert.equal((await command(f, 'recipe.favorite', { id: r.id, favorite: true })).response.status, 200);
    assert.equal(f.row.state.recipes[0].updatedAt, before.updatedAt);
    const edit = await command(f, 'recipe.update', { recipeId: r.id, expectedUpdatedAt: before.updatedAt, changes: { notes: 'Still mine' } });
    assert.equal(edit.response.status, 200, JSON.stringify(edit.data)); assert.equal(f.row.state.recipes[0].favorite, true);
    const fast = await f.admin.rpc('set_cookbook_flag', { command_type: 'recipe.favorite', record_id: r.id, checked: false, operation_id: 'fast-favorite-no-guard', expected_revision: 0 });
    assert.equal(fast.error, null); assert.equal(f.row.state.recipes[0].favorite, false);
});

test('ids created by a command derive from its operation id', () => {
    let s = applyCommand(initialState(), 'recipe.save', { ...sample(), id: 'rice-recipe', servings: 2 }, 'save-rice-1');
    s = applyCommand(s, 'pantry.save', { id: 'rice', name: 'rice', amount: 1000, unit: 'g' }, 'stock-rice-1');
    const cook = state => applyCommand(state, 'cook', { recipeId: 'rice-recipe', cookServings: 6, eatServings: 2, usage: [] }, 'cook-rice-0001');
    const a = cook(s), b = cook(s);
    assert.deepEqual(a.plan.map(p => p.id), b.plan.map(p => p.id));
    assert.ok(a.plan.length > 0 && a.plan.every(p => p.id.startsWith('cook-rice-0001-')));
    assert.equal(a.batches[0].id, 'cook-rice-0001');
    const saved = applyCommand(initialState(), 'shopping.save', { name: 'lemons', amount: 1, unit: '' }, 'add-lemons-1');
    assert.equal(saved.shopping[0].id, 'add-lemons-1-1');
});

test('a lost write race re-applies the command to the newer cookbook', async () => {
    const f = fixture(), rpc = f.admin.rpc.bind(f.admin); let raced = false;
    f.admin.rpc = async (name, input) => {
        if (name === 'write_cookbook_patch' && !raced) {
            raced = true;
            // Another device saves first.
            await rpc('write_cookbook_patch', { ...input, patch: { collections: { pantry: { upsert: [{ id: 'salt', name: 'salt', amount: 1, unit: 'tsp', location: 'Pantry', note: '' }], remove: [] } }, values: {}, appendOperations: ['other-device-1'] } });
        }
        return rpc(name, input);
    };
    const { response } = await command(f, 'pantry.save', { id: 'rice', name: 'rice', amount: 1, unit: 'kg' }, { revision: 0 });
    assert.equal(response.status, 200);
    assert.deepEqual(f.row.state.pantry.map(p => p.id).sort(), ['rice', 'salt']); assert.equal(f.row.revision, 2);
});

test('an old retry that no longer applies is recognised as already saved', async () => {
    const f = fixture(), r = sample();
    f.seed(applyCommand(initialState(), 'recipe.save', r, crypto.randomUUID()));
    const id = 'delete-rice-0001';
    assert.equal((await f.send('command', { method: 'POST', body: { type: 'recipe.delete', payload: { id: r.id }, id } })).response.status, 200);
    // Push the operation out of the recent window carried in snapshots.
    for (let i = 0; i < 205; i++) await command(f, 'shopping.save', { id: 'item', name: 'item ' + i, amount: 1, unit: '' });
    const retry = await f.send('command', { method: 'POST', body: { type: 'recipe.delete', payload: { id: r.id }, id } });
    assert.equal(retry.response.status, 200, JSON.stringify(retry.data));
});

test('records are capped one at a time instead of the whole cookbook', async () => {
    const f = fixture(), state = initialState();
    state.recipes = Array.from({ length: 400 }, (_, i) => ({ ...sample(), id: 'r' + i, notes: 'x'.repeat(5000) })); f.seed(state);
    assert.ok(JSON.stringify(state).length > 1700000);
    assert.equal((await command(f, 'pantry.save', { name: 'rice', amount: 1, unit: 'kg' })).response.status, 200);
    const huge = await command(f, 'draft.save', { recipe: { title: 'Huge' }, text: 'y'.repeat(60000), warnings: Array(20).fill('z'.repeat(500)) });
    assert.equal(huge.response.status, 200, 'drafts at their limits still fit one record');
    const tooLarge = await command(f, 'recipe.save', { ...sample(), steps: Array(100).fill('s'.repeat(5000)) });
    assert.equal(tooLarge.response.status, 413); assert.equal(f.row.state.recipes.length, 400);
});

test('a photo added offline keeps the id the device chose, and re-uploading succeeds', async () => {
    const f = fixture(), id = crypto.randomUUID();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const upload = query => f.handler(new Request('https://backend.example.test/cookbook/photos' + query, { method: 'POST', headers: { authorization: 'Bearer valid', 'content-type': 'image/png' }, body: png }));
    const first = await upload('?id=' + id), second = await upload('?id=' + id);
    assert.equal(first.status, 200); assert.equal((await first.json()).url, 'photo:' + householdId + '/' + id + '.png');
    assert.equal(second.status, 200);
    assert.equal((await upload('?id=not-a-uuid')).status, 400);
});
