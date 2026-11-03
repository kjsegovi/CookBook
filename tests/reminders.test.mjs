import test from 'node:test';
import assert from 'node:assert/strict';
import { remindersHandoff, remindersReturnId, REMINDERS_SHORTCUT, MAX_REMINDERS_URL_LENGTH } from '../src/lib/reminders.ts';
import { createSyncScope, itemMarker } from '../supabase/functions/_shared/reminders-domain.ts';
import { signScope } from '../supabase/functions/_shared/reminders-auth.ts';
import { initialState } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';
import { readBackup } from '../supabase/functions/_shared/backup.ts';
import { fixture, householdId } from './fixtures/backend.mjs';
import { buildRemindersShortcut } from '../scripts/reminders-shortcut.mjs';

const grocery = (changes = {}) => ({ id: 'row', key: 'rice|mass', name: 'rice', amount: 100, unit: 'g', note: 'Brown rice', group: 'Ingredients', checked: false, manual: false, override: false, needed: 100, uncertain: false, addedToPantry: false, ...changes });
const seed = (f, items = [grocery()]) => { const s = initialState(); s.shopping = items; s.shoppingWeek = '2026-11-02'; f.seed(s); return f; };
const begin = async f => { const r = await f.send('reminders/begin', { method: 'POST', body: { list: 'Groceries', returnUrl: 'https://kitchen.example.test/CookBook/' } }); assert.equal(r.response.status, 200, JSON.stringify(r.data)); return r.data; };
const observations = (payload, checked = false, exists = true) => payload.scope.items.map(i => ({ marker: i.marker, count: exists ? 1 : 0, completed: exists && checked ? 1 : 0 }));
const native = (f, path, payload, rows) => f.send('reminders/' + path, { method: 'POST', body: { payload, ...(rows ? { observations: rows } : {}) }, token: null, household: null, origin: null });
const finish = async (f, payload, rows, ack = true) => {
    const result = await native(f, 'finish', payload, rows); assert.equal(result.response.status, 200, JSON.stringify(result.data));
    if (ack) { const r = await native(f, 'ack', payload); assert.equal(r.response.status, 200, JSON.stringify(r.data)); }
    return result.data;
};
const toggle = (f, checked) => f.seed(applyCommand(f.row.state, 'shopping.toggle', { id: 'row', checked }, crypto.randomUUID()));

test('sync includes checked groceries, amounts and uncertainty, and excludes unlinked past purchases', () => {
    const state = initialState(); state.shopping = [grocery(), grocery({ id: 'salt', key: 'salt', name: 'salt', checked: true, amount: null, uncertain: true }), grocery({ id: 'old', addedToPantry: true })];
    const before = structuredClone(state), scope = createSyncScope(state, householdId, 'user', ' Groceries ');
    assert.equal(scope.list, 'Groceries'); assert.equal(scope.items.length, 2);
    assert.equal(scope.items[1].checked, true); assert.match(scope.items[1].title, /Check amount/); assert.match(scope.items[1].notes, /Check pantry/);
    assert.equal(scope.expiresAt - scope.issuedAt, 900000); assert.deepEqual(state, before);
    assert.throws(() => createSyncScope(state, householdId, 'user', ' '), /list name/);
});

test('markers isolate households, new purchase rows and generated shopping weeks', () => {
    const state = initialState(), item = grocery(); state.shoppingWeek = '2026-11-02';
    const marker = itemMarker(householdId, state, item);
    assert.notEqual(marker, itemMarker('other', state, item));
    assert.notEqual(marker, itemMarker(householdId, state, { ...item, id: 'new-purchase' }));
    state.shoppingWeek = '2026-11-09'; assert.notEqual(marker, itemMarker(householdId, state, item));
    assert.equal(itemMarker(householdId, state, { ...item, manual: true }), itemMarker(householdId, { ...state, shoppingWeek: '2026-11-16' }, { ...item, manual: true }));
});

