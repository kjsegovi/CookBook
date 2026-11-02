import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from './domain.ts';
import { body, bytes, failure, json } from './http.ts';
import { householdStore } from './store.ts';
import { importLink } from './importer.ts';
import { readBackup } from './backup.ts';
import { handleMcp } from './mcp.ts';
import { challenge, protectedResource } from './oauth.ts';
import { beginRemindersSync, finishRemindersSync, remindersSyncStatus } from './reminders-api.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function photoExtension(data: Uint8Array, type: string) {
    if (type === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpg';
    if (type === 'image/png' && [137,80,78,71,13,10,26,10].every((v,i) => data[i] === v)) return 'png';
    if (type === 'image/webp' && new TextDecoder().decode(data.slice(0,4)) === 'RIFF' && new TextDecoder().decode(data.slice(8,12)) === 'WEBP') return 'webp';
    throw new DomainError('Choose a valid JPEG, PNG, or WebP photo.');
}
export function createHandler(admin: SupabaseClient, allowedOrigins: string[], remindersSecret?: string) {
    return async (request: Request): Promise<Response> => {
        const origin = request.headers.get('origin');
        const cors = new Headers({ Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-household-id, x-client-info' });
        if (origin && !allowedOrigins.includes(origin)) return json({ error: 'This website is not allowed to access your kitchen.' }, 403);
        if (origin) cors.set('Access-Control-Allow-Origin', origin);
        const respond = (response: Response) => { for (const [key, value] of cors) response.headers.set(key, value); if (response.status === 401) response.headers.set('WWW-Authenticate', challenge(request)); return response; };
        if (request.method === 'OPTIONS') return respond(new Response(null, { status: 204 }));
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
            const { data: { user }, error: authError } = await admin.auth.getUser(token);
            if (authError || !user || !user.email_confirmed_at) throw new DomainError('Confirm your email and sign in to open your kitchen.', 401);
            let householdId = request.headers.get('x-household-id') ?? '';
            let member: { role: string } | null = null;
            if (path === 'mcp' && !request.headers.has('x-household-id')) {
                const { data: memberships, error: membershipError } = await admin.from('household_members').select('household_id').eq('user_id', user.id);
                if (membershipError || !memberships?.length) throw new DomainError('You do not have access to any household.', 403);
                if (memberships.length > 1) throw new DomainError('Send x-household-id to choose which household to access.', 403);
                householdId = memberships[0].household_id;
            } else {
                if (!uuid.test(householdId)) throw new DomainError('Choose a household first.', 403);
                const { data, error: memberError } = await admin.from('household_members').select('role').eq('household_id', householdId).eq('user_id', user.id).maybeSingle();
                if (memberError || !data) throw new DomainError('You do not have access to this household.', 403);
                member = data;
            }
            const store = householdStore(admin, householdId);
            if (path === 'reminders/begin' && request.method === 'POST') return respond(json(await beginRemindersSync(request, admin, householdId, user.id, await body(request, 5000), allowedOrigins, remindersSecret)));
            if (path === 'reminders/status' && request.method === 'GET') return respond(json(await remindersSyncStatus(admin, householdId, user.id, url.searchParams.get('id') ?? '')));
            if (path === 'state' && request.method === 'GET') return respond(json(await store.snapshot()));
            if (path === 'command' && request.method === 'POST') {
                const input = await body(request);
                if (String(input.type).startsWith('reminders.')) throw new DomainError('Use the grocery sync connection for Reminders updates.', 403);
                return respond(json(await store.command(input.type, input.payload, input.id, input.revision)));
            }
            if (path === 'import' && request.method === 'POST') {
                const input = await body(request, 10000), current = await store.snapshot();
                if (current.state.operations.includes(input.id)) return respond(json({ ...current, draftId: input.id }));
                if (input.revision !== current.revision) throw new DomainError('Your kitchen changed. Refresh and review before importing.', 409);
                const draft = await importLink(input.url);
                const saved = await store.command('draft.save', { id: input.id, recipe: draft.recipe, text: draft.text, warnings: draft.warnings }, input.id, input.revision);
                return respond(json({ ...saved, draftId: input.id }));
            }
            if (path === 'export' && request.method === 'GET') return respond(json({ format: 'cookbook-household-v1', exportedAt: new Date().toISOString(), ...await store.snapshot() }));
            if (path === 'restore' && request.method === 'POST') {
                if (member?.role !== 'owner') throw new DomainError('Only the household owner can restore a backup.', 403);
                const state = readBackup(await body(request)), current = await store.snapshot();
                if (Object.entries(current.state).some(([key,value]) => key !== 'operations' && Array.isArray(value) && value.length)) throw new DomainError('Restore into an empty kitchen so existing records are preserved.', 409);
                const saved = await store.replace(state, current.revision);
                if (!saved) throw new DomainError('Your kitchen changed. Refresh before restoring.', 409);
                return respond(json(saved));
            }
            if (path === 'photos' && request.method === 'POST') {
                const data = await bytes(request, 5242880), type = request.headers.get('content-type') ?? '';
                const extension = photoExtension(data, type), key = householdId + '/' + crypto.randomUUID() + '.' + extension;
                const { error } = await admin.storage.from('cookbook-photos').upload(key, data, { contentType: type, upsert: false });
                if (error) throw new DomainError('Your photo could not be uploaded. Please try again.', 503);
                return respond(json({ url: 'photo:' + key }));
            }
            if (path === 'photos' && request.method === 'GET') {
                const key = (url.searchParams.get('reference') ?? '').replace(/^photo:/, '');
                const parts = key.split('/');
                if (parts.length !== 2 || parts[0] !== householdId || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[1])) throw new DomainError('Photo not found.', 404);
                const { data, error } = await admin.storage.from('cookbook-photos').createSignedUrl(key, 300);
                if (error || !data) throw new DomainError('Your photo could not be loaded.', 404);
                return respond(json({ url: data.signedUrl }));
            }
            if (path === 'mcp' && request.method === 'POST') return respond(await handleMcp(request, store));
            throw new DomainError('This action is not available.', 404);
        } catch (e) { return respond(failure(e)); }
    };
}
