import type { SupabaseClient } from '@supabase/supabase-js';
import { applyCommand, DomainError, type State } from './domain.ts';
export type Snapshot = { state: State; revision: number };
export function householdStore(admin: SupabaseClient, householdId: string) {
    const snapshot = async (): Promise<Snapshot> => {
        const { data, error } = await admin.from('households').select('state,revision').eq('id', householdId).single();
        if (error || !data) throw new DomainError('Your household could not be loaded.', 503);
        return { state: data.state, revision: data.revision };
    };
    const replace = async (state: State, revision: number): Promise<Snapshot | null> => {
        if (new TextEncoder().encode(JSON.stringify(state)).length > 1700000) throw new DomainError('Your kitchen is full. Export your data before adding more.', 413);
        const { data, error } = await admin.from('households').update({ state, revision: revision + 1, updated_at: new Date().toISOString() }).eq('id', householdId).eq('revision', revision).select('revision').maybeSingle();
        if (error) throw new DomainError('Your changes could not be confirmed. Please try again.', 503);
        return data ? { state, revision: data.revision } : null;
    };
    const command = async (type: string, payload: unknown, operationId: string, revision: number) => {
        if (typeof operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) throw new DomainError('A valid action identifier is required.');
        if (!Number.isInteger(revision) || revision < 0) throw new DomainError('Load your kitchen before saving.');
        const current = await snapshot();
        if (current.state.operations.includes(operationId)) return current;
        if (current.revision !== revision) throw new DomainError('Someone else updated your kitchen. Refresh, review your changes, and save again.', 409);
        const saved = await replace(applyCommand(current.state, type, payload, operationId), revision);
        if (saved) return saved;
        const latest = await snapshot();
        if (latest.state.operations.includes(operationId)) return latest;
        throw new DomainError('Someone else updated your kitchen. Refresh and review before saving.', 409);
    };
    return { snapshot, command, replace };
}
