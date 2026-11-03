import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from './domain.ts';
import { createSyncScope, validateObservations, type RemindersConnection, type SyncScope } from './reminders-domain.ts';
import { observationDigest, signScope, verifyScope } from './reminders-auth.ts';
import { householdStore } from './store.ts';
import { protectedResource } from './oauth.ts';

export async function beginRemindersSync(request: Request, admin: SupabaseClient, household: string, userId: string, input: any, allowedOrigins: string[], secret?: string) {
    if (!secret) throw new DomainError('Reminders sync is not configured on the server.', 503);
    if (typeof input?.list !== 'string' || typeof input?.returnUrl !== 'string') throw new DomainError('Enter your grocery list name and open sync from CookBook.');
    let returnUrl: URL;
    try { returnUrl = new URL(input.returnUrl); } catch { throw new DomainError('Open grocery sync from the CookBook website.'); }
    if (!allowedOrigins.includes(returnUrl.origin) || returnUrl.username || returnUrl.password) throw new DomainError('Return to the CookBook website to start this sync.', 403);
    const current = await householdStore(admin, household).snapshot();
    const scope = createSyncScope(current.state, household, userId, input.list);
    returnUrl.search = ''; returnUrl.hash = '/shopping?reminders-sync=' + scope.id;
    const base = protectedResource(request).resource;
    return { version: 2 as const, scope, signature: await signScope(scope, secret), finishUrl: base + '/reminders/finish', ackUrl: base + '/reminders/ack', returnUrl: returnUrl.href };
}

const receiptFor = (connections: RemindersConnection[] | undefined, scope: SyncScope) => connections?.find(c => c.key === scope.connection)?.receipt;
const receiptResult = (receipt: RemindersConnection['receipt']) => ({ ok: true, syncId: receipt.id, acknowledged: receipt.acknowledged, count: receipt.items.length, skipped: receipt.skipped, items: receipt.items.filter(i => i.create) });

export async function finishRemindersSync(admin: SupabaseClient, input: any, secret: string | undefined, acknowledge: boolean) {
    const payload = input?.payload ?? input;
    const scope = await verifyScope(payload?.scope, payload?.signature, secret);
    // The signed scope belongs to the one cookbook and an existing confirmed
    // account. Deleted/unconfirmed accounts cannot use an old native handoff.
    const { data: allowed, error } = await admin.rpc('cookbook_sync_allowed', { cookbook_id: scope.household, account_id: scope.userId });
    if (error || !allowed) throw new DomainError('You no longer have access to this cookbook.', 403);
    const transport = Array.isArray(input?.observations) ? input.observations.map((row: any) => {
        if (row && 'completed' in row) {
            if (!Number.isInteger(row.completed) || row.completed < 0 || row.completed > row.count) throw new DomainError('The Shortcut returned invalid grocery checkmarks.');
            return { marker: row.marker, count: row.count, exists: row.count > 0, checked: row.completed > 0 };
        }
        return row;
    }) : input?.observations;
    const observations = acknowledge ? [] : validateObservations(scope, transport);
    const hash = acknowledge ? '' : await observationDigest([...observations].sort((a, b) => a.marker.localeCompare(b.marker)));
    const store = householdStore(admin, scope.household);
    for (let attempt = 0; attempt < 3; attempt++) {
        const current = await store.snapshot(), receipt = receiptFor(current.state.reminders, scope);
        if (acknowledge) {
            if (!receipt || receipt.id !== scope.id) throw new DomainError('This sync was replaced. Start a fresh grocery sync.', 409);
            if (receipt.acknowledged) return receiptResult(receipt);
        } else if (receipt?.id === scope.id) {
            if (receipt.observationsHash !== hash) throw new DomainError('This sync already received different checkmarks. Start a fresh sync.', 409);
            return receiptResult(receipt);
        } else if (current.state.operations.includes(scope.id)) throw new DomainError('This grocery sync was replaced. Start again.', 409);
        try {
            const saved = await store.command(acknowledge ? 'reminders.ack' : 'reminders.sync', { scope, observations, observationsHash: hash }, scope.id + (acknowledge ? '-ack' : ''), current.revision, current);
            const result = receiptFor(saved.state.reminders, scope);
            if (!result || result.id !== scope.id) throw new DomainError('This grocery sync was replaced. Start again.', 409);
            if (!acknowledge && result.observationsHash !== hash) throw new DomainError('This sync already received different checkmarks. Start a fresh sync.', 409);
            return receiptResult(result);
        } catch (e) { if (!(e instanceof DomainError) || e.status !== 409 || attempt === 2) throw e; }
    }
    throw new DomainError('Your groceries changed. Start a fresh sync.', 409);
}

export async function remindersSyncStatus(admin: SupabaseClient, household: string, userId: string, syncId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(syncId)) throw new DomainError('Choose a grocery sync to check.');
    const current = await householdStore(admin, household).snapshot();
    const receipt = current.state.reminders?.find(c => c.userId === userId && c.receipt.id === syncId)?.receipt;
    return receipt ? { syncId, phase: receipt.acknowledged ? 'complete' : 'finishing', count: receipt.items.length, skipped: receipt.skipped } : { syncId, phase: 'waiting', count: 0, skipped: 0 };
}
