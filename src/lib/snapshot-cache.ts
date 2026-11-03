import type { Snapshot } from '../../supabase/functions/_shared/state-patch.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const lifetime = 24 * 60 * 60 * 1000;
const arrays = ['recipes','pantry','plan','batches','shopping','ingredients','drafts','movements','operations'] as const;
export class SnapshotCache {
    private storage?: StorageLike;
    private key: string;
    constructor(key: string, storage?: StorageLike) { this.key = 'cookbook-snapshot-v2:' + key; this.storage = storage; }
    read(now = Date.now()): Snapshot | null {
        try {
            const text = this.storage?.getItem(this.key);
            if (!text) return null;
            const record = JSON.parse(text), snapshot = record.snapshot as Snapshot;
            if (typeof record.at !== 'number' || now - record.at > lifetime || record.at > now + 60000 || !snapshot ||
                !/^[0-9a-f-]{36}$/i.test(snapshot.householdId) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
                !snapshot.state || arrays.some(key => !Array.isArray(snapshot.state[key])) ||
                !snapshot.state.settings || !Array.isArray(snapshot.state.settings.categories) || !Number.isFinite(snapshot.state.settings.servings) ||
                typeof snapshot.state.shoppingWeek !== 'string') throw new Error('Invalid cache');
            return snapshot;
        } catch { this.clear(); return null; }
    }
    write(snapshot: Snapshot, now = Date.now()) {
        try { this.storage?.setItem(this.key, JSON.stringify({ at: now, snapshot })); } catch { /* Storage is optional, including on devices with full or disabled storage. */ }
    }
    clear() { try { this.storage?.removeItem(this.key); } catch { /* Optional browser storage. */ } }
}
