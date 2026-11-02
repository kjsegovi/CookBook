#!/usr/bin/env node
// CookBook MCP shim — a stdio MCP server that owns a Supabase session so any MCP
// client can reach the CookBook edge function without hand-managed tokens.
//
// Why this exists: the edge function is gated on `Authorization: Bearer <user
// access token>` plus `x-household-id` (supabase/functions/_shared/api.ts), and
// access tokens expire in about an hour — so a static header in a client config
// works for an hour and then 401s. This keeps the long-lived refresh token in the
// macOS Keychain, mints access tokens on demand, writes rotated refresh tokens
// back, and forwards newline-delimited JSON-RPC straight through. The upstream
// already speaks MCP (protocol 2026-07-28), so there is no protocol translation.
//
// One-time setup:
//   security add-generic-password -U -s cookbook-mcp -a refresh-token -w
//   (paste the refresh_token from the signed-in app's localStorage at the prompt)
//
// Register (already done for the `cookbook` server):
//   hermes mcp add cookbook --command node \
//     --env COOKBOOK_ANON_KEY=<publishable key> \
//     --args /path/to/scripts/cookbook-mcp.mjs
//
// Env: COOKBOOK_ANON_KEY (required), COOKBOOK_PROJECT_URL, COOKBOOK_HOUSEHOLD,
//      COOKBOOK_KEYCHAIN_SERVICE/_ACCOUNT, COOKBOOK_TOKEN_FILE (tests), COOKBOOK_LOG.
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { createSession } from './cookbook-session.mjs';

const MCP_URL = (process.env.COOKBOOK_PROJECT_URL ?? 'https://xnnomwmfjibtbgitnwcl.supabase.co').replace(/\/+$/, '') + '/functions/v1/cookbook/mcp';

function log(message) {
    if (!process.env.COOKBOOK_LOG) return;
    try { writeFileSync(process.env.COOKBOOK_LOG, `[${new Date().toISOString()}] ${message}\n`, { flag: 'a' }); } catch { /* never break the proxy over logging */ }
}

const session = createSession({ log });

async function forwardOnce(message, headers) {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify(message),
        cache: 'no-store',
    });
    if (response.status === 204) return { status: 204, body: null };
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: response.status, body, text };
}

async function forward(message) {
    let headers = await session.headers();
    let result = await forwardOnce(message, headers);
    if (result.status === 401) {
        log('upstream 401; re-minting a token and retrying once');
        session.invalidate();
        headers = await session.headers();
        result = await forwardOnce(message, headers);
    }
    if (result.body === null && result.status !== 204) {
        const id = message && !Array.isArray(message) ? message.id ?? null : null;
        return { jsonrpc: '2.0', id, error: { code: -32603, message: 'CookBook returned HTTP ' + result.status + (result.text ? ': ' + result.text.slice(0, 200) : '') } };
    }
    return result.body;
}

function emit(value) {
    if (value === null || value === undefined) return;   // a notification gets no response line
    process.stdout.write(JSON.stringify(value) + '\n');
}

if (!process.env.COOKBOOK_ANON_KEY) log('COOKBOOK_ANON_KEY is empty; GoTrue will reject refreshes');

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
lines.on('line', line => {
    const text = line.trim();
    if (!text) return;
    let message;
    try { message = JSON.parse(text); }
    catch { emit({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    // Serialized: a rotating refresh token must never be used by two calls at once.
    queue = queue.then(async () => {
        try { emit(await forward(message)); }
        catch (error) { emit({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32000, message: String(error?.message ?? error) } }); }
    });
});
lines.on('close', () => { queue.finally(() => process.exit(0)); });
