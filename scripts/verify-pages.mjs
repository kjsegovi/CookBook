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
for (const file of files.filter(file => /\.(html|css|js)$/.test(file))) {
    const text = await readFile(file,'utf8');
    assert.ok(!text.includes('SUPABASE_SERVICE_ROLE_KEY'), 'The service-role credential must stay server-side.');
    assert.ok(!text.includes('kjsegovichat.chatgpt.site'), 'No runtime should depend on GPT Sites.');
    assert.ok(!text.includes('sb_publishable_local_test_only'), 'Remove the browser-test configuration before delivery.');
    if (file.endsWith('.html')) assert.ok(!/(?:src|href)="\/(?!\/)/.test(text), 'Use relative assets for GitHub project pages.');
    if (file.endsWith('.css')) assert.ok(!/url\(["']?\/fonts\//.test(text), 'Font paths must support a project subdirectory.');
}
console.log('GitHub Pages artifact checked: relative assets, no server runtime, no backups, no Sites dependencies.');
