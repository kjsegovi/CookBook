import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
const files = [];
async function walk(dir) { for (const name of await readdir(dir)) { const file = path.join(dir,name); if ((await stat(file)).isDirectory()) await walk(file); else files.push(file); } }
await walk('dist');
assert.ok(files.includes('dist/index.html'));
assert.ok(files.includes('dist/.nojekyll'));
assert.ok(files.includes('dist/shortcuts/CookBook Groceries.shortcut'), 'Include the installable Reminders Shortcut.');
assert.equal((await readFile('dist/shortcuts/CookBook Groceries.shortcut')).subarray(0, 4).toString(), 'AEA1', 'The distributed Shortcut must be signed by Apple.');
assert.ok(!files.some(file => /(?:\.env|\.openai|backups|household.*\.json|server\/|\.map$)/.test(file)), 'Private or server files must not enter the Pages artifact.');
// Installable app shell: manifest, icons and service worker, all on relative paths.
const manifestFile = 'dist/manifest.webmanifest';
assert.ok(files.includes(manifestFile), 'Ship a web app manifest.');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
assert.equal(manifest.start_url, './', 'The manifest must start inside the project subdirectory.');
assert.equal(manifest.scope, './', 'The manifest scope must be the project subdirectory.');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.share_target?.action?.startsWith('./'), 'The share target must stay inside the app scope.');
const pngSize = async file => { const png = await readFile(file); return [png.readUInt32BE(16), png.readUInt32BE(20)]; };
for (const [size, purpose] of [[192, 'any'], [512, 'any'], [512, 'maskable']]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.purpose === purpose);
    assert.ok(icon, `Declare a ${size}px ${purpose} icon.`);
    assert.ok(!/^(?:\/|[a-z]+:)/i.test(icon.src), `Icon ${icon.src} must use a relative path.`);
    assert.ok(files.includes(path.join('dist', icon.src)), `Icon ${icon.src} must be in the artifact.`);
    assert.deepEqual(await pngSize(path.join('dist', icon.src)), [size, size], `Icon ${icon.src} must be ${size}px.`);
}
assert.deepEqual(await pngSize('dist/icons/apple-touch-icon.png'), [180, 180], 'Include a 180px apple-touch-icon.');
const indexHtml = await readFile('dist/index.html', 'utf8');
assert.ok(indexHtml.includes('<link rel="manifest" href="./manifest.webmanifest">'), 'Link the manifest relatively.');
assert.ok(indexHtml.includes('href="./icons/apple-touch-icon.png"'), 'Link the apple-touch-icon relatively.');
assert.ok(indexHtml.includes('viewport-fit=cover'), 'Let the installed app use the full screen.');
assert.ok(files.includes('dist/sw.js'), 'Ship the app-shell service worker.');
const worker = await readFile('dist/sw.js', 'utf8');
assert.ok(!/url:"\//.test(worker), 'Precached URLs must be relative to the worker.');
assert.ok(worker.includes('createHandlerBoundToURL("index.html")'), 'Serve the app shell for offline navigations.');
assert.ok(worker.includes('oauth\\/consent'), 'The OAuth consent path must bypass the navigation fallback.');
assert.ok(!/supabase/i.test(worker), 'The service worker must never cache Supabase responses.');
for (const precached of worker.matchAll(/url:"([^"]+)"/g)) assert.ok(files.includes(path.join('dist', precached[1])), `Precached ${precached[1]} must exist.`);

for (const file of files.filter(file => /\.(html|css|js)$/.test(file))) {
    const text = await readFile(file,'utf8');
    assert.ok(!text.includes('SUPABASE_SERVICE_ROLE_KEY'), 'The service-role credential must stay server-side.');
    assert.ok(!text.includes('kjsegovichat.chatgpt.site'), 'No runtime should depend on GPT Sites.');
    assert.ok(!text.includes('sb_publishable_local_test_only'), 'Remove the browser-test configuration before delivery.');
    if (file.endsWith('.html')) assert.ok(!/(?:src|href)="\/(?!\/)/.test(text), 'Use relative assets for GitHub project pages.');
    if (file.endsWith('.css')) assert.ok(!/url\(["']?\/fonts\//.test(text), 'Font paths must support a project subdirectory.');
}
console.log('GitHub Pages artifact checked: relative assets, installable app shell, no server runtime, no backups, no Sites dependencies.');
