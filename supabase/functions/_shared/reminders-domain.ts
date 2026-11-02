import { z } from 'zod';
import { DomainError, formatAmount, type ShoppingItem, type State } from './domain.ts';

export const MAX_SYNC_ITEMS = 250;
const id = z.string().min(1).max(100);
const marker = z.string().min(1).max(1200);
const entrySchema = z.object({ id, marker, checked: z.boolean() }).strict();
const resultSchema = entrySchema.extend({ title: z.string().max(300), notes: z.string().max(2200), legacyMarker: marker, create: z.boolean() }).strict();
const receiptSchema = z.object({ id, issuedAt: z.number().int(), observationsHash: z.string().max(100), acknowledged: z.boolean(), skipped: z.number().int().min(0), items: z.array(resultSchema).max(MAX_SYNC_ITEMS) }).strict();
export const remindersConnectionsSchema = z.array(z.object({ key: z.string().max(250), userId: id, list: z.string().min(1).max(100), entries: z.array(entrySchema).max(MAX_SYNC_ITEMS), receipt: receiptSchema }).strict()).max(20);
export type RemindersConnection = z.infer<typeof remindersConnectionsSchema>[number];
export type SyncResult = z.infer<typeof resultSchema>;
export const syncScopeSchema = z.object({
    version: z.literal(2), id: z.string().uuid(), household: z.string().uuid(), userId: id,
    list: z.string().trim().min(1).max(100), connection: z.string().min(1).max(250), previousSync: z.string().nullable(),
    issuedAt: z.number().int(), expiresAt: z.number().int(),
    items: z.array(z.object({ id, marker, legacyMarker: marker, title: z.string().max(300), notes: z.string().max(2200), guard: z.string().max(2600), checked: z.boolean(), baseline: z.boolean().nullable(), pending: z.boolean() }).strict()).min(1).max(MAX_SYNC_ITEMS),
}).strict();
export type SyncScope = z.infer<typeof syncScopeSchema>;
export const observationsSchema = z.array(z.object({ marker, exists: z.boolean(), checked: z.boolean(), count: z.number().int().min(0).max(10000) }).strict()).max(MAX_SYNC_ITEMS);
export type SyncObservation = z.infer<typeof observationsSchema>[number];

export const connectionKey = (userId: string, list: string) => userId + ':' + list.trim().normalize('NFKC').toLowerCase();
export const legacyMarker = (household: string, item: ShoppingItem) => `cookbook-item:${encodeURIComponent(household)}:${encodeURIComponent(item.key)}:end`;
export const itemMarker = (household: string, state: State, item: ShoppingItem) => `cookbook-v2:${household}:${encodeURIComponent(item.id)}:${item.manual ? 'manual' : state.shoppingWeek || 'unplanned'}:end`;
// Checkmarks may change while Shortcuts is open. Quantity/content/cycle changes need a fresh sync.
export const itemGuard = (state: State, item: ShoppingItem) => JSON.stringify([item.id, item.key, item.name, item.amount, item.unit, item.note, item.uncertain, item.addedToPantry, item.manual, item.manual ? '' : state.shoppingWeek]);

export function createSyncScope(state: State, household: string, userId: string, list: string, now = Date.now()): SyncScope {
    list = list.trim();
    if (!list || list.length > 100) throw new DomainError('Enter your Reminders list name (up to 100 characters).');
    const connection = connectionKey(userId, list), prior = state.reminders?.find(c => c.key === connection);
    const linked = new Set([...(prior?.entries ?? []), ...(!prior?.receipt.acknowledged ? prior?.receipt.items.filter(i => i.create) ?? [] : [])].map(i => i.marker));
    const items = state.shopping.filter(i => (!i.checked && !i.addedToPantry) || linked.has(itemMarker(household, state, i)) || (!prior && !i.addedToPantry)).map(item => {
        const marker = itemMarker(household, state, item), quantity = item.amount === null ? 'Check amount' : formatAmount(item.amount, item.unit);
        return {
            id: item.id, marker, legacyMarker: legacyMarker(household, item), title: `${item.name} — ${quantity}`,
            notes: [item.note, item.uncertain ? 'Check pantry before buying.' : '', 'From CookBook', marker].filter(Boolean).join('\n'),
            guard: itemGuard(state, item), checked: item.checked || item.addedToPantry,
            baseline: prior?.entries.find(i => i.marker === marker)?.checked ?? null,
            pending: !!prior && !prior.receipt.acknowledged && prior.receipt.items.some(i => i.marker === marker),
        };
    });
    if (!items.length) throw new DomainError('There are no linked or unchecked groceries to sync.');
    if (items.length > MAX_SYNC_ITEMS) throw new DomainError(`Sync supports up to ${MAX_SYNC_ITEMS} groceries. Remove old shopping rows before trying again.`);
    return syncScopeSchema.parse({ version: 2, id: crypto.randomUUID(), household, userId, list, connection, previousSync: prior?.receipt.id ?? null, issuedAt: now, expiresAt: now + 15 * 60000, items });
}

