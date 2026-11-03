import test from 'node:test';
import assert from 'node:assert/strict';
import { ShoppingQueue } from '../src/lib/shopping-queue.ts';
import { initialState } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(saveOverride, readOverride) {
    let state = initialState();
    for (const id of ['rice', 'lemons']) state = applyCommand(state, 'shopping.save', { id, name: id, amount: 2, unit: '' }, crypto.randomUUID());
    let server = { state, revision: 0 }, view, pending = false;
    const calls = [], errors = [], views = [];
    const save = async (type, payload, id, revision) => {
        calls.push({ type, payload, id, revision });
        if (saveOverride) await saveOverride({ type, payload, id, revision, get server() { return server; } });
        if (revision !== server.revision) throw Object.assign(new Error('Changed'), { status: 409 });
        server = { state: applyCommand(server.state, type, payload, id), revision: revision + 1 };
        return structuredClone(server);
    };
    const queue = new ShoppingQueue({
        save,
        read: async () => { if (readOverride) await readOverride(); return structuredClone(server); },
        onSnapshot: snapshot => { view = snapshot; views.push(snapshot); },
        onPending: value => { pending = value; },
        onError: message => errors.push(message),
    });
    queue.accept(structuredClone(server));
    return { queue, calls, errors, views, get view() { return view; }, get server() { return server; }, set server(value) { server = value; }, get pending() { return pending; } };
}
const checked = (snapshot, id) => snapshot.state.shopping.find(item => item.id === id)?.checked;

test('checkmarks update synchronously while slow saves run one at a time', async () => {
    const first = deferred(), second = deferred();
    let saves = 0;
    const f = fixture(async () => { await (++saves === 1 ? first.promise : second.promise); });
    f.queue.toggle('rice', true);
    assert.equal(checked(f.view, 'rice'), true);
    assert.equal(f.pending, true);
    assert.equal(f.calls.length, 0, 'render is not waiting for a network response');
    await tick();
    f.queue.toggle('lemons', true);
    assert.equal(checked(f.view, 'lemons'), true);
    assert.equal(f.calls.length, 1, 'the second request must wait for the new revision');
    let flushed = false;
    const done = f.queue.flush().then(saved => { flushed = true; return saved; });
    first.resolve(); await tick();
    assert.equal(flushed, false);
    assert.equal(checked(f.view, 'lemons'), true, 'first response must not erase the second optimistic tap');
    assert.deepEqual(f.calls.map(call => call.revision), [0, 1]);
    second.resolve(); assert.equal(await done, true);
    assert.equal(f.pending, false);
    for (const id of ['rice', 'lemons']) assert.equal(checked(f.server, id), true);
});

test('rapid changes to the same grocery keep the last tap and coalesce redundant writes', async () => {
    const gate = deferred(), f = fixture(() => gate.promise);
    f.queue.toggle('rice', true); await tick();
    f.queue.toggle('rice', false);
    assert.equal(checked(f.view, 'rice'), false);
    f.queue.toggle('rice', true);
    f.queue.toggle('rice', false);
    gate.resolve(); assert.equal(await f.queue.flush(), true);
    assert.equal(checked(f.server, 'rice'), false);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls.map(call => call.payload.checked), [true, false]);
});

test('returning to an in-flight checkmark needs no extra server write', async () => {
    const gate = deferred(), f = fixture(() => gate.promise);
    f.queue.toggle('rice', true); await tick();
    f.queue.toggle('rice', false); f.queue.toggle('rice', true);
    gate.resolve(); await f.queue.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(checked(f.server, 'rice'), true);
});

test('database JSON key reordering does not turn a rapid follow-up tap into a conflict', async () => {
    const gate = deferred(); let f;
    f = fixture(async () => {
        await gate.promise;
        f.server.state.shopping = f.server.state.shopping.map(item => Object.fromEntries(Object.entries(item).reverse()));
    });
    f.queue.toggle('rice', true); await tick();
    f.queue.toggle('rice', false);
    gate.resolve();
    assert.equal(await f.queue.flush(), true);
    assert.equal(f.calls.length, 2);
    assert.equal(checked(f.server, 'rice'), false);
    assert.deepEqual(f.errors, []);
});

test('same-tick check and uncheck needs no network request', async () => {
    const f = fixture();
    f.queue.toggle('rice', true); f.queue.toggle('rice', false);
    assert.equal(await f.queue.flush(), true);
    assert.equal(f.calls.length, 0);
    assert.equal(checked(f.view, 'rice'), false);
});

