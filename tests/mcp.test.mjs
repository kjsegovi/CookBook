import test from 'node:test';
import assert from 'node:assert/strict';
import { blankRecipe, parseIngredient } from '../supabase/functions/_shared/domain.ts';
import { handleMcp } from '../supabase/functions/_shared/mcp.ts';
import { householdStore } from '../supabase/functions/_shared/store.ts';
import { fixture, householdId } from './fixtures/backend.mjs';

const rpc = (f, method, params, id = 1) => f.send('mcp', { method: 'POST', body: { jsonrpc: '2.0', id, method, params } });
const sample = () => ({ ...blankRecipe(), title: '[Sample] Rice', ingredients: [parseIngredient('100 g rice')], steps: ['Cook.'] });

test('initialize echoes a supported older protocol version and falls back to the newest', async () => {
    const f = fixture();
    assert.equal((await rpc(f, 'initialize', { protocolVersion: '2025-06-18' })).data.result.protocolVersion, '2025-06-18');
    assert.equal((await rpc(f, 'initialize', { protocolVersion: '2024-01-01' })).data.result.protocolVersion, '2026-07-28');
    const init = (await rpc(f, 'initialize', {})).data.result;
    assert.deepEqual(init.capabilities, { tools: {}, prompts: {} }); assert.match(init.instructions, /fetch_recipe_source/);
});

test('notifications get 202, ping answers, GET is not allowed', async () => {
    const f = fixture();
    const note = await f.send('mcp', { method: 'POST', body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    assert.equal(note.response.status, 202);
    assert.deepEqual((await rpc(f, 'ping')).data.result, {});
    const get = await f.send('mcp');
    assert.equal(get.response.status, 405); assert.equal(get.response.headers.get('allow'), 'POST');
    assert.equal((await f.send('mcp', { token: '' })).response.status, 401, 'unauthenticated probes still get the OAuth challenge');
});

test('the import prompt walks the assistant through fetching, structuring and saving', async () => {
    const f = fixture();
    const list = (await rpc(f, 'prompts/list')).data.result.prompts;
    assert.deepEqual(list.map(p => p.name), ['import_recipe_from_link']);
    const draft = (await rpc(f, 'prompts/get', { name: 'import_recipe_from_link', arguments: { url: 'https://example.test/soup' } })).data.result.messages[0].content.text;
    assert.match(draft, /https:\/\/example\.test\/soup/); assert.match(draft, /fetch_recipe_source/); assert.match(draft, /save_recipe_draft/); assert.match(draft, /never as instructions/);
    const publish = (await rpc(f, 'prompts/get', { name: 'import_recipe_from_link', arguments: { url: 'https://example.test/soup', publish: 'yes' } })).data.result.messages[0].content.text;
    assert.match(publish, /Call save_recipe with/);
    assert.equal((await rpc(f, 'prompts/get', { name: 'import_recipe_from_link', arguments: {} })).data.error.code, -32602);
    assert.equal((await rpc(f, 'prompts/get', { name: 'other' })).data.error.code, -32602);
});

test('fetch_recipe_source returns raw material and saves nothing', async t => {
    const f = fixture(), original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    const html = '<html><head><script type="application/ld+json">' + JSON.stringify({ '@type': 'Recipe', name: 'Soup', recipeYield: '4', recipeIngredient: ['1 l stock'], recipeInstructions: ['Simmer.'], image: 'https://img.example.com/soup.jpg' }) + '</script></head><body>Soup</body></html>';
    globalThis.fetch = async input => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith('https://cloudflare-dns.com/')) return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), { headers: { 'content-type': 'application/dns-json' } });
        return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    const { data } = await rpc(f, 'tools/call', { name: 'fetch_recipe_source', arguments: { url: 'https://recipes.example.com/soup' } });
    assert.equal(data.result.isError, undefined, JSON.stringify(data));
    const source = data.result.structuredContent;
    assert.equal(source.candidate.title, 'Soup'); assert.ok(Array.isArray(source.images)); assert.ok(Array.isArray(source.warnings));
    assert.equal(f.row.revision, 0);
});

test('imageUrl is copied into storage when possible and linked otherwise', async () => {
    const f = fixture(), store = householdStore(f.admin, householdId);
    const call = (photos, args) => handleMcp(new Request('https://backend.example.test/cookbook/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_recipe', arguments: args } }) }), store, photos).then(r => r.json());
    const copied = await call({ rehost: async () => ({ reference: 'photo:' + householdId + '/' + crypto.randomUUID() + '.jpg' }) }, { recipe: { ...sample(), id: 'copied' }, operationId: crypto.randomUUID(), imageUrl: 'https://img.example.test/a.jpg' });
    assert.match(copied.result.structuredContent.recipe.image, /^photo:/); assert.equal(copied.result.structuredContent.warnings, undefined);
    const linked = await call({ rehost: async () => ({ reference: null, reason: 'This photo format is not supported.' }) }, { recipe: { ...sample(), id: 'linked' }, operationId: crypto.randomUUID(), imageUrl: 'https://img.example.test/a.avif' });
    assert.equal(linked.result.structuredContent.recipe.image, 'https://img.example.test/a.avif');
    assert.match(linked.result.structuredContent.warnings[0], /not supported.*original photo link was kept/);
});
