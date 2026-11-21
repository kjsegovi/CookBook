// Keeps private recipe photos on the device. Signed photo links expire after
// five minutes, so the image bytes are cached under the stable photo reference
// instead and shown from a local object URL, online or offline.
import type { PhotoSource } from './photo-resolver';
const CACHE = 'cookbook-photos-v1';
const local = new Map<string, Promise<PhotoSource>>();
const keyFor = (reference: string, variant: string) => new URL(`./__photo-cache/${variant}/${encodeURIComponent(reference)}`, location.href).href;
const cacheStorage = () => { try { return globalThis.caches; } catch { return undefined; } };

export function cachedPhoto(reference: string, variant: string, resolve: () => Promise<PhotoSource>): Promise<PhotoSource> {
    const storage = cacheStorage();
    // Only private photos need this; public links and missing Cache API resolve as before.
    if (!reference.startsWith('photo:') || !storage) return resolve();
    const id = variant + ':' + reference;
    const existing = local.get(id);
    if (existing) return existing;
    const promise = (async () => {
        const key = keyFor(reference, variant);
        const cache = await storage.open(CACHE).catch(() => undefined);
        const hit = await cache?.match(key).catch(() => undefined);
        if (hit) return { url: URL.createObjectURL(await hit.blob()) };
        const source = await resolve();
        // A missing thumbnail falls back to the full photo, as the resolver does.
        for (const url of [source.url, source.fallback].filter((u): u is string => !!u)) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) continue;
                const blob = await response.blob();
                await cache?.put(key, new Response(blob, { headers: { 'content-type': blob.type || 'image/webp' } })).catch(() => undefined);
                return { url: URL.createObjectURL(blob) };
            } catch { /* Try the fallback, then show the signed link directly. */ }
        }
        return source;
    })();
    local.set(id, promise);
    promise.catch(() => local.delete(id));
    return promise;
}

export async function clearPhotoCache() {
    for (const source of await Promise.all([...local.values()].map(p => p.catch(() => undefined)))) if (source?.url.startsWith('blob:')) URL.revokeObjectURL(source.url);
    local.clear();
    try { await cacheStorage()?.delete(CACHE); } catch { /* Optional. */ }
}

// Shows a photo added on this device straight away, before (or without) uploading it.
export async function storeLocalPhoto(reference: string, variant: string, blob: Blob) {
    const cache = await cacheStorage()?.open(CACHE).catch(() => undefined);
    await cache?.put(keyFor(reference, variant), new Response(blob, { headers: { 'content-type': blob.type || 'image/webp' } })).catch(() => undefined);
    local.delete(variant + ':' + reference);
}
// Photos waiting to upload, kept until the server confirms them.
const uploadKey = (id: string, part: string) => keyFor('upload:' + id, part);
export async function queueUpload(id: string, photo: Blob, thumbnail?: Blob) {
    const cache = await cacheStorage()?.open(CACHE);
    if (!cache) throw new Error('This browser can’t keep photos offline. Add the photo when you’re online.');
    await cache.put(uploadKey(id, 'photo'), new Response(photo, { headers: { 'content-type': photo.type } }));
    if (thumbnail) await cache.put(uploadKey(id, 'thumbnail'), new Response(thumbnail, { headers: { 'content-type': thumbnail.type } }));
}
export async function queuedUpload(id: string) {
    const cache = await cacheStorage()?.open(CACHE);
    const [photo, thumbnail] = await Promise.all([cache?.match(uploadKey(id, 'photo')), cache?.match(uploadKey(id, 'thumbnail'))]);
    return photo ? { photo: await photo.blob(), thumbnail: thumbnail ? await thumbnail.blob() : undefined } : null;
}
export async function forgetUpload(id: string) {
    const cache = await cacheStorage()?.open(CACHE).catch(() => undefined);
    await Promise.all([cache?.delete(uploadKey(id, 'photo')), cache?.delete(uploadKey(id, 'thumbnail'))]).catch(() => undefined);
}
