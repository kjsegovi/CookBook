import { blankRecipe, clean, DomainError, normalizeNutrition, parseIngredient, httpUrl, type ImportDraft, type Recipe, uid } from './domain.ts';

// User agents: see IMPORTER_USER_AGENT below (honest first, browser retry after a refusal).
// Sites behind Cloudflare often accept an honest client but block a request that
// claims to be Chrome without behaving like it (budgetbytes.com does), while a
// few only accept a browser. So: honest first, browser once after a refusal.
export const IMPORTER_USER_AGENT = 'CookBook Recipe Importer';
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function isPublicHost(host: string) { const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''); if (!h || h === 'localhost' || !h.includes('.') || /\.(localhost|local|internal|test|invalid)$/.test(h) || h.includes(':') || /^\d+$/.test(h))
    return false; if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224 || a === 198 && (b === 18 || b === 19));
} return true; }
export function safeUrl(value: string) { const url = new URL(httpUrl(value)); if (!isPublicHost(url.hostname) || url.port && url.port !== '443' && url.port !== '80')
    throw new DomainError('Use a public website link. Local and private addresses are not supported.'); return url; }
export function isGlobalIpv6(address: string) { const a = address.toLowerCase(); return /^[23][0-9a-f]{0,3}:/.test(a) && !a.startsWith('2001:db8:'); }
async function verifyDns(host: string) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host))
        return;
    const results = await Promise.all(['A', 'AAAA'].map(async (type) => { const response = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(host) + '&type=' + type, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(7000) }); if (!response.ok)
        throw new DomainError('Could not verify this website. Try again or paste its recipe text.'); return response.json() as Promise<any>; }));
    const answers = results.flatMap(result => result.Answer ?? []).filter((a: any) => a.type === 1 || a.type === 28);
    if (!answers.length || answers.some((a: any) => a.type === 1 ? !isPublicHost(String(a.data)) : !isGlobalIpv6(String(a.data))))
        throw new DomainError('This website could not be verified as a public destination. Paste its recipe text instead.');
}

export type GuardedFetchOptions = {
    max: number;
    accept: string;
    types: RegExp;
    wrongType: string;
    tooLarge: string;
    /** Appended to status and redirect errors, e.g. "Paste the recipe text instead." */
    fallback: string;
    timeoutMs?: number;
};
/**
 * Every outbound request goes through here: public-host check, DNS verification on each hop,
 * manual redirects re-checked with safeUrl, content-type allow-list, byte cap, and a timeout.
 */
async function guardedFetch(value: string, o: GuardedFetchOptions): Promise<{ data: Uint8Array; url: string; type: string }> {
    let url = safeUrl(value);
    for (let hop = 0; hop < 4; hop++) {
        await verifyDns(url.hostname);
        const request = (agent: string) => fetch(url.href, { redirect: 'manual', headers: { accept: o.accept, 'accept-language': 'en-US,en;q=0.9', 'user-agent': agent }, signal: AbortSignal.timeout(o.timeoutMs ?? 12000) });
        let response = await request(IMPORTER_USER_AGENT);
        if (response.status === 403 || response.status === 429) { await response.body?.cancel(); response = await request(BROWSER_USER_AGENT); }
        if (response.status >= 300 && response.status < 400) {
            const loc = response.headers.get('location');
            if (!loc)
                break;
            url = safeUrl(new URL(loc, url).href);
            continue;
        }
        if (!response.ok)
            throw new DomainError(`The source returned ${response.status}. ${o.fallback}`);
        const type = response.headers.get('content-type') ?? '';
        if (!o.types.test(type))
            throw new DomainError(o.wrongType);
        if (Number(response.headers.get('content-length')) > o.max)
            throw new DomainError(o.tooLarge);
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body?.getReader();
        while (reader) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > o.max) {
                await reader.cancel();
                throw new DomainError(o.tooLarge);
            }
            chunks.push(value);
        }
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        return { data, url: url.href, type };
    }
    throw new DomainError('This link redirects too many times. ' + o.fallback);
}
const PAGE_TYPES = /text\/html|application\/(ld\+)?json|text\/plain/;
export async function publicFetch(value: string, max = 2000000, options: { accept?: string; types?: RegExp } = {}): Promise<{
    text: string;
    url: string;
    type: string;
}> {
    const result = await guardedFetch(value, { max, accept: options.accept ?? 'text/html, application/json;q=0.9', types: options.types ?? PAGE_TYPES, wrongType: 'This link does not contain a recipe page. Paste the recipe text instead.', tooLarge: 'This page is too large to import. Paste the recipe text instead.', fallback: 'Paste the recipe text instead.' });
    return { text: new TextDecoder().decode(result.data), url: result.url, type: result.type };
}
/** Byte fetch with the same SSRF guards as page fetches (used to re-host images). */
export function publicFetchBytes(value: string, options: GuardedFetchOptions) { return guardedFetch(value, options); }

