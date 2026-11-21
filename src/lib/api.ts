import { nativeApp, requireClient, supabaseUrl, publishableKey } from './supabase';
import type { Delta, Snapshot } from '../../supabase/functions/_shared/state-patch.ts';
import { SnapshotStore } from './snapshot-store';
import { SnapshotCache } from './snapshot-cache';
import { PhotoResolver, type PhotoVariant } from './photo-resolver';
import { openIdbStorage, requestPersistence } from './idb-storage';
import { cachedPhoto, clearPhotoCache, forgetUpload, queuedUpload, queueUpload, storeLocalPhoto } from './photo-cache';
import { SyncEngine } from './sync-engine';
export type { Snapshot } from '../../supabase/functions/_shared/state-patch.ts';
export class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
let householdId = '', userId = '', snapshots: SnapshotStore | undefined;
const photoResolver = new PhotoResolver(async (references, variant) => (await request<{ urls: Record<string, { url: string; fallback?: string }> }>('photos/urls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ references, variant }), signal: AbortSignal.timeout(15000),
})).urls);
export const selectHousehold = (id: string) => { if (id !== householdId) { householdId = id; photoResolver.clear(); } };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let storageReady: Promise<StorageLike | undefined> | undefined;
// IndexedDB keeps large cookbooks offline; localStorage is the fallback.
const savedStorage = () => storageReady ??= openIdbStorage().catch(() => { try { return window.localStorage; } catch { return undefined; } });
let changesAvailable = true;
// Fetch only what changed since the saved revision. Falls back to full reads
// until the database has the change feed (deploy order: migration first).
async function readCookbook(revision: number | null, account: string) {
    if (revision === null || !changesAvailable) return databaseCall<any>('read_cookbook', { known_revision: revision }, account);
    try { return await databaseCall<any>('read_cookbook_changes', { since: revision }, account); }
    catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) { changesAvailable = false; return databaseCall<any>('read_cookbook', { known_revision: revision }, account); }
        throw error;
    }
}
let currentStorage: StorageLike | undefined;
const outboxKey = (account: string) => 'cookbook-outbox-v1:' + new URL(supabaseUrl!).host + ':' + account;
export async function selectSession(id: string) {
    if (id === userId) return;
    // Signing out discards this account's unsynced changes on this device (the app warns first).
    if (userId && !id) { try { currentStorage?.removeItem(outboxKey(userId)); } catch { /* Optional. */ } }
    snapshots?.close(); snapshots = undefined; userId = id; selectHousehold(''); photoResolver.clear();
    if (!id) { void clearPhotoCache(); return; }
    const storage = currentStorage = await savedStorage();
    if (userId !== id) return;
    // Move a cookbook saved by an older version into the larger store once.
    const key = new URL(supabaseUrl!).host + ':' + id;
    try { const legacy = window.localStorage.getItem('cookbook-snapshot-v2:' + key); if (legacy && storage !== window.localStorage && !storage?.getItem('cookbook-snapshot-v2:' + key)) { storage?.setItem('cookbook-snapshot-v2:' + key, legacy); window.localStorage.removeItem('cookbook-snapshot-v2:' + key); } } catch { /* Optional. */ }
    const cache = new SnapshotCache(key, storage);
    snapshots = new SnapshotStore(revision => readCookbook(revision, id), cache);
    const cached = snapshots.peek(); if (cached) selectHousehold(cached.householdId);
    requestPersistence();
}
export const cachedSnapshot = () => snapshots?.peek() ?? null;
// The offline outbox for the signed-in account. Confirmed saves also refresh
// the saved snapshot, so the cookbook reopens with them offline.
export function createSyncEngine(initial: Snapshot, household = householdId) {
    const account = userId;
    return new SyncEngine(initial, {
        save: async (type, payload, id, revision) => { await uploadPendingPhotos(); return saveCommand(type, payload, id, revision, household); },
        read: () => getSnapshot(household),
        storage: currentStorage, key: outboxKey(account),
        online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    });
}
export function unsyncedChanges() {
    if (!userId) return 0;
    try { return JSON.parse(currentStorage?.getItem(outboxKey(userId)) ?? 'null')?.queue?.length ?? 0; } catch { return 0; }
}
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
const uploadsKey = (account: string) => 'cookbook-photo-uploads-v1:' + new URL(supabaseUrl!).host + ':' + account;
const pendingUploads = (): string[] => { try { return JSON.parse(currentStorage?.getItem(uploadsKey(userId)) ?? '[]'); } catch { return []; } };
const setPendingUploads = (ids: string[]) => { try { if (ids.length) currentStorage?.setItem(uploadsKey(userId), JSON.stringify(ids)); else currentStorage?.removeItem(uploadsKey(userId)); } catch { /* Optional. */ } };
const sendPhoto = (id: string, photo: Blob, thumbnail?: Blob) => {
    let body: BodyInit, headers: HeadersInit | undefined;
    if (thumbnail) { const form = new FormData(); form.set('photo', photo, 'recipe.webp'); form.set('thumbnail', thumbnail, 'recipe.thumb.webp'); body = form; }
    else { body = photo; headers = { 'Content-Type': photo.type }; }
    return request<{ url: string }>('photos?id=' + id, { method: 'POST', headers, body });
};
// Photos added offline upload before the changes that use them.
export async function uploadPendingPhotos() {
    for (const id of pendingUploads()) {
        const queued = await queuedUpload(id);
        if (queued) await sendPhoto(id, queued.photo, queued.thumbnail);
        await forgetUpload(id);
        setPendingUploads(pendingUploads().filter(x => x !== id));
    }
}
// The photo's address is chosen here, so a recipe can use it right away, even
// offline; the bytes upload now or with the next sync.
export async function uploadPhoto(file: File) {
    const { preparePhoto } = await import('./prepare-photo');
    const body = await preparePhoto(file);
    const photo = body instanceof File ? body : body.get('photo') as Blob, thumbnail = body instanceof File ? undefined : body.get('thumbnail') as Blob;
    const id = crypto.randomUUID(), extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/jpeg' ? 'jpg' : 'webp';
    const reference = 'photo:' + householdId + '/' + id + '.' + extension;
    await Promise.all([storeLocalPhoto(reference, 'full', photo), storeLocalPhoto(reference, 'thumbnail', thumbnail ?? photo)]);
    if (navigator.onLine) {
        try { return await sendPhoto(id, photo, thumbnail); }
        catch (error) { if (error instanceof ApiError) throw error; /* Network failure: keep it for later. */ }
    }
    await queueUpload(id, photo, thumbnail);
    setPendingUploads([...pendingUploads(), id]);
    return { url: reference };
}
// Private photos are kept on the device so recipes show their pictures offline.
export const photoSource = (reference: string, variant: PhotoVariant = 'thumbnail') => cachedPhoto(reference, variant, () => photoResolver.resolve(reference, variant));
export async function downloadBackup() {
    const data = await request<unknown>('export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    // Apps can't follow download links; the share sheet saves the file instead.
    const file = new File([blob], 'cookbook-household.json', { type: 'application/json' });
    if (nativeApp() && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'CookBook backup' }); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'cookbook-household.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
