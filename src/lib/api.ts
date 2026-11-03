import { requireClient, supabaseUrl, publishableKey } from './supabase';
import type { Delta, Snapshot } from '../../supabase/functions/_shared/state-patch.ts';
import { SnapshotStore } from './snapshot-store';
import { SnapshotCache } from './snapshot-cache';
import { PhotoResolver, type PhotoVariant } from './photo-resolver';
export type { Snapshot } from '../../supabase/functions/_shared/state-patch.ts';
export class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
let householdId = '', userId = '', snapshots: SnapshotStore | undefined;
const photoResolver = new PhotoResolver(async (references, variant) => (await request<{ urls: Record<string, { url: string; fallback?: string }> }>('photos/urls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ references, variant }), signal: AbortSignal.timeout(15000),
})).urls);
export const selectHousehold = (id: string) => { if (id !== householdId) { householdId = id; photoResolver.clear(); } };
export function selectSession(id: string) {
    if (id === userId) return;
    snapshots?.close(); snapshots = undefined; userId = id; selectHousehold(''); photoResolver.clear();
    if (!id) return;
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Saved-data caching is optional. */ }
    const cache = new SnapshotCache(new URL(supabaseUrl!).host + ':' + id, storage);
    snapshots = new SnapshotStore(revision => databaseCall('read_cookbook', { known_revision: revision }, id), cache);
    const cached = snapshots.peek(); if (cached) selectHousehold(cached.householdId);
}
export const cachedSnapshot = () => snapshots?.peek() ?? null;
async function databaseCall<T>(name: string, input: Record<string, unknown>, account = userId): Promise<T> {
    if (!account || account !== userId) throw new ApiError('Sign in to open your cookbook.', 401);
    const { data, error, status } = await requireClient().rpc(name, input).abortSignal(AbortSignal.timeout(20000));
    if (account !== userId) throw new ApiError('The cookbook session changed. Please try again.', 401);
    if (error || data === null) {
        const code = error?.code;
        if (status === 401 || code === '42501') await requireClient().auth.signOut({ scope: 'local' });
        throw new ApiError(error?.message ?? 'Your cookbook could not be loaded. Please try again.', code === '40001' ? 409 : code === 'P0002' ? 404 : code === '42501' ? 403 : status || 503);
    }
    return data as T;
}
export async function request<T>(path: string, options: RequestInit = {}, household = householdId): Promise<T> {
    const client = requireClient(), account = userId;
    const { data, error } = await client.auth.getSession();
    if (error || !data.session || data.session.user.id !== account || account !== userId) throw new ApiError('Please sign in to open your cookbook.', 401);
    if (!household || household !== householdId) throw new ApiError('Reload to open the shared cookbook.', 403);
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Bearer ' + data.session.access_token);
    headers.set('apikey', publishableKey!);
    headers.set('x-household-id', household);
    const region = import.meta.env.VITE_SUPABASE_FUNCTION_REGION?.trim();
    if (region) headers.set('x-region', region);
    const response = await fetch(supabaseUrl + '/functions/v1/cookbook/' + path, { ...options, headers, cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (account !== userId) throw new ApiError('The cookbook session changed. Please try again.', 401);
    if (response.status === 401) await client.auth.signOut({ scope: 'local' });
    if (!response.ok) throw new ApiError(result?.error ?? 'Your changes could not be confirmed. Please try again.', response.status);
    if (result === null) throw new ApiError('The cookbook response could not be read. Please try again.', 502);
    return result;
}
export async function getSnapshot(household?: string): Promise<Snapshot> {
    const store = snapshots;
    if (!store) throw new ApiError('Please sign in to open your cookbook.', 401);
    if (household && household !== householdId) throw new ApiError('Reload to open the shared cookbook.', 403);
    const data = await store.read();
    if (store !== snapshots) throw new ApiError('The cookbook session changed. Please try again.', 401);
    selectHousehold(data.householdId);
    return data;
}
export async function saveCommand(type: string, payload: any, id: string, revision: number, household = householdId): Promise<Snapshot> {
    const store = snapshots;
    if (!store || household !== householdId) throw new ApiError('Reload to open the shared cookbook.', 403);
    let result: Snapshot | Delta;
    if (type === 'shopping.toggle' || type === 'recipe.favorite') result = await databaseCall('set_cookbook_flag', {
        command_type: type, record_id: payload.id, checked: type === 'shopping.toggle' ? payload.checked : payload.favorite,
        operation_id: id, expected_revision: revision, expected_updated_at: payload.expectedUpdatedAt ?? null,
    });
    else result = await request<Snapshot | Delta>('command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload, id, revision, response: 'delta' }), signal: AbortSignal.timeout(20000),
    }, household);
    return store.saved(result);
}
export async function importRecipe(url: string, id: string, revision: number, household = householdId) {
    const store = snapshots;
    const result = await request<Snapshot & { draftId: string }>('import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, id, revision }),
    }, household);
    if (!store || store !== snapshots) throw new ApiError('The cookbook session changed. Please try again.', 401);
    return { ...store.accept(result), draftId: result.draftId };
}
export async function uploadPhoto(file: File) {
    const { preparePhoto } = await import('./prepare-photo');
    const body = await preparePhoto(file);
    return request<{ url: string }>('photos', { method: 'POST', ...(body instanceof File ? { headers: { 'Content-Type': body.type } } : {}), body });
}
export const photoSource = (reference: string, variant: PhotoVariant = 'thumbnail') => photoResolver.resolve(reference, variant);
export async function downloadBackup() {
    const data = await request<unknown>('export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cookbook-household.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
