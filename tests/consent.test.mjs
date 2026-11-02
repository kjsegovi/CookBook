import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { consentRequest } from '../src/lib/consent.ts';

test('consent request under a project base preserves the authorization id', () => {
    assert.deepEqual(consentRequest('/CookBook/oauth/consent?authorization_id=abc', '/CookBook/'), { isConsent: true, authorizationId: 'abc' });
});
test('consent request accepts a trailing slash', () => {
    assert.deepEqual(consentRequest('/CookBook/oauth/consent/?authorization_id=abc', '/CookBook/'), { isConsent: true, authorizationId: 'abc' });
});
test('consent request requires the authorization_id parameter', () => {
    assert.deepEqual(consentRequest('/oauth/consent?id=abc', '/'), { isConsent: true, authorizationId: null });
});
test('home and recipe paths are not consent requests', () => {
    for (const path of ['/CookBook/', '/CookBook/recipes', '/CookBook/recipes/oauth/consent/index.html']) assert.deepEqual(consentRequest(path, '/CookBook/'), { isConsent: false, authorizationId: null });
});
test('consent request works at the root base', () => {
    assert.deepEqual(consentRequest('/oauth/consent?authorization_id=x', '/'), { isConsent: true, authorizationId: 'x' });
});
test('consent request ignores the base resolved relative to the dev consent URL', () => {
    assert.deepEqual(consentRequest('/oauth/consent?authorization_id=x', '/oauth/'), { isConsent: true, authorizationId: 'x' });
});
test('consent request ignores the base resolved relative to the Pages consent URL', () => {
    assert.deepEqual(consentRequest('/CookBook/oauth/consent?authorization_id=x', '/CookBook/oauth/'), { isConsent: true, authorizationId: 'x' });
});
test('consent request tolerates only one trailing slash regardless of base', () => {
    assert.deepEqual(consentRequest('/CookBook/oauth/consent/?authorization_id=x', '/CookBook/oauth/'), { isConsent: true, authorizationId: 'x' });
    assert.deepEqual(consentRequest('/CookBook/oauth/consent//?authorization_id=x', '/CookBook/oauth/'), { isConsent: false, authorizationId: null });
});

test('Pages fallback restores consent path and query with assets at the app base', async () => {
    const script = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
    const fallback = await script('../public/404.html'), restore = await script('../index.html');
    for (const base of ['/', '/CookBook/']) for (const slash of ['', '/']) {
        const original = base + 'oauth/consent' + slash + '?authorization_id=a%2Bb&extra=a%26b#keep';
        let destination, restored, assetBase;
        const location = new URL(original, 'https://example.test');
        location.replace = value => { destination = new URL(value, location); };
        runInNewContext(fallback, { location });
        assert.equal(destination.pathname, base + 'index.html');
        runInNewContext(restore, {
            location: destination, URLSearchParams,
            document: { createElement: () => ({}), head: { append: element => { assetBase = element.href; } } },
            history: { replaceState: (_state, _title, path) => { restored = path; } },
        });
        assert.equal(restored, original);
        assert.equal(new URL('./assets/app.js', assetBase).pathname, base + 'assets/app.js');
        assert.deepEqual(consentRequest(restored, base), { isConsent: true, authorizationId: 'a+b' });
    }
});