test('checkmarks round-trip in both directions, including reopening, without changing the pantry', async () => {
    const f = seed(fixture()); let p = await begin(f);
    await finish(f, p, observations(p, false, false));
    p = await begin(f); await finish(f, p, observations(p, true)); assert.equal(f.row.state.shopping[0].checked, true);
    p = await begin(f); await finish(f, p, observations(p, false)); assert.equal(f.row.state.shopping[0].checked, false);
    toggle(f, true); p = await begin(f); const pushed = await finish(f, p, observations(p, false));
    assert.equal(pushed.items[0].checked, true); assert.equal(f.row.state.shopping[0].checked, true);
    toggle(f, false); p = await begin(f); const reopened = await finish(f, p, observations(p, true));
    assert.equal(reopened.items[0].checked, false); assert.deepEqual(f.row.state.pantry, []); assert.deepEqual(f.row.state.movements, []);
});

test('a local checkmark changed while the Shortcut reads wins, and partial uploads fail atomically', async () => {
    const f = seed(fixture(), [grocery(), grocery({ id: 'other', key: 'other' })]), p = await begin(f);
    toggle(f, true);
    const before = f.row;
    const incomplete = await native(f, 'finish', p, observations(p).slice(0, 1)); assert.equal(incomplete.response.status, 400); assert.deepEqual(f.row, before);
    const result = await finish(f, p, observations(p, false)); assert.equal(result.items.find(i => i.id === 'row').checked, true);
});

test('changed quantities are skipped and keep the prior baseline for the next sync', async () => {
    const f = seed(fixture()); let p = await begin(f); await finish(f, p, observations(p, true));
    p = await begin(f);
    f.seed(applyCommand(f.row.state, 'shopping.save', { ...f.row.state.shopping[0], amount: 200, checked: false }, crypto.randomUUID()));
    const skipped = await finish(f, p, observations(p, true)); assert.equal(skipped.skipped, 1); assert.equal(skipped.items.length, 0);
    p = await begin(f); const result = await finish(f, p, observations(p, true));
    assert.equal(result.items[0].checked, false); assert.match(result.items[0].title, /200 g/);
});

test('interrupted Reminders writes do not advance the baseline and are repaired on the next sync', async () => {
    const f = seed(fixture()); let p = await begin(f); await finish(f, p, observations(p, false));
    toggle(f, true); p = await begin(f); await finish(f, p, observations(p, false), false);
    assert.equal(f.row.state.reminders[0].receipt.acknowledged, false); assert.equal(f.row.state.reminders[0].entries[0].checked, false);
    p = await begin(f); assert.equal(p.scope.items[0].pending, true);
    const recovered = await finish(f, p, observations(p, false)); assert.equal(recovered.items[0].checked, true);
});

test('duplicates, old runs and replayed changes cannot silently overwrite a later sync', async () => {
    const f = seed(fixture()), old = await begin(f), p = await begin(f), before = f.row;
    const duplicate = await native(f, 'finish', p, [{ marker: p.scope.items[0].marker, count: 2, completed: 1 }]);
    assert.equal(duplicate.response.status, 409); assert.deepEqual(f.row, before);
    await finish(f, p, observations(p, false)); const revision = f.row.revision;
    const retry = await native(f, 'finish', p, observations(p, false)); assert.equal(retry.response.status, 200); assert.equal(f.row.revision, revision);
    const changed = await native(f, 'finish', p, observations(p, true)); assert.equal(changed.response.status, 409);
    const stale = await native(f, 'finish', old, observations(old, true)); assert.equal(stale.response.status, 409);
    const next = await begin(f); await finish(f, next, observations(next, true));
    assert.equal((await native(f, 'ack', p)).response.status, 409); assert.equal(f.row.state.shopping[0].checked, true);
});

