import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedLink } from '../src/lib/share.ts';
import { SnapshotStore } from '../src/lib/snapshot-store.ts';
import { SnapshotCache } from '../src/lib/snapshot-cache.ts';
import { initialState } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';
import { statePatch } from '../supabase/functions/_shared/state-patch.ts';

const householdId = '10000000-0000-4000-8000-000000000001';
const memory = () => { const data = new Map(); return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; };

test('shared links are found in share-url, url, text or title', () => {
    assert.equal(sharedLink('?share-url=https%3A%2F%2Fexample.com%2Fsoup'), 'https://example.com/soup');
    assert.equal(sharedLink('?title=Soup&text=Try%20this%20https%3A%2F%2Fexample.com%2Fsoup.'), 'https://example.com/soup');
    assert.equal(sharedLink('?url=https%3A%2F%2Fyoutu.be%2Fabc'), 'https://youtu.be/abc');
    assert.equal(sharedLink('?auth=recovery'), '');
    assert.equal(sharedLink('?text=javascript%3Aalert(1)'), '', 'only web links are accepted');
});

test('a refresh applies only the changes since the saved revision', async () => {
    const base = { householdId, revision: 4, state: initialState() };
    const next = applyCommand(base.state, 'pantry.save', { id: 'rice', name: 'rice', amount: 1, unit: 'kg' }, 'stock-rice-1');
    const reads = [];
    const cache = new SnapshotCache('changes', memory()); cache.write(base);
    const store = new SnapshotStore(async revision => { reads.push(revision); return { householdId, baseRevision: 4, revision: 5, patch: statePatch(base.state, next) }; }, cache);
    const result = await store.read();
    assert.deepEqual(reads, [4]); assert.equal(result.revision, 5); assert.equal(result.state.pantry[0].name, 'rice');
    assert.equal(cache.read().revision, 5, 'the saved copy advances too');
});

test('changes for a different base revision fall back to a full read', async () => {
    const base = { householdId, revision: 4, state: initialState() }, full = { householdId, revision: 9, state: initialState() };
    const reads = [], cache = new SnapshotCache('changes-mismatch', memory()); cache.write(base);
    const store = new SnapshotStore(async revision => { reads.push(revision); return revision === null ? full : { householdId, baseRevision: 2, revision: 9, patch: { collections: {}, values: {}, appendOperations: [] } }; }, cache);
    assert.equal((await store.read()).revision, 9); assert.deepEqual(reads, [4, null]);
});
