import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The synthetic UI fixture also serves the native apps' contract test; native clients send no Origin header.
const script = fileURLToPath(new URL('./fixtures/preview-backend.mjs', import.meta.url));

async function startFixture() {
    const child = spawn(process.execPath, [script], { env: { ...process.env, COOKBOOK_FIXTURE_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const base = await new Promise((resolve, reject) => {
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
        child.on('exit', code => reject(new Error('Fixture exited with ' + code)));
    });
    return { base, stop: () => child.kill() };
}

test('the preview fixture accepts native requests without an Origin and still refuses other websites', async () => {
    const { base, stop } = await startFixture();
    try {
        const native = await fetch(base + '/functions/v1/cookbook/state');
        assert.equal(native.status, 401, 'no Origin and no token: sign in, not forbidden');
        const foreign = await fetch(base + '/functions/v1/cookbook/state', { headers: { origin: 'https://other.example.test' } });
        assert.equal(foreign.status, 403);
        const site = await fetch(base + '/auth/v1/token?grant_type=password', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'qa@example.test', password: 'local-qa-password' }),
        });
        assert.equal(site.status, 200, 'native sign-in works without an Origin');
    } finally { stop(); }
});