test('forged, modified, expired and revoked scopes are rejected before grocery writes', async () => {
    const f = seed(fixture()), p = await begin(f), before = f.row;
    for (const changed of [{ ...p, signature: 'x'.repeat(43) }, { ...p, scope: { ...p.scope, household: '10000000-0000-4000-8000-000000000002' } }, { ...p, scope: { ...p.scope, items: [{ ...p.scope.items[0], checked: true }] } }]) {
        assert.equal((await native(f, 'finish', changed, observations(p))).response.status, 401); assert.deepEqual(f.row, before);
    }
    const expired = { ...p, scope: { ...p.scope, issuedAt: Date.now() - 960000, expiresAt: Date.now() - 60000 } };
    expired.signature = await signScope(expired.scope, 'synthetic-test-reminders-signing-key');
    assert.equal((await native(f, 'finish', expired, observations(p))).response.status, 401);
    const revoked = seed(fixture()); revoked.revoke();
    assert.equal((await native(revoked, 'finish', p, observations(p))).response.status, 403);
    assert.deepEqual(f.row, before);
    const bypass = await f.send('command', { method: 'POST', body: { type: 'reminders.sync', payload: {}, id: crypto.randomUUID(), revision: 0 } }); assert.equal(bypass.response.status, 403);
    const offsite = await f.send('reminders/begin', { method: 'POST', body: { list: 'Groceries', returnUrl: 'https://attacker.example/' } }); assert.equal(offsite.response.status, 403);
});

test('signatures survive dictionary ordering, and status confirms completion only after native acknowledgement', async () => {
    const f = seed(fixture()), p = await begin(f);
    const reordered = { ...p, scope: Object.fromEntries(Object.entries(p.scope).reverse()) };
    assert.equal((await f.send('reminders/status?id=' + p.scope.id)).data.phase, 'waiting');
    await finish(f, reordered, observations(p, true), false);
    assert.equal((await f.send('reminders/status?id=' + p.scope.id)).data.phase, 'finishing');
    await native(f, 'ack', p);
    assert.equal((await f.send('reminders/status?id=' + p.scope.id)).data.phase, 'complete');
    const restored = readBackup({ format: 'cookbook-household-v1', state: f.row.state }); assert.deepEqual(restored.reminders, []);
});

test('purchased rows stay completed and missing checked reminders are not fabricated', async () => {
    const f = seed(fixture()); let p = await begin(f); const absent = await finish(f, p, observations(p, false, false)); assert.equal(absent.items.length, 1);
    toggle(f, true); p = await begin(f); const done = await finish(f, p, observations(p, false, false)); assert.equal(done.items.length, 0);
    toggle(f, false); p = await begin(f); await finish(f, p, observations(p, false));
    f.seed({ ...f.row.state, shopping: f.row.state.shopping.map(i => ({ ...i, checked: true, addedToPantry: true })) });
    p = await begin(f); const result = await finish(f, p, observations(p, false)); assert.equal(result.items[0].checked, true);
});

test('handoffs preserve Unicode, use the clipboard for long lists and parse only valid return IDs', async () => {
    const f = seed(fixture(), [grocery({ name: 'jalapeños & café #1', note: 'Two lines\n50% off?' })]), p = await begin(f);
    const handoff = remindersHandoff(p), url = new URL(handoff.url);
    assert.equal(url.searchParams.get('name'), REMINDERS_SHORTCUT); assert.deepEqual(JSON.parse(url.searchParams.get('text')), p);
    assert.ok(!/access_token|refresh_token|apikey|password/.test(handoff.text));
    const long = remindersHandoff({ ...p, scope: { ...p.scope, items: Array(100).fill(p.scope.items[0]) } });
    assert.equal(long.clipboard, true); assert.equal(new URL(long.url).searchParams.get('input'), 'clipboard'); assert.ok(long.url.length < MAX_REMINDERS_URL_LENGTH);
    assert.equal(remindersReturnId('#/shopping?reminders-sync=' + p.scope.id), p.scope.id); assert.equal(remindersReturnId('#/recipes?reminders-sync=' + p.scope.id), null); assert.equal(remindersReturnId('#/shopping?reminders-sync=bad'), null);
});

