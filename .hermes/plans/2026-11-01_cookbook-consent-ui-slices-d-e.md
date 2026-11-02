# CookBook: OAuth consent UI + MCP docs (slices D–E)

Continues `.hermes/plans/2026-11-01_cookbook-mcp-oauth-slices-a-c.md` (already implemented:
`save_recipe` MCP tool, RFC 9728 protected resource metadata, `WWW-Authenticate` challenge,
household resolution for the `mcp` path). Do not redo or alter that work.

Repo `/Users/kjsegovi/Projects/CookBook`. Repo root is the live app. **Never** edit
`cookbook-app/`. **Never** `git commit` / `git push`. Do not touch `.env`, `.env.local`, or
credential files. No new npm dependencies.

Background: Supabase is the OAuth 2.1 authorization server. When a client starts a flow,
Supabase redirects the browser to `<Site URL><Authorization Path>?authorization_id=…`. We will
configure the Authorization Path as `/oauth/consent`. That URL is a **real path**, while the app
routes on the hash, so the SPA must render consent before it touches hash routing.

`@supabase/supabase-js` 2.118.0 is installed and supports the methods you need:
`supabase.auth.oauth.getAuthorizationDetails(id)`, `.approveAuthorization(id)`,
`.denyAuthorization(id)`.

---

## Slice D — consent screen

1. `src/lib/consent.ts` — a small pure helper, exported for tests:
   - `consentRequest(pathname: string, base: string): { isConsent: boolean; authorizationId: string | null }`
     Recognises `<base>/oauth/consent` and `…/oauth/consent/`, tolerating a base path such as
     `/CookBook/` for GitHub project pages, and reads `authorization_id` from the query string.
     Keep it dependency-free and string-based so `node --test` can import the `.ts` directly.
2. `src/components/kitchen.tsx` (same terse inline style as the rest of the file; append matching
   one-rule CSS to `src/styles.css` using the existing `--green`, `--wash`, `--line`, `--muted`
   variables) — a consent view with three states:
   - **Missing id**: "This authorization link is incomplete" and a link home.
   - **Signed out**: reuse the existing sign-in form; after a successful sign-in, continue the
     consent request in place (do not lose `authorization_id`).
   - **Signed in**: call `getAuthorizationDetails`, then show the client name, the redirect host,
     and the requested scopes as a readable list. Two actions: **Approve** and **Deny**. Approve
     calls `approveAuthorization`, Deny calls `denyAuthorization`; afterwards show a short
     confirmation ("You can close this window and return to <client name>."). Errors render in
     the existing `alert error` pattern — one plain sentence saying what to do next.
   - Accessible: real headings, `aria-live` for the result, buttons not divs, scopes as a list.
3. `src/app.tsx` — before hash routing and before the household bootstrap, call
   `consentRequest(window.location.pathname, BASE_URL)`; if it is a consent request, render the
   consent view and skip household selection entirely. A signed-in user without a household must
   still be able to approve — consent must not require a household.
4. `vite.config.ts` / `index.html` / build: the GitHub Pages artifact needs a **404 fallback** so
   `/CookBook/oauth/consent` resolves. Add `public/404.html` that redirects to `index.html` while
   preserving the path and query (a small inline script using `location.replace`), with **no**
   absolute `src`/`href` attributes — `scripts/verify-pages.mjs` rejects those and must keep
   passing unchanged. Do not weaken that check.

## Slice E — documentation

- `README.md`: replace the "MCP outside GPT Sites" token-pasting guidance with the OAuth flow:
  discovery URL, that the client needs no copied secret, and the exact Hermes commands
  (`hermes mcp add cookbook --url <mcp url> --auth oauth`, then `hermes mcp test cookbook`).
  Keep the existing warning that the service-role key never goes to a client. State plainly that
  `save_recipe` publishes and `save_recipe_draft` is review-only.
- `SETUP.md`: a short "Connect an MCP client" section with the dashboard steps (enable OAuth 2.1
  server, Authorization Path `/oauth/consent`, register a public client with redirect
  `http://127.0.0.1:8765/callback`) and note that Hermes needs `oauth.redirect_port` pinned to
  match. One paragraph each; no screenshots.

## Tests

Add to `tests/` (a new `tests/consent.test.mjs` importing `../src/lib/consent.ts`):

1. `/CookBook/oauth/consent?authorization_id=abc` with base `/CookBook/` → consent, id `abc`.
2. Trailing slash variant → same.
3. `/oauth/consent?id=abc` (wrong param name) → consent true, id null.
4. `/CookBook/` and `/CookBook/recipes` → not consent.
5. A base of `/` still matches `/oauth/consent?authorization_id=x`.

## Verification gates (run and report real output)

```sh
npm test
npm run check
npm run build
npm run verify:pages
```

`npm run test:database` is not needed.

## Out of scope

- Do not enable anything in the Supabase dashboard, deploy the function, or register clients.
- Do not change the edge function or its tests again.
- No HouseHold invariants touched; do not modify `_shared/domain.ts`.
