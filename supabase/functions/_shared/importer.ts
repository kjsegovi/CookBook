import { blankRecipe, clean, DomainError, parseIngredient, httpUrl, type ImportDraft, uid } from './domain.ts';
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
export async function publicFetch(value: string, max = 2000000): Promise<{
    text: string;
    url: string;
    type: string;
}> { let url = safeUrl(value); for (let hop = 0; hop < 4; hop++) {
    await verifyDns(url.hostname);
    const response = await fetch(url.href, { redirect: 'manual', headers: { accept: 'text/html, application/json;q=0.9', 'User-Agent': 'CookBook Recipe Importer' }, signal: AbortSignal.timeout(12000) });
    if (response.status >= 300 && response.status < 400) {
        const loc = response.headers.get('location');
        if (!loc)
            break;
        url = safeUrl(new URL(loc, url).href);
        continue;
    }
    if (!response.ok)
        throw new DomainError(`The source returned ${response.status}. Paste the recipe text instead.`);
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/(ld\+)?json|text\/plain/.test(type))
        throw new DomainError('This link does not contain a recipe page. Paste the recipe text instead.');
    if (Number(response.headers.get('content-length')) > max)
        throw new DomainError('This page is too large to import. Paste the recipe text instead.');
    const reader = response.body!.getReader();
    let size = 0, text = '';
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.length;
        if (size > max) {
            await reader.cancel();
            throw new DomainError('This page is too large to import. Paste the recipe text instead.');
        }
        text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, url: url.href, type };
} throw new DomainError('This link redirects too many times. Paste the recipe text instead.'); }
export function plain(value: any): string { if (typeof value !== 'string')
    return ''; return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }
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
export function extractPage(html: string, url: string): ImportDraft { const r = blankRecipe(), warnings: string[] = []; r.sourceUrl = url; const candidates: any[] = []; for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
        candidates.push(...findRecipes(JSON.parse(m[1])));
    }
    catch {
        warnings.push('Some recipe metadata could not be read.');
    }
} const data = candidates[0]; if (candidates.length > 1)
    warnings.push('This page contains multiple recipes. Review the selected recipe before saving.'); const meta = (key: string) => { for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g))
        attrs[a[1].toLowerCase()] = a[2];
    if ((attrs.property ?? attrs.name) === key)
        return attrs.content ?? '';
} return ''; }; r.title = plain(data?.name) || plain(meta('og:title')) || plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''); r.description = plain(data?.description); r.image = imageUrl(data?.image, url) || imageUrl(meta('og:image'), url); r.author = plain(typeof data?.author === 'string' ? data.author : Array.isArray(data?.author) ? data.author.map((a: any) => a.name).join(', ') : data?.author?.name); r.prepMinutes = duration(data?.prepTime); r.cookMinutes = duration(data?.cookTime) || Math.max(0, duration(data?.totalTime) - r.prepMinutes); const yieldText = String(Array.isArray(data?.recipeYield) ? data.recipeYield[0] : data?.recipeYield ?? ''); const servings = yieldText.match(/\d+(?:\.\d+)?/); if (servings && Number(servings[0]) > 0) {
    r.servings = Number(servings[0]);
    warnings.push('Original yield: ' + yieldText + '. Confirm what counts as one serving before scaling.');
}
else
    warnings.push('Original serving yield was unavailable; confirm the serving count.'); r.ingredients = (Array.isArray(data?.recipeIngredient) ? data.recipeIngredient : []).map((x: any) => parseIngredient(plain(x))); r.steps = steps(data?.recipeInstructions); const cat = Array.isArray(data?.recipeCategory) ? data.recipeCategory[0] : data?.recipeCategory; if (cat)
    r.category = plain(cat); r.tags = typeof data?.keywords === 'string' ? data.keywords.split(',').map((s: string) => s.trim()).slice(0, 20) : []; if (!r.ingredients.length || !r.steps.length)
    warnings.push('Paste the recipe text or transcript and ask the connected assistant to finish this draft.'); if (!r.image)
    warnings.push('No recipe image was found. You can upload a photo.'); return { id: uid(), recipe: r, text: plain(data?.description) || '', warnings, createdAt: new Date().toISOString() }; }
export function youtubeId(value: string) { const u = new URL(value), host = u.hostname.toLowerCase(); if (host === 'youtu.be')
    return u.pathname.split('/')[1]; if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(host))
    return u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ?? null; return null; }
export async function importLink(value: string): Promise<ImportDraft> {
    const url = safeUrl(value), id = youtubeId(url.href);
    if (id) {
        if (!/^[\w-]{11}$/.test(id))
            throw new DomainError('This YouTube video link is not valid.');
        const canonical = 'https://www.youtube.com/watch?v=' + id, r = blankRecipe();
        r.sourceUrl = canonical;
        const draft: ImportDraft = { id: uid(), recipe: r, text: '', warnings: ['Review the title and servings. Paste the recipe or transcript below, then ask the connected assistant to finish the draft.'], createdAt: new Date().toISOString() };
        try {
            const meta = await publicFetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(canonical) + '&format=json', 100000);
            const data = JSON.parse(meta.text);
            r.title = clean(data.title, 200);
            r.author = clean(data.author_name, 200);
            r.image = imageUrl(data.thumbnail_url, canonical);
        }
        catch {
            draft.warnings.push('Video details could not be loaded; the source link is saved.');
        }
        try {
            const page = await publicFetch(canonical), match = page.text.match(/"shortDescription"\s*:\s*("(?:\\.|[^"\\])*")/);
            const description = match ? String(JSON.parse(match[1])) : '';
            draft.text = description.slice(0, 60000);
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
                    }
                }
                catch {
                    draft.warnings.push('The linked recipe could not be read. Paste its recipe text instead.');
                }
            }
        }
        catch { /* Video metadata can still be reviewed when the watch page is unavailable. */ }
        return draft;
    }
    try {
        const page = await publicFetch(url.href);
        return extractPage(page.text, page.url);
    }
    catch (e) {
        if (e instanceof DomainError && /public destination|public website|Local and private/.test(e.message))
            throw e;
        const recipe = blankRecipe();
        recipe.sourceUrl = url.href;
        return { id: uid(), recipe, text: '', warnings: [e instanceof Error ? e.message : 'The source could not be read.', 'The link is saved. Paste recipe text or a transcript and ask the connected assistant to finish this draft.'], createdAt: new Date().toISOString() };
    }
}