function codePoint(n: number, raw: string) { return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : raw; }
export function plain(value: any): string { if (typeof value !== 'string')
    return ''; return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]{1,6});/gi, (raw, hex) => codePoint(parseInt(hex, 16), raw)).replace(/&#(\d{1,7});/g, (raw, dec) => codePoint(Number(dec), raw)).replace(/\s+/g, ' ').trim(); }
/** Visible page text for the assistant: drops scripts, styles, and site chrome before flattening. */
export function readableText(html: string, max = 20000) {
    const stripped = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg|iframe|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
    return plain(stripped).slice(0, max);
}
function duration(v: unknown) { const s = String(v ?? ''), m = s.match(/PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/i); return m ? Math.ceil(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60) : 0; }
function steps(v: any): string[] { if (Array.isArray(v))
    return v.flatMap(steps); if (typeof v === 'string')
    return v.split(/\n+/).map(plain).filter(Boolean); if (v && typeof v === 'object') {
    if (v.itemListElement)
        return steps(v.itemListElement);
    return v.text ? [plain(v.text)] : [];
} return []; }
export function imageUrl(v: any, base: string): string { let raw = typeof v === 'string' ? v : Array.isArray(v) ? imageUrl(v[0], base) : v?.url ?? v?.contentUrl ?? ''; if (!raw)
    return ''; try {
    return safeUrl(new URL(raw, base).href).href;
}
catch {
    return '';
} }
function findRecipes(v: any): any[] { if (Array.isArray(v))
    return v.flatMap(findRecipes); if (!v || typeof v !== 'object')
    return []; const types = Array.isArray(v['@type']) ? v['@type'] : [v['@type']]; const found = types.some((t: any) => String(t).split('/').pop() === 'Recipe') ? [v] : []; for (const k of ['@graph', 'mainEntity', 'itemListElement', 'item'])
    if (v[k])
        found.push(...findRecipes(v[k])); return found; }

function attributes(source: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of source.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g))
        out[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    return out;
}
function metaContent(html: string, key: string) {
    for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
        const attrs = attributes(m[1]);
        if ((attrs.property ?? attrs.name ?? attrs.itemprop) === key)
            return attrs.content ?? '';
    }
    return '';
}