// Execute the serialized native workflow with synthetic reminders and the real local API handler.
// This covers cross-app control flow, request construction, retries and native writes without
// installing the Shortcut or granting it access to personal Reminders.
async function runWorkflow(workflow, envelope, reminders, f) {
    const outputs = new Map(), variables = new Map(); let returned;
    const resolve = state => {
        if (state?.Type === 'Variable' && state.Variable) return resolve(state.Variable);
        if (state?.WFSerializationType === 'WFTextTokenString') {
            let text = state.Value.string;
            for (const [range, value] of Object.entries(state.Value.attachmentsByRange).sort((a, b) => parseInt(b[0].slice(1)) - parseInt(a[0].slice(1)))) {
                const index = parseInt(range.slice(1)); text = text.slice(0, index) + String(resolve({ Value: value, WFSerializationType: 'WFTextTokenAttachment' })) + text.slice(index + 1);
            }
            return text;
        }
        if (state?.WFSerializationType === 'WFTextTokenAttachment') {
            const v = state.Value;
            if (v.Type === 'ExtensionInput') return JSON.stringify(envelope);
            if (v.Type === 'Variable') return variables.get(v.VariableName);
            return outputs.get(v.OutputUUID);
        }
        return state;
    };
    const property = { List: 'list', Notes: 'notes', Title: 'title', 'Is Completed': 'completed' };
    const execute = async actions => {
        let last;
        for (let i = 0; i < actions.length; i++) {
            const a = actions[i], p = a.WFWorkflowActionParameters, kind = a.WFWorkflowActionIdentifier.replace('is.workflow.actions.', ''); let result;
            if (p.WFControlFlowMode === 0) {
                const end = actions.findIndex((a, j) => j > i && a.WFWorkflowActionParameters.GroupingIdentifier === p.GroupingIdentifier && a.WFWorkflowActionParameters.WFControlFlowMode === 2);
                assert.ok(end > i);
                if (kind === 'repeat.each') {
                    result = [];
                    for (const item of resolve(p.WFInput) ?? []) { variables.set('Repeat Item', item); result.push(await execute(actions.slice(i + 1, end))); }
                    outputs.set(actions[end].WFWorkflowActionParameters.UUID, result);
                } else {
                    const otherwise = actions.findIndex((a, j) => j > i && j < end && a.WFWorkflowActionParameters.GroupingIdentifier === p.GroupingIdentifier && a.WFWorkflowActionParameters.WFControlFlowMode === 1);
                    const v = resolve(p.WFInput), hasValue = Array.isArray(v) ? v.length > 0 : v != null && v !== '';
                    const yes = p.WFCondition === 4 ? String(v) === String(p.WFConditionalActionString) : p.WFCondition === 100 ? hasValue : !hasValue;
                    if (yes) result = await execute(actions.slice(i + 1, otherwise < 0 ? end : otherwise)); else if (otherwise >= 0) result = await execute(actions.slice(otherwise + 1, end));
                }
                i = end; last = result; continue;
            }
            if (kind === 'comment' || kind === 'alert') continue;
            if (kind === 'exit') throw new Error('Shortcut stopped');
            if (kind === 'detect.dictionary') result = JSON.parse(resolve(p.WFInput));
            else if (kind === 'getvalueforkey') result = resolve(p.WFInput)?.[p.WFDictionaryKey];
            else if (kind === 'setvariable') { result = resolve(p.WFInput); variables.set(p.WFVariableName, result); }
            else if (kind === 'gettext') result = resolve(p.WFTextActionText);
            else if (kind === 'count') result = (resolve(p.Input) ?? []).length;
            else if (kind === 'text.combine') result = resolve(p.text).join(p.WFTextCustomSeparator);
            else if (kind === 'filter.reminders') {
                const filter = p.WFContentItemFilter.Value; assert.equal(filter.WFActionParameterFilterPrefix, 1);
                result = reminders.filter(r => filter.WFActionParameterFilterTemplates.every(row => {
                    const value = r[property[row.Property]], target = resolve(Object.values(row.Values)[0]);
                    return row.Operator === 99 ? String(value || '').includes(target) : typeof value === 'string' ? value.toLowerCase() === target.toLowerCase() : value === target;
                }));
            } else if (kind === 'downloadurl') {
                assert.equal(p.WFHTTPMethod, 'POST'); assert.equal(p.WFHTTPBodyType, 'File');
                const url = new URL(resolve(p.WFURL)); assert.equal(url.origin, 'https://backend.example.test');
                const body = JSON.parse(resolve(p.WFRequestVariable)), response = await f.send(url.pathname.split('/cookbook/')[1], { method: 'POST', body, token: null, household: null, origin: null });
                assert.equal(response.response.status, 200, JSON.stringify(response.data)); result = response.data;
            } else if (kind === 'setters.reminders') {
                const key = property[p.WFContentItemPropertyName]; assert.ok(['title', 'notes', 'completed'].includes(key));
                for (const r of resolve(p.WFInput)) r[key] = resolve(p['WFReminderContentItem' + p.WFContentItemPropertyName.replaceAll(' ', '')]);
            } else if (kind === 'addnewreminder') {
                result = [{ list: resolve(p.WFCalendarDescriptor), title: resolve(p.WFCalendarItemTitle), notes: resolve(p.WFCalendarItemNotes), completed: false }]; reminders.push(...result);
            } else if (kind === 'openurl') returned = resolve(p.WFInput);
            else assert.fail('Unknown native action ' + kind);
            outputs.set(p.UUID, result); last = result;
        }
        return last;
    };
    await execute(workflow.WFWorkflowActions); return returned;
}

