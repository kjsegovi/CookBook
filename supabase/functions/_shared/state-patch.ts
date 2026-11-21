import type { State } from './domain.ts';

export const collections = ['recipes', 'pantry', 'plan', 'batches', 'shopping', 'ingredients', 'drafts', 'movements', 'menus'] as const;
export type Collection = typeof collections[number];
export type Row = { id: string };
export type StatePatch = {
    collections: Partial<Record<Collection, { upsert: Row[]; remove: string[]; order?: string[] }>>;
    values: Partial<Pick<State, 'settings' | 'shoppingWeek' | 'reminders'>>;
    appendOperations: string[];
};
export type Snapshot = { state: State; revision: number; householdId: string };
export type Delta = { householdId: string; baseRevision: number; revision: number; patch: StatePatch };

// JSONB and JavaScript can return object keys in different orders.
export function stableJson(value: unknown): string {
    return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
// Copies of a record usually keep their key order, so the fast native
// comparison settles most rows; key-order-independent comparison is the fallback.
const sameRow = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) || stableJson(a) === stableJson(b);
export function statePatch(before: State, after: State): StatePatch {
    const patch: StatePatch = { collections: {}, values: {}, appendOperations: [] };
    for (const key of collections) {
        const previous = new Map<string, Row>((before[key] ?? []).map(row => [row.id, row]));
        const next = new Set((after[key] ?? []).map(row => row.id));
        const upsert = (after[key] ?? []).filter(row => { const old = previous.get(row.id); return !old || (old !== row && !sameRow(old, row)); });
        const remove = (before[key] ?? []).filter(row => !next.has(row.id)).map(row => row.id);
        const reordered = (before[key] ?? []).map(row => row.id).join('\0') !== (after[key] ?? []).map(row => row.id).join('\0');
        if (upsert.length || remove.length || reordered) patch.collections[key] = { upsert, remove, ...(reordered ? { order: (after[key] ?? []).map(row => row.id) } : {}) };
    }
    for (const key of ['settings', 'shoppingWeek', 'reminders'] as const) {
        if (stableJson(before[key]) !== stableJson(after[key])) Object.assign(patch.values, { [key]: after[key] });
    }
    // Operation ids are stored in their own table; only new ones are sent.
    const known = new Set(before.operations);
    patch.appendOperations = after.operations.filter(id => !known.has(id));
    return patch;
}
export function applyStatePatch(original: State, patch: StatePatch): State {
    const next = { ...original, ...patch.values };
    for (const key of collections) {
        const change = patch.collections[key];
        if (!change) continue;
        const rows = new Map<string, Row>((original[key] ?? []).map(row => [row.id, row]));
        for (const id of change.remove) rows.delete(id);
        for (const row of change.upsert) rows.set(row.id, row);
        const ordered = change.order ? change.order.map(id => {
            const row = rows.get(id);
            if (!row) throw new Error('The cookbook update is incomplete. Reload to get the latest version.');
            return row;
        }) : [...rows.values()];
        if (ordered.length !== rows.size || new Set(ordered.map(row => row.id)).size !== rows.size) throw new Error('The cookbook update is incomplete. Reload to get the latest version.');
        (next as unknown as Record<string, unknown>)[key] = ordered;
    }
    // Clients keep only recent ids for recognising their own retries.
    if (patch.appendOperations.length) next.operations = [...next.operations, ...patch.appendOperations].slice(-200);
    return next;
}
