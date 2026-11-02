import { DomainError } from './domain.ts';
import { syncScopeSchema, type SyncScope } from './reminders-domain.ts';

// Canonical JSON survives the dictionary key ordering changes made by Apple Shortcuts.
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
    return JSON.stringify(value);
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
async function signingKey(secret: string) {
    // Separate this HMAC use from the service credential's other purposes. The credential never leaves the server.
    const derived = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cookbook/reminders/sync-v2\0' + secret));
    return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signScope(scope: SyncScope, secret: string) {
    return encode(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(canonicalJson(scope)))));
}
export async function verifyScope(input: unknown, signature: unknown, secret?: string): Promise<SyncScope> {
    if (!secret) throw new DomainError('Reminders sync is not configured on the server.', 503);
    if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw new DomainError('Start a fresh grocery sync from CookBook.', 401);
    const parsed = syncScopeSchema.safeParse(input);
    if (!parsed.success) throw new DomainError('This grocery sync could not be verified. Start again from CookBook.', 401);
    const scope = parsed.data;
    const bytes = Uint8Array.from(atob(signature.replaceAll('-', '+').replaceAll('_', '/') + '='), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', await signingKey(secret), bytes, new TextEncoder().encode(canonicalJson(scope)));
    const now = Date.now();
    if (!valid || scope.expiresAt <= now || scope.issuedAt > now + 30000 || scope.expiresAt - scope.issuedAt > 15 * 60000) throw new DomainError('This grocery sync expired or changed. Start a fresh sync from CookBook.', 401);
    if (new Set(scope.items.map(i => i.id)).size !== scope.items.length || new Set(scope.items.map(i => i.marker)).size !== scope.items.length) throw new DomainError('This grocery sync contains duplicate items. Start again.', 401);
    return scope;
}
export async function observationDigest(input: unknown) {
    return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(input)))));
}