test('serialized Shortcut performs actual read/merge/write/ack requests and both checkmark directions', async () => {
    const f = seed(fixture()), workflow = buildRemindersShortcut();
    const unrelated = { list: 'Groceries', title: 'Call the store', notes: 'Personal note', completed: false }, reminders = [structuredClone(unrelated)];
    let p = await begin(f); const returned = await runWorkflow(workflow, p, reminders, f);
    assert.equal(returned, p.returnUrl); assert.equal(reminders.length, 2); assert.equal(f.row.state.reminders[0].receipt.acknowledged, true);
    reminders[1].completed = true; p = await begin(f); await runWorkflow(workflow, p, reminders, f); assert.equal(f.row.state.shopping[0].checked, true);
    toggle(f, false); p = await begin(f); await runWorkflow(workflow, p, reminders, f); assert.equal(reminders[1].completed, false);
    f.seed(applyCommand(f.row.state, 'shopping.save', { ...f.row.state.shopping[0], amount: 200 }, crypto.randomUUID()));
    p = await begin(f); await runWorkflow(workflow, p, reminders, f); assert.equal(reminders.length, 2); assert.equal(reminders[1].title, 'rice — 200 g');
    assert.deepEqual(reminders[0], unrelated); assert.deepEqual(f.row.state.pantry, []);
});

test('serialized Shortcut adopts only unfinished v1 reminders and keeps completed historical rows', async () => {
    const f = seed(fixture()), workflow = buildRemindersShortcut(), p = await begin(f), legacy = p.scope.items[0].legacyMarker;
    const reminders = [{ list: 'Groceries', title: 'Old completed rice', notes: legacy, completed: true }, { list: 'Groceries', title: 'Rice', notes: legacy, completed: false }];
    await runWorkflow(workflow, p, reminders, f);
    assert.equal(reminders.length, 2); assert.equal(reminders[0].completed, true); assert.equal(reminders[0].notes, legacy);
    assert.match(reminders[1].notes, /cookbook-v2:/); assert.equal(reminders[1].title, 'rice — 100 g');
});