// ---- Microdata (itemscope/itemprop) fallback for pages without JSON-LD ----
type MicroItem = { type: string; props: Record<string, unknown[]> };
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function microdataItems(html: string): MicroItem[] {
    type Open = { tag: string; attrs: Record<string, string>; start: number; item?: MicroItem; scope: MicroItem | null };
    const items: MicroItem[] = [], stack: Open[] = [], lower = html.toLowerCase();
    const scope = () => { for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i].item)
            return stack[i].item!; return null; };
    const close = (open: Open, end: number) => {
        if (!('itemprop' in open.attrs) || !open.scope)
            return;
        const a = open.attrs, tag = open.tag;
        const value = open.item ?? ('content' in a ? a.content
            : ['img', 'audio', 'video', 'source', 'embed', 'iframe', 'track'].includes(tag) ? a.src ?? ''
                : ['a', 'link', 'area'].includes(tag) ? a.href ?? ''
                    : tag === 'time' && a.datetime ? a.datetime
                        : ['data', 'meter'].includes(tag) && 'value' in a ? a.value
                            : html.slice(open.start, end));
        for (const name of a.itemprop.split(/\s+/).filter(Boolean))
            (open.scope.props[name] ??= []).push(value);
    };
    const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
        const name = m[2].toLowerCase();
        if (m[1]) {
            let index = stack.length - 1;
            while (index >= 0 && stack[index].tag !== name)
                index--;
            while (index >= 0 && stack.length > index)
                close(stack.pop()!, m.index);
            continue;
        }
        if (name === 'script' || name === 'style') {
            const end = lower.indexOf('</' + name, tagRe.lastIndex);
            tagRe.lastIndex = end < 0 ? html.length : end;
            continue;
        }
        const attrs = attributes(m[3]);
        const item = 'itemscope' in attrs ? { type: attrs.itemtype ?? '', props: {} } : undefined;
        if (item)
            items.push(item);
        const open: Open = { tag: name, attrs, start: tagRe.lastIndex, item, scope: scope() };
        if (VOID_TAGS.has(name) || /\/\s*$/.test(m[3]))
            close(open, tagRe.lastIndex);
        else
            stack.push(open);
    }
    while (stack.length)
        close(stack.pop()!, html.length);
    return items;
}
/** Microdata Recipe items reshaped like JSON-LD so they share one extraction path. */
function microdataRecipes(html: string): any[] {
    const str = (v: unknown) => typeof v === 'string' ? v : '';
    const isItem = (v: unknown): v is MicroItem => !!v && typeof v === 'object' && 'props' in (v as any);
    const named = (v: unknown) => isItem(v) ? str(v.props.name?.[0]) : str(v);
    const image = (v: unknown) => isItem(v) ? str(v.props.url?.[0] ?? v.props.contentUrl?.[0]) : str(v);
    const blocks = (v: string) => v.replace(/\s+/g, ' ').replace(/<(li|p|br|div|h[1-6])\b/gi, '\n<$1');
    const instruction = (v: unknown): string[] => !isItem(v) ? [blocks(str(v))]
        : v.props.itemListElement ? v.props.itemListElement.flatMap(instruction)
            : v.props.step ? v.props.step.flatMap(instruction)
                : [str(v.props.text?.[0] ?? v.props.name?.[0])];
    return microdataItems(html).filter(i => i.type.split(/\s+/).some(t => t.split('/').pop() === 'Recipe')).map(({ props: p }) => {
        const first = (k: string) => plain(str(p[k]?.[0]));
        return {
            '@type': 'Recipe',
            name: str(p.name?.[0]),
            description: str(p.description?.[0]),
            image: (p.image ?? []).map(image).filter(Boolean),
            author: (p.author ?? []).map(named).map(plain).filter(Boolean).join(', '),
            prepTime: first('prepTime'), cookTime: first('cookTime'), totalTime: first('totalTime'),
            recipeYield: first('recipeYield'), recipeCategory: first('recipeCategory') || undefined, keywords: first('keywords'),
            recipeIngredient: (p.recipeIngredient ?? p.ingredients ?? []).map(str),
            recipeInstructions: (p.recipeInstructions ?? []).flatMap(instruction),
        };
    });
}

