import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError, type State } from './domain.ts';
import { applyCommand } from './commands.ts';
import { statePatch, type Snapshot } from './state-patch.ts';
export type { Snapshot } from './state-patch.ts';

export function householdStore(admin: SupabaseClient, householdId: string, timing?: (name: string, duration: number) => void) {
    const snapshot = async (): Promise<Snapshot> => {
        const start = performance.now();
        const { data, error } = await admin.rpc('read_cookbook');
        timing?.('db_read', performance.now() - start);
        if (error || !data || data.householdId !== householdId) throw new DomainError('Your cookbook could not be loaded.', 503);
        return data as Snapshot;
    };
    const replace = async (state: State, revision: number, original?: State): Promise<Snapshot | null> => {
        if (new TextEncoder().encode(JSON.stringify(state)).length > 1700000) throw new DomainError('Your cookbook is full. Export your data before adding more.', 413);
        const before = original ?? (await snapshot()).state;
        const patch = statePatch(before, state);
        const start = performance.now();
        const { data, error } = await admin.rpc('write_cookbook_patch', { cookbook_id: householdId, expected_revision: revision, patch });
        timing?.('db_write', performance.now() - start);
        if (error) throw new DomainError('Your changes could not be confirmed. Please try again.', 503);
        return data ? { householdId, state, revision: data.revision } : null;
    };
    const execute = async (type: string, payload: unknown, operationId: string, revision: number, basis?: Snapshot) => {
        if (typeof operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) throw new DomainError('A valid action identifier is required.');
        if (!Number.isInteger(revision) || revision < 0) throw new DomainError('Load your cookbook before saving.');
        const current = basis ?? await snapshot();
        if (current.householdId !== householdId) throw new DomainError('This cookbook is not available.', 403);
        if (current.state.operations.includes(operationId)) return { before: current, saved: current, duplicate: true };
        if (current.revision !== revision) throw new DomainError('Someone else updated your cookbook. Refresh, review your changes, and save again.', 409);
        const saved = await replace(applyCommand(current.state, type, payload, operationId), revision, current.state);
        if (saved) return { before: current, saved, duplicate: false };
        const latest = await snapshot();
        if (latest.state.operations.includes(operationId)) return { before: latest, saved: latest, duplicate: true };
        throw new DomainError('Someone else updated your cookbook. Refresh and review before saving.', 409);
    };
    const command = async (type: string, payload: unknown, operationId: string, revision: number, basis?: Snapshot) => (await execute(type, payload, operationId, revision, basis)).saved;
    const commandDelta = async (type: string, payload: unknown, operationId: string, revision: number) => {
        const { before, saved, duplicate } = await execute(type, payload, operationId, revision);
        // A duplicate may refer to an older client revision. Send an authoritative
        // snapshot in that uncommon case instead of applying a patch to the wrong base.
        return duplicate ? saved : { householdId, baseRevision: before.revision, revision: saved.revision, patch: statePatch(before.state, saved.state) };
    };
    return { snapshot, command, commandDelta, replace };
}
