import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from './domain.ts';
import { bytes } from './http.ts';

export function photoExtension(data: Uint8Array, type: string) {
    if (type === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpg';
    if (type === 'image/png' && [137,80,78,71,13,10,26,10].every((value,index) => data[index] === value)) return 'png';
    if (type === 'image/webp' && new TextDecoder().decode(data.slice(0,4)) === 'RIFF' && new TextDecoder().decode(data.slice(8,12)) === 'WEBP') return 'webp';
    throw new DomainError('Choose a valid JPEG, PNG, or WebP photo.');
}
export function photoKey(reference: unknown, household: string) {
    if (typeof reference !== 'string' || !reference.startsWith('photo:')) throw new DomainError('Photo not found.', 404);
    const key = reference.slice(6), parts = key.split('/');
    if (parts.length !== 2 || parts[0] !== household || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(parts[1])) throw new DomainError('Photo not found.', 404);
    return key;
}
export const thumbnailKey = (key: string) => key.replace(/\.(jpg|png|webp)$/, '.thumb.webp');

export async function uploadPhotos(request: Request, admin: SupabaseClient, household: string) {
    const contentType = request.headers.get('content-type') ?? '';
    let data: Uint8Array, type: string, thumbnail: Uint8Array | undefined;
    if (contentType.startsWith('multipart/form-data;')) {
        const form = await new Response(await bytes(request, 6000000), { headers: { 'Content-Type': contentType } }).formData();
        const photo = form.get('photo'), small = form.get('thumbnail');
        if (!(photo instanceof File) || photo.size > 5242880) throw new DomainError('Choose a photo under 5 MB.');
        data = new Uint8Array(await photo.arrayBuffer()); type = photo.type;
        if (small !== null) {
            if (!(small instanceof File) || small.size > 500000 || small.type !== 'image/webp') throw new DomainError('The photo preview could not be read.');
            thumbnail = new Uint8Array(await small.arrayBuffer()); photoExtension(thumbnail, small.type);
        }
    } else { data = await bytes(request, 5242880); type = contentType; }
    const extension = photoExtension(data, type), key = household + '/' + crypto.randomUUID() + '.' + extension;
    const bucket = admin.storage.from('cookbook-photos');
    const results = await Promise.all([
        bucket.upload(key, data, { contentType: type, upsert: false, cacheControl: '300' }),
        ...(thumbnail ? [bucket.upload(thumbnailKey(key), thumbnail, { contentType: 'image/webp', upsert: false, cacheControl: '300' })] : []),
    ]);
    if (results.some(result => result.error)) {
        await bucket.remove(thumbnail ? [key, thumbnailKey(key)] : [key]).catch(() => {});
        throw new DomainError('Your photo could not be uploaded. Please try again.', 503);
    }
    return { url: 'photo:' + key };
}

export async function signedPhotos(admin: SupabaseClient, household: string, input: any) {
    if (!Array.isArray(input?.references) || !input.references.length || input.references.length > 24 || !['full','thumbnail'].includes(input.variant)) throw new DomainError('Choose up to 24 recipe photos.');
    const references: string[] = [...new Set<string>(input.references)];
    const keys = references.map(reference => photoKey(reference, household));
    const paths = input.variant === 'thumbnail' ? keys.flatMap(key => [thumbnailKey(key), key]) : keys;
    const { data, error } = await admin.storage.from('cookbook-photos').createSignedUrls(paths, 300);
    if (error || !data) throw new DomainError('Your photos could not be loaded. Please try again.', 503);
    const byPath = new Map(data.map(row => [row.path, row.error ? '' : row.signedUrl]));
    const urls: Record<string, { url: string; fallback?: string }> = {};
    keys.forEach((key,index) => {
        const original = byPath.get(key), thumbnail = byPath.get(thumbnailKey(key));
        const url = input.variant === 'thumbnail' ? thumbnail || original : original;
        if (url) urls[references[index]] = { url, ...(input.variant === 'thumbnail' && thumbnail && original ? { fallback: original } : {}) };
    });
    return { urls };
}
