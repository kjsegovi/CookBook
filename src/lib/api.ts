import { requireClient, supabaseUrl, publishableKey } from './supabase';
import type { State } from './domain';

export type Snapshot = { state: State; revision: number };
export class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
let householdId = '';
export const selectHousehold = (id: string) => { householdId = id; photoCache.clear(); };
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const client = requireClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new ApiError('Please sign in to open your kitchen.', 401);
    if (!householdId) throw new ApiError('Choose a household first.', 403);
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Bearer ' + data.session.access_token);
    headers.set('apikey', publishableKey!);
    headers.set('x-household-id', householdId);
    const response = await fetch(supabaseUrl + '/functions/v1/cookbook/' + path, { ...options, headers, cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) await client.auth.signOut({ scope: 'local' });
    if (!response.ok) throw new ApiError(result.error ?? 'Your changes could not be confirmed. Please try again.', response.status);
    return result;
}
export const getSnapshot = () => request<Snapshot>('state');
export const saveCommand = (type: string, payload: unknown, id: string, revision: number) => request<Snapshot>('command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload, id, revision }),
});
export const importRecipe = (url: string, id: string, revision: number) => request<Snapshot & { draftId: string }>('import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, id, revision }),
});
export const uploadPhoto = (file: File) => request<{ url: string }>('photos', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
const photoCache = new Map<string, { url: string; expires: number }>();
export async function photoUrl(reference: string) {
    if (!reference.startsWith('photo:')) return reference;
    const cached = photoCache.get(reference);
    if (cached && cached.expires > Date.now()) return cached.url;
    const result = await request<{ url: string }>('photos?reference=' + encodeURIComponent(reference));
    photoCache.set(reference, { url: result.url, expires: Date.now() + 240000 });
    return result.url;
}
export async function downloadBackup() {
    const data = await request<unknown>('export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cookbook-household.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