test('failed saves roll back unsaved checkmarks and show an error', async () => {
    const f = fixture(() => { throw Object.assign(new Error('Rejected'), { status: 400 }); });
    f.queue.toggle('rice', true); f.queue.toggle('lemons', true);
    assert.equal(await f.queue.flush(), false);
    assert.equal(checked(f.view, 'rice'), false);
    assert.equal(checked(f.view, 'lemons'), false);
    assert.equal(f.pending, false);
    assert.equal(f.calls.length, 1);
    assert.match(f.errors[0], /could not be saved/);
    assert.equal(f.server.revision, 0);
});

test('a later failure keeps the checkmarks that were already confirmed', async () => {
    const f = fixture(({ payload }) => {
        if (payload.id === 'lemons') throw Object.assign(new Error('Rejected'), { status: 400 });
    });
    f.queue.toggle('rice', true); f.queue.toggle('lemons', true);
    assert.equal(await f.queue.flush(), false);
    assert.equal(checked(f.view, 'rice'), true);
    assert.equal(checked(f.view, 'lemons'), false);
    assert.equal(f.view.revision, 1);
    assert.equal(f.pending, false);
    assert.equal(f.errors.length, 1);
});

test('a dropped response after a successful save is recognized without applying it twice', async () => {
    let f;
    f = fixture(({ type, payload, id, revision }) => {
        f.server = { state: applyCommand(f.server.state, type, payload, id), revision: revision + 1 };
        throw new TypeError('Connection lost');
    });
    f.queue.toggle('rice', true);
    assert.equal(await f.queue.flush(), true);
    assert.equal(f.server.revision, 1);
    assert.equal(checked(f.view, 'rice'), true);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.errors, []);
});

test('unrelated household changes are retained when a checkmark is retried at the latest revision', async () => {
    const f = fixture();
    f.server = { state: { ...f.server.state, settings: { ...f.server.state.settings, servings: 4 } }, revision: 1 };
    f.queue.toggle('rice', true);
    assert.equal(await f.queue.flush(), true);
    assert.deepEqual(f.calls.map(call => call.revision), [0, 1]);
    assert.equal(f.calls[0].id, f.calls[1].id, 'retry retains its duplicate-safe operation ID');
    assert.equal(f.view.state.settings.servings, 4);
    assert.equal(checked(f.server, 'rice'), true);
});

test('a removed, edited, purchased or regenerated grocery is never silently checked by an old tap', async () => {
    for (const change of ['removed', 'amount', 'purchased', 'week']) {
        const f = fixture();
        if (change === 'week') {
            f.server.state.shopping[0].manual = false;
            f.server.state.shoppingWeek = '2026-11-02';
            f.queue.accept(structuredClone(f.server));
        }
        const newer = structuredClone(f.server);
        newer.revision++;
        if (change === 'removed') newer.state.shopping.shift();
        if (change === 'amount') newer.state.shopping[0].amount = 7;
        if (change === 'purchased') newer.state.shopping[0].addedToPantry = true;
        if (change === 'week') newer.state.shoppingWeek = '2026-11-09';
        f.server = newer;
        f.queue.toggle('rice', true);
        assert.equal(await f.queue.flush(), false, change);
        assert.equal(f.calls.length, 1, change);
        assert.deepEqual(f.view, newer, change);
        assert.match(f.errors[0], /another session/, change);
    }
});

test('a stale focus refresh cannot erase a completed save', async () => {
    const f = fixture(), old = structuredClone(f.server);
    f.queue.toggle('rice', true); await f.queue.flush();
    f.queue.accept(old);
    assert.equal(f.view.revision, 1);
    assert.equal(checked(f.view, 'rice'), true);
});

test('connection failures stop after bounded retries even when recovery also fails', async () => {
    let reads = 0;
    const f = fixture(() => { throw new TypeError('Offline'); }, () => { reads++; throw new TypeError('Offline'); });
    f.queue.toggle('rice', true);
    assert.equal(await f.queue.flush(), false);
    assert.equal(f.pending, false);
    assert.equal(checked(f.view, 'rice'), false);
    assert.equal(f.calls.length, 1);
    assert.equal(reads, 2);
    assert.equal(f.errors.length, 1);
});

test('repeated revision conflicts stop after three attempts', async () => {
    let f;
    f = fixture(() => { f.server.revision++; });
    f.queue.toggle('rice', true);
    assert.equal(await f.queue.flush(), false);
    assert.equal(f.calls.length, 3);
    assert.equal(f.errors.length, 1);
    assert.equal(checked(f.view, 'rice'), false);
});

test('already purchased and unknown items do not enter the queue', async () => {
    const f = fixture(); f.server.state.shopping[0].addedToPantry = true;
    f.queue.accept(structuredClone(f.server));
    f.queue.toggle('rice', true); f.queue.toggle('missing', true);
    assert.equal(await f.queue.flush(), true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.queue.pending, false);
});
