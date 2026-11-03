import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from './domain.ts';
import { body, failure, json } from './http.ts';
import { householdStore } from './store.ts';
import { readBackup } from './backup.ts';
import { handleMcp } from './mcp.ts';
import { challenge, protectedResource } from './oauth.ts';
import { photoKey, signedPhotos, uploadPhotos } from './photos.ts';
export { photoExtension } from './photos.ts';
import { beginRemindersSync, finishRemindersSync, remindersSyncStatus } from './reminders-api.ts';

export function createHandler(admin: SupabaseClient, allowedOrigins: string[], remindersSecret?: string) {
    // The personal cookbook's identity is immutable after migration. Cache only
    // that public identifier; user authentication is still verified per request.
    let identity: Promise<string> | undefined;
    const cookbookId = () => identity ??= (async () => {
        const { data, error } = await admin.from('cookbook_meta').select('household_id').single();
        if (error || !data) { identity = undefined; throw new DomainError('The shared cookbook is not ready. Please finish the database update.', 503); }
        return data.household_id as string;
    })();
    return async (request: Request): Promise<Response> => {
        const start = performance.now(), timings = new Map<string, number>();
        const timing = (name: string, duration: number) => timings.set(name, (timings.get(name) ?? 0) + duration);
        const origin = request.headers.get('origin');
        const cors = new Headers({ Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-household-id, x-client-info, x-region' });
        if (origin && !allowedOrigins.includes(origin)) return json({ error: 'This website is not allowed to access your kitchen.' }, 403);
        if (origin) cors.set('Access-Control-Allow-Origin', origin);
        const respond = (response: Response) => {
            for (const [key, value] of cors) response.headers.set(key, value);
            timing('total', performance.now() - start);
            response.headers.set('Server-Timing', [...timings].map(([name, duration]) => name + ';dur=' + duration.toFixed(1)).join(', '));
            response.headers.set('Access-Control-Expose-Headers', 'Server-Timing, x-sb-edge-region');
            if (response.status === 401) response.headers.set('WWW-Authenticate', challenge(request));
            return response;
        };
        if (request.method === 'OPTIONS') { cors.set('Access-Control-Max-Age', '3600'); return respond(new Response(null, { status: 204 })); }
        try {
            const url = new URL(request.url);
            const path = url.pathname.match(/^\/(?:functions\/v1\/)?cookbook(?:\/(.*))?$/)?.[1] ?? '';
            if (path === '.well-known/oauth-protected-resource' && request.method === 'GET') return respond(json(protectedResource(request)));
            if ((path === 'reminders/finish' || path === 'reminders/ack') && request.method === 'POST') {
                // Native Shortcuts gets only a signed, expiring grocery scope, never a user JWT.
                return respond(json(await finishRemindersSync(admin, await body(request), remindersSecret, path === 'reminders/ack')));
            }
            const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
            if (!token) throw new DomainError('Sign in to open your kitchen.', 401);
            const authStart = performance.now();
            const { data: { user }, error: authError } = await admin.auth.getUser(token);
            timing('auth', performance.now() - authStart);
            if (authError || !user || !user.email_confirmed_at) throw new DomainError('Confirm your email and sign in to open your kitchen.', 401);
            const householdId = await cookbookId();
            const requestedHousehold = request.headers.get('x-household-id');
            if (requestedHousehold && requestedHousehold !== householdId) throw new DomainError('This connection refers to an old cookbook. Reconnect to open the shared cookbook.', 403);
            const store = householdStore(admin, householdId, timing);
            if (path === 'reminders/begin' && request.method === 'POST') return respond(json(await beginRemindersSync(request, admin, householdId, user.id, await body(request, 5000), allowedOrigins, remindersSecret)));
            if (path === 'reminders/status' && request.method === 'GET') return respond(json(await remindersSyncStatus(admin, householdId, user.id, url.searchParams.get('id') ?? '')));
            if (path === 'state' && request.method === 'GET') return respond(json(await store.snapshot()));
            if (path === 'command' && request.method === 'POST') {
                const input = await body(request);
                if (String(input.type).startsWith('reminders.')) throw new DomainError('Use the grocery sync connection for Reminders updates.', 403);
                return respond(json(await (input.response === 'delta' ? store.commandDelta : store.command)(input.type, input.payload, input.id, input.revision)));
            }
            if (path === 'import' && request.method === 'POST') {
                const input = await body(request, 10000), current = await store.snapshot();
                if (current.state.operations.includes(input.id)) return respond(json({ ...current, draftId: input.id }));
                if (input.revision !== current.revision) throw new DomainError('Your kitchen changed. Refresh and review before importing.', 409);
                const { importLink } = await import('./importer.ts');
                const draft = await importLink(input.url);
                const saved = await store.command('draft.save', { id: input.id, recipe: draft.recipe, text: draft.text, warnings: draft.warnings }, input.id, input.revision);
                return respond(json({ ...saved, draftId: input.id }));
            }
            if (path === 'export' && request.method === 'GET') return respond(json({ format: 'cookbook-household-v1', exportedAt: new Date().toISOString(), ...await store.snapshot() }));
            if (path === 'restore' && request.method === 'POST') {
                const state = readBackup(await body(request)), current = await store.snapshot();
                if (Object.entries(current.state).some(([key,value]) => key !== 'operations' && Array.isArray(value) && value.length)) throw new DomainError('Restore into an empty kitchen so existing records are preserved.', 409);
                const saved = await store.replace(state, current.revision, current.state);
                if (!saved) throw new DomainError('Your kitchen changed. Refresh before restoring.', 409);
                return respond(json(saved));
            }
            if (path === 'photos/urls' && request.method === 'POST') return respond(json(await signedPhotos(admin, householdId, await body(request, 12000))));
            if (path === 'photos' && request.method === 'POST') return respond(json(await uploadPhotos(request, admin, householdId)));
            if (path === 'photos' && request.method === 'GET') {
                const key = photoKey(url.searchParams.get('reference'), householdId);
                const { data, error } = await admin.storage.from('cookbook-photos').createSignedUrl(key, 300);
                if (error || !data) throw new DomainError('Your photo could not be loaded.', 404);
                return respond(json({ url: data.signedUrl }));
            }
            if (path === 'mcp' && request.method === 'POST') return respond(await handleMcp(request, store));
            throw new DomainError('This action is not available.', 404);
        } catch (e) { return respond(failure(e)); }
    };
}
