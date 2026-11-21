import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError, type State } from './domain.ts';
import { applyCommand } from './commands.ts';
import { collections, statePatch, type Snapshot } from './state-patch.ts';
export type { Snapshot } from './state-patch.ts';

// Each record is stored on its own, so the cap is per record rather than for
// the whole cookbook. Collection counts are limited by the domain commands.
export const RECORD_LIMIT = 200000, METADATA_LIMIT = 1700000;
const ATTEMPTS = 5;
const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
export function checkSizes(state: State) {
    for (const key of collections) for (const row of state[key]) {
        if (size(row) > RECORD_LIMIT) throw new DomainError(key === 'recipes' || key === 'drafts' ? 'This recipe is too large to save. Shorten its notes or steps.' : 'This item is too large to save.', 413);
    }
    if (size({ settings: state.settings, shoppingWeek: state.shoppingWeek, reminders: state.reminders }) > METADATA_LIMIT) throw new DomainError('Your cookbook settings are too large to save.', 413);
}
export const validOperationId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);

type WriteResult = { saved: Snapshot } | { duplicate: true } | { conflict: true };

export function householdStore(admin: SupabaseClient, householdId: string, timing?: (name: string, duration: number) => void) {
    const snapshot = async (): Promise<Snapshot> => {
        const start = performance.now();
        const { data, error } = await admin.rpc('read_cookbook');
        timing?.('db_read', performance.now() - start);
        if (error || !data || data.householdId !== householdId) throw new DomainError('Your cookbook could not be loaded.', 503);
        return data as Snapshot;
    };
    const write = async (state: State, revision: number, original: State): Promise<WriteResult> => {
        checkSizes(state);
        const patch = statePatch(original, state);
        const start = performance.now();
        const { data, error } = await admin.rpc('write_cookbook_patch', { cookbook_id: householdId, expected_revision: revision, patch });
        timing?.('db_write', performance.now() - start);
        if (error) throw new DomainError('Your changes could not be confirmed. Please try again.', 503);
        if (!data) return { conflict: true };
        if (data.duplicate) return { duplicate: true };
        return { saved: { householdId, state, revision: data.revision } };
    };
    // Whole-cookbook replacement (restore) keeps a strict revision check.
    const replace = async (state: State, revision: number, original?: State): Promise<Snapshot | null> => {
        const result = await write(state, revision, original ?? (await snapshot()).state);
        return 'saved' in result ? result.saved : null;
    };
    const applied = async (operationId: string) => {
        const { data, error } = await admin.rpc('cookbook_operation_applied', { operation_id: operationId });
        return !error && data === true;
    };
    // Commands are applied to the current cookbook. Another device's unrelated
    // change no longer causes a conflict; commands detect conflicts on the
    // records they touch. The client revision is accepted but not required.
    const execute = async (type: string, payload: unknown, operationId: string, _revision?: number, basis?: Snapshot) => {
        if (!validOperationId(operationId)) throw new DomainError('A valid action identifier is required.');
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const current = attempt === 0 && basis ? basis : await snapshot();
            if (current.householdId !== householdId) throw new DomainError('This cookbook is not available.', 403);
            if (current.state.operations.includes(operationId)) return { before: current, saved: current, duplicate: true };
            let next: State;
            try { next = applyCommand(current.state, type, payload, operationId); }
            catch (error) {
                // An older retry may no longer apply (for example, a deleted record).
                if (error instanceof DomainError && await applied(operationId)) return { before: current, saved: current, duplicate: true };
                throw error;
            }
            const result = await write(next, current.revision, current.state);
            if ('saved' in result) return { before: current, saved: result.saved, duplicate: false };
            if ('duplicate' in result) { const latest = await snapshot(); return { before: latest, saved: latest, duplicate: true }; }
        }
        throw new DomainError('Your cookbook is busy. Please try again.', 503);
    };
    const command = async (type: string, payload: unknown, operationId: string, revision?: number, basis?: Snapshot) => (await execute(type, payload, operationId, revision, basis)).saved;
    const commandDelta = async (type: string, payload: unknown, operationId: string, revision?: number) => {
        const { before, saved, duplicate } = await execute(type, payload, operationId, revision);
        // A duplicate may refer to an older client revision. Send an authoritative
        // snapshot in that uncommon case instead of applying a patch to the wrong base.
        return duplicate ? saved : { householdId, baseRevision: before.revision, revision: saved.revision, patch: statePatch(before.state, saved.state) };
    };
    return { snapshot, command, commandDelta, replace };
}
