// Read-only live timing checks. Uses the existing session helper; never logs or
// stores tokens, recipe contents, or account details. Native requests have no Origin.
import { writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { createSession } from './cookbook-session.mjs';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const project = env.VITE_SUPABASE_URL?.replace(/\/+$/, '');
if (!project || !env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error('Configure the public Supabase URL and key first.');
const session = createSession({ project, anonKey: env.VITE_SUPABASE_PUBLISHABLE_KEY });
let authenticated = true, sessionHeaders = {};
try { sessionHeaders = await session.headers(); } catch { authenticated = false; }
const headers = { ...sessionHeaders, apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY };
const regions = ['auto', ...new Set((env.COOKBOOK_BENCHMARK_REGIONS ?? '').split(',').map(region => region.trim()).filter(Boolean))];
const measurements = [];
for (const region of regions) for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    const response = await fetch(project + '/functions/v1/cookbook/' + (authenticated ? 'state' : '.well-known/oauth-protected-resource'), { headers: { ...headers, ...(region === 'auto' ? {} : { 'x-region': region }) }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const ttfb = performance.now() - start, payload = await response.text();
    measurements.push({ path: authenticated ? 'edge-state' : 'public-discovery', region, sample: sample + 1, status: response.status, ttfbMs: Math.round(ttfb), totalMs: Math.round(performance.now() - start), responseBytes: Buffer.byteLength(payload), servingRegion: response.headers.get('x-sb-edge-region'), serverTiming: response.headers.get('server-timing') });
}
for (let sample = 0; authenticated && sample < 3; sample++) {
    const start = performance.now();
    const response = await fetch(project + '/rest/v1/rpc/read_cookbook', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const payload = await response.text();
    measurements.push({ path: 'direct-read', sample: sample + 1, status: response.status, totalMs: Math.round(performance.now() - start), responseBytes: Buffer.byteLength(payload) });
    if (response.status === 404) break; // The migration has not been deployed yet.
}
const report = { measuredAt: new Date().toISOString(), projectHost: new URL(project).host, authenticated, ...(!authenticated ? { skipped: 'Authenticated request timing requires an existing local CookBook CLI session.' } : {}), measurements };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
