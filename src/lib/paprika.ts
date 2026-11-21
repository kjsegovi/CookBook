import { clean, normalizeNutrition, parseIngredient, type IngredientLine, type Nutrition } from '../../supabase/functions/_shared/domain.ts';

// Reads a Paprika 3 export (.paprikarecipes): a zip archive whose entries are
// gzip-compressed JSON recipes with base64 photos. Everything runs in the
// browser; nothing is sent anywhere until you choose to import.
export type PaprikaPhoto = { data: Uint8Array; type: string };
export type PaprikaRecipe = { recipe: Record<string, unknown>; photos: PaprikaPhoto[] };

async function inflate(data: Uint8Array, format: 'deflate-raw' | 'gzip') {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimal zip reader: the central directory lists every entry with its sizes,
// which also covers archives written with streaming data descriptors.
export async function unzip(buffer: ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
    const view = new DataView(buffer), bytes = new Uint8Array(buffer), decoder = new TextDecoder();
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('This is not a Paprika export. Choose a .paprikarecipes file.');
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const entries: { name: string; data: Uint8Array }[] = [];
    for (let n = 0; n < count; n++) {
        if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('This Paprika export is damaged.');
        const method = view.getUint16(offset + 10, true), compressed = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
        const local = view.getUint32(offset + 42, true), name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
        offset += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) continue;
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = bytes.subarray(start, start + compressed);
        if (method !== 0 && method !== 8) throw new Error('This Paprika export uses an unsupported compression.');
        entries.push({ name, data: method === 8 ? await inflate(raw, 'deflate-raw') : raw });
    }
    return entries;
}

const base64 = (value: unknown) => {
    if (typeof value !== 'string' || !value) return null;
    try { const binary = atob(value.replace(/\s+/g, '')); const out = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i); return out; } catch { return null; }
};
const imageType = (data: Uint8Array) => data[0] === 0x89 && data[1] === 0x50 ? 'image/png' : data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57 ? 'image/webp' : 'image/jpeg';

export async function readPaprikaExport(buffer: ArrayBuffer): Promise<PaprikaRecipe[]> {
    const result: PaprikaRecipe[] = [];
    for (const entry of await unzip(buffer)) {
        if (!/\.paprikarecipe$/i.test(entry.name)) continue;
        const data = entry.data[0] === 0x1f && entry.data[1] === 0x8b ? await inflate(entry.data, 'gzip') : entry.data;
        let recipe: Record<string, unknown>;
        try { recipe = JSON.parse(new TextDecoder().decode(data)); } catch { continue; }
        const photos: PaprikaPhoto[] = [];
        for (const encoded of [recipe.photo_data, ...(Array.isArray(recipe.photos) ? recipe.photos.map((p: any) => p?.data) : [])]) {
            const bytes = base64(encoded);
            if (bytes && bytes.length > 100) photos.push({ data: bytes, type: imageType(bytes) });
        }
        result.push({ recipe, photos: photos.slice(0, 12) });
    }
    if (!result.length) throw new Error('No recipes were found in this file.');
    return result;
}

// "1 hr 15 mins", "45 minutes", "PT20M" or "1:30" → minutes.
export function minutes(value: unknown) {
    const text = clean(value, 100).toLowerCase();
    if (!text) return 0;
    const iso = text.match(/^pt(?:(\d+)h)?(?:(\d+)m)?/);
    if (iso) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0);
    const clock = text.match(/^(\d+):(\d{2})$/);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)?.[1] ?? 0), mins = Number(text.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/)?.[1] ?? 0);
    if (hours || mins) return Math.round(hours * 60 + mins);
    const plain = Number(text.match(/^\d+/)?.[0]);
    return Number.isFinite(plain) ? plain : 0;
}
// Paprika's nutrition is free text; pull out the common values and keep the text.
export function nutritionFrom(text: unknown): Nutrition | null {
    const source = clean(text, 1000);
    if (!source) return null;
    const find = (pattern: RegExp) => { const m = source.match(pattern); return m ? Number(m[1]) : undefined; };
    return normalizeNutrition({
        calories: find(/calories?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i), protein: find(/protein\s*[:\-]?\s*(\d+(?:\.\d+)?)/i), carbs: find(/carb(?:ohydrate)?s?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i),
        fat: find(/(?<!saturated |trans )fat\s*[:\-]?\s*(\d+(?:\.\d+)?)/i), fiber: find(/fib(?:er|re)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i), sugar: find(/sugars?\s*[:\-]?\s*(\d+(?:\.\d+)?)/i), sodium: find(/sodium\s*[:\-]?\s*(\d+(?:\.\d+)?)/i),
        text: source,
    });
}
// Paprika keeps ingredients as text; a line ending in ":" starts a section.
function ingredientsFrom(text: unknown): IngredientLine[] {
    let group = '';
    const lines: IngredientLine[] = [];
    for (const raw of String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
        if (/:$/.test(raw) && raw.length < 80) { group = raw.slice(0, -1).trim(); continue; }
        lines.push({ ...parseIngredient(raw), group });
    }
    return lines.slice(0, 200);
}
const createdAt = (value: unknown) => { const d = new Date(clean(value, 40).replace(' ', 'T')); return Number.isNaN(d.valueOf()) ? undefined : d.toISOString(); };
const httpLink = (value: unknown) => { const v = clean(value, 2000); return /^https?:\/\//i.test(v) ? v : ''; };

export function toRecipe(item: PaprikaRecipe, images: string[] = []) {
    const p = item.recipe as any;
    const id = 'paprika-' + (clean(p.uid, 80).replace(/[^A-Za-z0-9-]/g, '') || crypto.randomUUID());
    const servingsText = clean(p.servings, 100), servings = Number(servingsText.match(/\d+(?:\.\d+)?/)?.[0]);
    const steps = String(p.directions ?? '').split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean).slice(0, 100);
    const extra = [servingsText && !Number.isFinite(servings) ? 'Servings: ' + servingsText : '', p.difficulty ? 'Difficulty: ' + clean(p.difficulty, 100) : ''].filter(Boolean);
    const sourceUrl = httpLink(p.source_url) || httpLink(p.source);
    const categories = (Array.isArray(p.categories) ? p.categories : []).map((c: unknown) => clean(typeof c === 'string' ? c : (c as any)?.name, 80)).filter(Boolean);
    return {
        id: id.slice(0, 100), title: clean(p.name, 200) || 'Untitled recipe', description: clean(p.description, 3000),
        servings: Number.isFinite(servings) && servings > 0 ? servings : 2, prepMinutes: minutes(p.prep_time), cookMinutes: minutes(p.cook_time),
        categories, category: categories[0], tags: [], rating: Number(p.rating) || 0, favorite: !!Number(p.on_favorites ?? 0) || p.on_favorites === true, wantToTry: false,
        images, image: images[0] ?? (httpLink(p.image_url) || ''), sourceUrl, author: sourceUrl ? clean(p.source, 200).replace(/^https?:\/\/\S+$/, '') : clean(p.source, 200),
        ingredients: ingredientsFrom(p.ingredients), steps, notes: [clean(p.notes, 9000), ...extra].filter(Boolean).join('\n\n'),
        nutrition: nutritionFrom(p.nutritional_info), related: [], createdAt: createdAt(p.created),
    };
}