// Structured data often points at shared entries by "@id" (Yoast puts the
// author in a separate Person node), so every node with an @id is indexed.
function indexNodes(v: any, index: Map<string, any>) {
    if (Array.isArray(v)) { for (const x of v) indexNodes(x, index); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v['@id'] === 'string' && Object.keys(v).length > 1) index.set(v['@id'], v);
    for (const value of Object.values(v)) if (value && typeof value === 'object') indexNodes(value, index);
}
const resolve = (v: any, index: Map<string, any>) => v && typeof v === 'object' && !Array.isArray(v) && typeof v['@id'] === 'string' && Object.keys(v).length === 1 ? index.get(v['@id']) ?? v : v;
function authorName(v: any, index: Map<string, any>): string {
    if (Array.isArray(v)) return v.map(a => authorName(a, index)).filter(Boolean).join(', ');
    const a = resolve(v, index);
    return typeof a === 'string' ? plain(a) : plain(a?.name ?? '');
}
// schema.org NutritionInformation uses text such as "198 kcal", "12 g", "819 mg".
export function nutritionFromSchema(v: any) {
    if (!v || typeof v !== 'object') return null;
    const amount = (value: unknown, unit: 'g' | 'mg' | 'kcal') => {
        const m = String(value ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kcal|cal|mg|g)?/i);
        if (!m) return undefined;
        const n = Number(m[1]), given = (m[2] ?? '').toLowerCase();
        if (unit === 'mg' && given === 'g') return n * 1000;
        if (unit === 'g' && given === 'mg') return n / 1000;
        return n;
    };
    return normalizeNutrition({
        calories: amount(v.calories, 'kcal'), protein: amount(v.proteinContent, 'g'), carbs: amount(v.carbohydrateContent, 'g'), fat: amount(v.fatContent, 'g'),
        fiber: amount(v.fiberContent, 'g'), sugar: amount(v.sugarContent, 'g'), sodium: amount(v.sodiumContent, 'mg'), servingSize: plain(v.servingSize ?? ''),
    });
}
// Budget sites list a price after each ingredient: "2 garlic cloves (minced, $0.16)".
export function withoutPrices(line: string) {
    return line.replace(/,?\s*\$\d+(?:\.\d+)?\**/g, '').replace(/\(\s*\)/g, '').replace(/\(\s*,\s*/g, '(').replace(/\s+\)/g, ')').replace(/\s{2,}/g, ' ').trim();
}
// WP Recipe Maker pages name ingredient sections in the HTML but not in the
// structured data. Used only when the counts line up exactly.
function wprmGroups(html: string, count: number): string[] | null {
    const groups: string[] = []; let current = '';
    for (const m of html.matchAll(/wprm-recipe-group-name[^>]*>([^<]*)<|<li\b[^>]*class="[^"]*\bwprm-recipe-ingredient\b/g)) {
        if (m[1] !== undefined) current = plain(m[1]); else groups.push(current);
    }
    return groups.length === count && groups.some(Boolean) ? groups : null;
}
function structuredDraft(html: string, url: string): { draft: ImportDraft; found: boolean } { const r = blankRecipe(), warnings: string[] = []; r.sourceUrl = url; const candidates: any[] = [], nodes = new Map<string, any>(); for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
        const parsed = JSON.parse(m[1]);
        indexNodes(parsed, nodes);
        candidates.push(...findRecipes(parsed));
    }
    catch {
        warnings.push('Some recipe metadata could not be read.');
    }
} if (!candidates.length) {
    try {
        candidates.push(...microdataRecipes(html));
    }
    catch { /* Microdata is a best-effort fallback. */ }
} const data = candidates[0]; if (candidates.length > 1)
    warnings.push('This page contains multiple recipes. Review the selected recipe before saving.'); const meta = (key: string) => metaContent(html, key); r.title = plain(data?.name) || plain(meta('og:title')) || plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''); r.description = plain(data?.description); r.image = imageUrl(data?.image, url) || imageUrl(meta('og:image'), url); r.author = authorName(data?.author, nodes).slice(0, 200); r.nutrition = nutritionFromSchema(resolve(data?.nutrition, nodes)); r.prepMinutes = duration(data?.prepTime); r.cookMinutes = duration(data?.cookTime) || Math.max(0, duration(data?.totalTime) - r.prepMinutes); const yieldText = String(Array.isArray(data?.recipeYield) ? data.recipeYield[0] : data?.recipeYield ?? ''); const servings = yieldText.match(/\d+(?:\.\d+)?/); if (servings && Number(servings[0]) > 0) {
    r.servings = Number(servings[0]);
    warnings.push('Original yield: ' + yieldText + '. Confirm what counts as one serving before scaling.');
}
else
    warnings.push('Original serving yield was unavailable; confirm the serving count.'); r.ingredients = (Array.isArray(data?.recipeIngredient) ? data.recipeIngredient : []).map((x: any) => withoutPrices(plain(x))).filter(Boolean).map(parseIngredient); const sections = wprmGroups(html, r.ingredients.length); if (sections) r.ingredients = r.ingredients.map((line, i) => ({ ...line, group: sections[i] })); r.steps = steps(data?.recipeInstructions); const cat = Array.isArray(data?.recipeCategory) ? data.recipeCategory[0] : data?.recipeCategory; if (cat)
    r.category = plain(cat); r.tags = typeof data?.keywords === 'string' && data.keywords.trim() ? data.keywords.split(',').map((s: string) => s.trim()).filter(Boolean).slice(0, 20) : []; if (!r.ingredients.length || !r.steps.length)
    warnings.push('Paste the recipe text or transcript and ask the connected assistant to finish this draft.'); if (!r.image)
    warnings.push('No recipe image was found. You can upload a photo.'); return { draft: { id: uid(), recipe: r, text: plain(data?.description) || '', warnings, createdAt: new Date().toISOString() }, found: candidates.length > 0 }; }
