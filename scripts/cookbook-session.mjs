// Shared CookBook session handling: the refresh token lives in the macOS Keychain,
// access tokens are minted on demand, and rotations are written back so the next
// call still works. Used by scripts/cookbook-mcp.mjs (stdio MCP shim) and any
// one-off tool that needs to call the edge function.
//
// Never prints or returns the refresh token; callers only get an access token and
// a household id.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export const DEFAULT_PROJECT = 'https://xnnomwmfjibtbgitnwcl.supabase.co';

export function jwtClaims(token) {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

export function createSession(options = {}) {
    const project = (options.project ?? process.env.COOKBOOK_PROJECT_URL ?? DEFAULT_PROJECT).replace(/\/+$/, '');
    const anonKey = options.anonKey ?? process.env.COOKBOOK_ANON_KEY ?? '';
    const service = options.service ?? process.env.COOKBOOK_KEYCHAIN_SERVICE ?? 'cookbook-mcp';
    const account = options.account ?? process.env.COOKBOOK_KEYCHAIN_ACCOUNT ?? 'refresh-token';
    const tokenFile = options.tokenFile ?? process.env.COOKBOOK_TOKEN_FILE ?? '';
    const log = options.log ?? (() => {});
    let pinnedHousehold = options.household ?? process.env.COOKBOOK_HOUSEHOLD ?? '';
    let accessToken = '', accessExpiry = 0, refreshToken = '', householdId = pinnedHousehold;

    function readRefreshToken() {
        if (tokenFile) {
            try { return readFileSync(tokenFile, 'utf8').trim() || ''; } catch { return ''; }
        }
        const result = spawnSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8' });
        return result.status === 0 ? result.stdout.trim() : '';
    }
    function writeRefreshToken(token) {
        if (tokenFile) { writeFileSync(tokenFile, token, { mode: 0o600 }); return; }
        const result = spawnSync('security', ['add-generic-password', '-U', '-s', service, '-a', account, '-w', token], { encoding: 'utf8' });
        if (result.status !== 0) log('keychain write failed: ' + String(result.stderr ?? '').trim());
    }

    async function refresh() {
        if (!refreshToken) {
            refreshToken = readRefreshToken();
            if (!refreshToken) throw new Error('No CookBook refresh token stored. Run: security add-generic-password -U -s ' + service + ' -a ' + account + ' -w');
        }
        if (!anonKey) throw new Error('COOKBOOK_ANON_KEY is empty; Supabase will reject the refresh.');
        const response = await fetch(project + '/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: anonKey },
            body: JSON.stringify({ refresh_token: refreshToken }),
            cache: 'no-store',
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.access_token) {
            throw new Error('CookBook session refresh failed (' + response.status + '): ' + (body.msg ?? body.error_description ?? body.message ?? 'unknown error'));
        }
        accessToken = body.access_token;
        const claims = jwtClaims(accessToken);
        accessExpiry = typeof claims.exp === 'number' ? claims.exp * 1000 : Date.now() + Number(body.expires_in ?? 3600) * 1000;
        if (body.refresh_token && body.refresh_token !== refreshToken) {
            refreshToken = body.refresh_token;
            writeRefreshToken(refreshToken);   // Supabase rotates on use; dropping the new one breaks the next session
            log('stored rotated refresh token');
        }
        return claims;
    }

    async function ensure() {
        if (accessToken && accessExpiry - Date.now() > 60000) return accessToken;
        const claims = await refresh();
        if (!householdId) {
            if (!claims.sub) throw new Error('The access token has no subject claim; cannot resolve a household.');
            const response = await fetch(project + '/rest/v1/household_members?select=household_id&user_id=eq.' + encodeURIComponent(claims.sub), {
                headers: { apikey: anonKey, Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
                cache: 'no-store',
            });
            if (!response.ok) throw new Error('CookBook household lookup failed (' + response.status + '). Set COOKBOOK_HOUSEHOLD explicitly.');
            const rows = await response.json();
            if (!Array.isArray(rows) || !rows.length) throw new Error('This account is not a member of any CookBook household.');
            householdId = rows[0].household_id;
            log('resolved household ' + householdId);
        }
        return accessToken;
    }

    return {
        project,
        get householdId() { return householdId; },
        ensure,
        // Force a re-mint (used after an upstream 401).
        invalidate() { accessToken = ''; },
        pin(household) { if (household) { householdId = household; pinnedHousehold = household; } },
        async headers() {
            await ensure();
            return { Authorization: 'Bearer ' + accessToken, 'x-household-id': householdId };
        },
    };
}