export function validateObservations(scope: SyncScope, input: unknown): SyncObservation[] {
    const parsed = observationsSchema.safeParse(input);
    if (!parsed.success) throw new DomainError('The Shortcut returned invalid grocery checkmarks. Update the Shortcut and try again.');
    const rows = parsed.data;
    if (rows.length !== scope.items.length || new Set(rows.map(r => r.marker)).size !== rows.length || rows.some(r => !scope.items.some(i => i.marker === r.marker) || r.exists !== (r.count > 0) || (!r.exists && r.checked))) throw new DomainError('The Shortcut returned an incomplete grocery list. Try syncing again.');
    if (rows.some(r => r.count > 1)) throw new DomainError('More than one reminder has the same CookBook marker. Remove the duplicate marker, then sync again.', 409);
    return rows;
}

export function applyRemindersSync(state: State, scope: SyncScope, observations: SyncObservation[], observationsHash: string) {
    const connections = state.reminders ?? [], prior = connections.find(c => c.key === scope.connection);
    if ((prior?.receipt.id ?? null) !== scope.previousSync) throw new DomainError('Another grocery sync finished. Start a fresh sync to use the latest checkmarks.', 409);
    let skipped = 0;
    const items: SyncResult[] = [];
    for (const sent of scope.items) {
        const current = state.shopping.find(i => i.id === sent.id), remote = observations.find(r => r.marker === sent.marker)!;
        if (!current || itemGuard(state, current) !== sent.guard || itemMarker(scope.household, state, current) !== sent.marker) { skipped++; continue; }
        const checkedHere = current.checked || current.addedToPantry;
        const localChanged = sent.pending || checkedHere !== sent.checked || (sent.baseline === null ? checkedHere : checkedHere !== sent.baseline);
        const checked = current.addedToPantry || !remote.exists || localChanged ? checkedHere : remote.checked;
        current.checked = checked;
        items.push({ id: sent.id, marker: sent.marker, legacyMarker: sent.legacyMarker, title: sent.title, notes: sent.notes, checked, create: remote.exists || !checked });
    }
    const connection: RemindersConnection = { key: scope.connection, userId: scope.userId, list: scope.list, entries: prior?.entries ?? [], receipt: { id: scope.id, issuedAt: scope.issuedAt, observationsHash, acknowledged: false, skipped, items } };
    // Baselines advance only after Shortcuts confirms its writes, so an interrupted push is retried.
    state.reminders = [...connections.filter(c => c.key !== scope.connection).slice(-19), connection];
}

export function acknowledgeRemindersSync(state: State, scope: SyncScope) {
    const connection = state.reminders?.find(c => c.key === scope.connection);
    if (!connection || connection.receipt.id !== scope.id) throw new DomainError('This grocery sync was replaced. Start a fresh sync.', 409);
    const updated = connection.receipt.items.filter(i => i.create).map(({ id, marker, checked }) => ({ id, marker, checked }));
    const retained = connection.entries.filter(entry => !connection.receipt.items.some(i => i.marker === entry.marker) && state.shopping.some(item => item.id === entry.id && itemMarker(scope.household, state, item) === entry.marker));
    connection.entries = [...retained, ...updated].slice(-MAX_SYNC_ITEMS);
    connection.receipt.acknowledged = true;
}