export function extractPage(html: string, url: string): ImportDraft { return structuredDraft(html, url).draft; }
export function youtubeId(value: string) { const u = new URL(value), host = u.hostname.toLowerCase(); if (host === 'youtu.be')
    return u.pathname.split('/')[1]; if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(host))
    return u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ?? null; return null; }

// ---- Source fetching: raw material for the assistant to structure ----
export type SourceKind = 'page' | 'youtube' | 'tiktok' | 'instagram';
export type FetchedSource = {
    kind: SourceKind;
    finalUrl: string;
    title: string;
    author: string;
    /** Structured recipe found on the page (JSON-LD or microdata), or on the page a video links to. */
    candidate: Recipe | null;
    /** Readable page text (scripts and site chrome removed), capped at ~20k characters. */
    text: string;
    description: string;
    transcript: string;
    images: string[];
    warnings: string[];
};
type Loaded = { source: FetchedSource; draft: ImportDraft };
export function sourceKind(url: URL): SourceKind {
    if (youtubeId(url.href) !== null)
        return 'youtube';
    const host = url.hostname.toLowerCase();
    if (/(^|\.)tiktok\.com$/.test(host))
        return 'tiktok';
    if (/(^|\.)instagram\.com$/.test(host) || host === 'instagr.am')
        return 'instagram';
    return 'page';
}
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const emptySource = (kind: SourceKind, finalUrl: string): FetchedSource => ({ kind, finalUrl, title: '', author: '', candidate: null, text: '', description: '', transcript: '', images: [], warnings: [] });
const newDraft = (recipe: Recipe, warnings: string[] = []): ImportDraft => ({ id: uid(), recipe, text: '', warnings, createdAt: new Date().toISOString() });

async function loadPage(url: URL): Promise<Loaded> {
    const page = await publicFetch(url.href);
    const { draft, found } = structuredDraft(page.text, page.url), meta = (key: string) => metaContent(page.text, key);
    const source = emptySource('page', page.url);
    source.title = draft.recipe.title;
    source.author = draft.recipe.author;
    source.candidate = found ? draft.recipe : null;
    source.text = readableText(page.text);
    source.description = draft.recipe.description || plain(meta('og:description')) || plain(meta('description'));
    source.images = unique([draft.recipe.image, imageUrl(meta('og:image'), page.url), imageUrl(meta('twitter:image'), page.url)]);
    source.warnings = found ? [...draft.warnings] : ['No structured recipe was found on this page; read the recipe from the page text.', ...draft.warnings.filter(w => !w.startsWith('Original serving yield'))];
    return { source, draft };
}

/** Finds `"key":[...]` inside a page script and parses the array, respecting JSON strings. */
function jsonArrayAfter(source: string, key: string): any[] | null {
    const at = source.indexOf(`"${key}":`);
    if (at < 0)
        return null;
    const start = source.indexOf('[', at);
    if (start < 0 || start - at > key.length + 8)
        return null;
    let depth = 0, inString = false;
    for (let i = start; i < source.length && i - start < 200000; i++) {
        const c = source[i];
        if (inString) {
            if (c === '\\')
                i++;
            else if (c === '"')
                inString = false;
        }
        else if (c === '"')
            inString = true;
        else if (c === '[' || c === '{')
            depth++;
        else if ((c === ']' || c === '}') && --depth === 0) {
            try {
                return JSON.parse(source.slice(start, i + 1));
            }
            catch {
                return null;
            }
        }
    }
    return null;
}
function captionText(body: string): string {
    const trimmed = body.trim();
    if (!trimmed)
        return '';
    if (trimmed.startsWith('{')) {
        const data = JSON.parse(trimmed);
        return (Array.isArray(data.events) ? data.events : []).map((e: any) => (Array.isArray(e.segs) ? e.segs : []).map((s: any) => String(s.utf8 ?? '')).join('')).join(' ').replace(/\s+/g, ' ').trim();
    }
    return [...trimmed.matchAll(/<(text|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => plain(m[2])).filter(Boolean).join(' ');
}
async function youtubeCaptions(watchHtml: string): Promise<{ transcript: string; warnings: string[] }> {
    const tracks = (jsonArrayAfter(watchHtml, 'captionTracks') ?? []).filter((t: any) => t && typeof t.baseUrl === 'string');
    if (!tracks.length)
        return { transcript: '', warnings: ['No captions were available for this video; use the description, or ask the user for the recipe.'] };
    const english = (t: any) => /^en\b/i.test(String(t.languageCode ?? '')), manual = (t: any) => t.kind !== 'asr';
    const track = tracks.find((t: any) => english(t) && manual(t)) ?? tracks.find(english) ?? tracks.find(manual) ?? tracks[0];
    try {
        const captionUrl = new URL(track.baseUrl, 'https://www.youtube.com');
        if (!/(^|\.)youtube\.com$/.test(captionUrl.hostname))
            throw new Error('Unexpected caption host');
        const response = await publicFetch(captionUrl.href, 2000000, { accept: 'text/xml, application/xml, application/json;q=0.9, */*;q=0.5', types: /xml|json|text\/plain|text\/html/ });
        const transcript = captionText(response.text).slice(0, 60000);
        if (!transcript)
            return { transcript: '', warnings: ['YouTube did not return caption text for this video; use the description, or ask the user for the recipe.'] };
        const warnings: string[] = [];
        if (!manual(track))
            warnings.push('The transcript comes from auto-generated captions; amounts and ingredient names may be misheard.');
        if (!english(track))
            warnings.push(`The transcript is in "${clean(track.languageCode, 20)}".`);
        return { transcript, warnings };
    }
    catch {
        return { transcript: '', warnings: ['The video captions could not be loaded; use the description, or ask the user for the recipe.'] };
    }
}
async function loadYoutube(id: string): Promise<Loaded> {
    if (!/^[\w-]{11}$/.test(id))
        throw new DomainError('This YouTube video link is not valid.');
    const canonical = 'https://www.youtube.com/watch?v=' + id, r = blankRecipe();
    r.sourceUrl = canonical;
    const draft = newDraft(r, ['Review the title and servings. Paste the recipe or transcript below, then ask the connected assistant to finish the draft.']);
    const source = emptySource('youtube', canonical);
    const warn = (message: string, both = true) => { source.warnings.push(message); if (both)
        draft.warnings.push(message); };
    try {
        const meta = await publicFetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(canonical) + '&format=json', 100000);
        const data = JSON.parse(meta.text);
        r.title = source.title = clean(data.title, 200);
        r.author = source.author = clean(data.author_name, 200);
        r.image = imageUrl(data.thumbnail_url, canonical);
    }
    catch {
        warn('Video details could not be loaded; the source link is saved.');
    }
    try {
        const page = await publicFetch(canonical), match = page.text.match(/"shortDescription"\s*:\s*("(?:\\.|[^"\\])*")/);
        const description = match ? String(JSON.parse(match[1])) : '';
        draft.text = source.description = description.slice(0, 60000);
        const captions = await youtubeCaptions(page.text);
        source.transcript = captions.transcript;
        source.warnings.push(...captions.warnings);
        const links = description.match(/https?:\/\/[^\s<>]+/g) ?? [];
        const link = links.map(x => x.replace(/[),.!]+$/, '')).find(x => { try {
            const h = safeUrl(x).hostname;
            return !/(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|twitter\.com|x\.com)$/.test(h);
        }
        catch {
            return false;
        } });
        if (link) {
            try {
                const linkedPage = await publicFetch(link), linked = extractPage(linkedPage.text, linkedPage.url);
                if (linked.recipe.ingredients.length && linked.recipe.steps.length) {
                    draft.recipe = { ...linked.recipe, id: r.id, image: linked.recipe.image || r.image, notes: 'Video source: ' + canonical };
                    draft.warnings = linked.warnings;
                    draft.text = description + '\n\nLinked recipe: ' + linkedPage.url;
                    source.candidate = draft.recipe;
                    source.text = readableText(linkedPage.text);
                    source.images.push(linked.recipe.image);
                    source.warnings.push('The recipe was read from the page linked in the video description: ' + linkedPage.url);
                }
            }
            catch {
                warn('The linked recipe could not be read. Paste its recipe text instead.');
            }
        }
    }
    catch {
        warn('The video page could not be read, so its description and captions are unavailable.', false);
    }
    if (source.transcript && !source.candidate)
        draft.text = [draft.text, 'Transcript:\n' + source.transcript].filter(Boolean).join('\n\n').slice(0, 60000);
    source.images = unique([r.image, ...source.images]);
    return { source, draft };
}
async function loadTiktok(url: URL): Promise<Loaded> {
    const r = blankRecipe(), source = emptySource('tiktok', url.href);
    r.sourceUrl = url.href;
    try {
        const meta = await publicFetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url.href), 100000);
        const data = JSON.parse(meta.text);
        source.description = plain(String(data.title ?? '')).slice(0, 20000);
        source.title = r.title = clean(source.description.split(/[#\n]/)[0], 200);
        source.author = r.author = clean(data.author_name, 200);
        r.image = imageUrl(data.thumbnail_url, url.href);
        source.images = unique([r.image]);
        if (/^\d+$/.test(String(data.embed_product_id ?? '')) && /^[\w.]+$/.test(String(data.author_unique_id ?? '')))
            source.finalUrl = r.sourceUrl = `https://www.tiktok.com/@${data.author_unique_id}/video/${data.embed_product_id}`;
        source.warnings.push('TikTok only shares the caption and thumbnail. If the caption lacks ingredients or steps, ask the user to paste them (or the on-screen text).');
    }
    catch {
        source.warnings.push('TikTok video details could not be loaded. Ask the user to paste the caption.');
    }
    const draft = newDraft(r, [...source.warnings]);
    draft.text = source.description;
    return { source, draft };
}
async function loadInstagram(url: URL): Promise<Loaded> {
    const r = blankRecipe(), source = emptySource('instagram', url.href);
    r.sourceUrl = url.href;
    try {
        const page = await publicFetch(url.href), meta = (key: string) => metaContent(page.text, key);
        source.finalUrl = page.url;
        source.title = r.title = clean(plain(meta('og:title')), 200);
        source.description = plain(meta('og:description')) || plain(meta('description'));
        r.image = imageUrl(meta('og:image'), page.url);
        source.images = unique([r.image]);
    }
    catch {
        source.warnings.push('The Instagram post could not be loaded.');
    }
    source.warnings.push('Instagram posts are usually login-walled, so the caption is often missing or cut off. Ask the user to paste the full caption.');
    const draft = newDraft(r, [...source.warnings]);
    draft.text = source.description;
    return { source, draft };
}
function load(url: URL): Promise<Loaded> {
    switch (sourceKind(url)) {
        case 'youtube': return loadYoutube(youtubeId(url.href)!);
        case 'tiktok': return loadTiktok(url);
        case 'instagram': return loadInstagram(url);
        default: return loadPage(url);
    }
}
/**
 * Fetches the raw material behind a link (page text, structured recipe if any, video description,
 * captions, images). It never invents a recipe; the assistant structures the result.
 */
export async function fetchSource(value: string): Promise<FetchedSource> { return (await load(safeUrl(value))).source; }
export async function importLink(value: string): Promise<ImportDraft> {
    const url = safeUrl(value);
    if (sourceKind(url) !== 'page')
        return (await load(url)).draft;
    try {
        return (await loadPage(url)).draft;
    }
    catch (e) {
        if (e instanceof DomainError && /public destination|public website|Local and private/.test(e.message))
            throw e;
        const recipe = blankRecipe();
        recipe.sourceUrl = url.href;
        return { id: uid(), recipe, text: '', warnings: [e instanceof Error ? e.message : 'The source could not be read.', 'The link is saved. Paste recipe text or a transcript and ask the connected assistant to finish this draft.'], createdAt: new Date().toISOString() };
    }
}
