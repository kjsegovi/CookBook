# CookBook: publishable MCP + OAuth discovery (slices A–C)

Goal: let an MCP client **publish** recipes (not only draft them), and let MCP clients
discover an OAuth authorization server instead of needing a hand-copied bearer token.

Repo: `/Users/kjsegovi/Projects/CookBook`. The repo root is the live app. **Never** edit
`cookbook-app/` (ignored archive). **Never** `git commit` or `git push` — Kevin stages and
commits. Do not touch `.env`, `.env.local`, or any credential file.

Read these first: `supabase/functions/_shared/api.ts`, `_shared/mcp.ts`, `_shared/domain.ts`,
`_shared/http.ts`, `tests/api.test.mjs`, `tests/fixtures/backend.mjs`.

Context: the edge function is the MCP server (protocol `2026-07-28`, already implemented in
`_shared/mcp.ts`). Today every request needs `Authorization: Bearer <supabase user access
token>` **and** `x-household-id`. Two gaps: MCP cannot publish a recipe, and a standards-based
MCP client cannot discover how to authenticate (RFC 9728 protected resource metadata).

---

## Slice A — `save_recipe` MCP tool (publish)

In `_shared/mcp.ts`:

- Add a tool named `save_recipe`. Description: publish a complete recipe to the household
  library (creates or updates), and say plainly that pantry, planning and shopping are not
  touched.
- Input: `{ recipe: { title, description, servings, prepMinutes, cookMinutes, category,
  tags[], image, sourceUrl, author, ingredients[{name,amount,unit,group,note,raw}], steps[],
  notes }, operationId: string, revision?: integer }`. Mark `recipe` and `operationId` required.
- Handler: `const saved = await command('recipe.save', a.recipe, a.operationId, a.revision)`.
  Return the published record found in the saved state plus `revision`, so the caller can read
  back what actually landed:
  `{ revision, recipe: <the record>, message: 'Recipe saved to the household library.' }`
- Errors must flow through the existing `DomainError` path — a recipe missing a title,
  ingredients or steps must come back as `isError` with the domain's own sentence, not be
  silently coerced (`normalizeRecipe` already enforces this; do not pass `allowIncomplete`).
- Leave `save_recipe_draft` exactly as it is (it is review-only by design).
- `annotations`: `readOnlyHint: false`, `destructiveHint: false`.

## Slice B — OAuth 2.0 protected resource metadata (RFC 9728)

New file `_shared/oauth.ts` exporting:

- `protectedResource(request)` → the metadata object. Derive the origin from the request URL
  (`new URL(request.url).origin`); do not hardcode the project ref.
  ```json
  {
    "resource": "<origin>/functions/v1/cookbook",
    "authorization_servers": ["<origin>/auth/v1"],
    "scopes_supported": ["cookbook"],
    "bearer_methods_supported": ["header"],
    "resource_name": "CookBook kitchen",
    "resource_documentation": "<origin>/functions/v1/cookbook"
  }
  ```
- `challenge(request, scope = 'cookbook')` → the `WWW-Authenticate` header value:
  `Bearer resource_metadata="<origin>/functions/v1/cookbook/.well-known/oauth-protected-resource", scope="cookbook"`

In `_shared/api.ts`:

- Serve `GET .well-known/oauth-protected-resource` (i.e. the path inside the function's route
  match) **before** the auth checks, unauthenticated, with CORS headers applied. No token needed.
- Every `401` response the function returns must carry the `challenge(...)` header. The current
  code builds 401s from thrown `DomainError`s in the `catch` at the bottom — add the header
  there when `status === 401`, and also on the explicit "no token" path. Do not weaken any
  existing status code or message.

## Slice C — resolve the household when a client cannot send `x-household-id`

OAuth clients will not know a household UUID. In `_shared/api.ts`, when the
`x-household-id` header is absent:

- Resolve the membership with `admin.from('household_members').select('household_id')
  .eq('user_id', user.id)` and use the single row. If there is no row, keep failing with a
  clear 403 ("You do not have access to any household.").
- If more than one row comes back, fail with a 403 telling the caller to send
  `x-household-id` rather than guessing.
- A header that **is** present keeps the current strict behaviour: must be a UUID and the
  caller must be a member (the existing `maybeSingle` check).
- Apply the resolution for the `mcp` path only. The browser app always sends the header, and
  its behaviour and every existing status code must not change.

---

## Tests (they must fail before the change and pass after)

Extend `tests/fixtures/backend.mjs` minimally: it already accepts `household: ''` to omit the
header and already mocks `household_members`. Give the mock the ability to return zero, one or
several memberships so the multi-household case is testable.

Add tests to `tests/api.test.mjs`:

1. `save_recipe` publishes: seeded empty household → `tools/call save_recipe` → 200, the recipe
   is in the returned state and in `f.row.state.recipes`, revision bumped by 1.
2. `save_recipe` rejects an incomplete recipe: recipe with a title but no steps → `isError`
   true, message is the domain sentence, and `f.row.state.recipes` stays empty.
3. `save_recipe` is duplicate-safe: same `operationId` twice → one recipe.
4. Protected resource metadata: `GET .well-known/oauth-protected-resource` with **no**
   Authorization header → 200, `resource` ends `/functions/v1/cookbook`, `authorization_servers`
   is `[<origin>/auth/v1]`, `scopes_supported` includes `cookbook`.
5. A 401 carries the challenge: `POST mcp` with no token → 401 and `WWW-Authenticate` matches
   `/^Bearer resource_metadata=".+\/\.well-known\/oauth-protected-resource", scope="cookbook"$/`.
6. MCP without `x-household-id`: single membership → publishes successfully.
   Zero memberships → 403/401 with a clear message and **no** household queries beyond the
   membership lookup. Several memberships → 403 asking for `x-household-id`.
7. Regression: with a header present, the existing 403 for a non-member household still holds,
   and the browser `state` path still returns 403 when the header is missing.

## Verification gates (run all, report real output)

```sh
npm test
npm run check
npm run build
```

`npm run test:database` is not needed — no SQL is touched.

## Out of scope

- The consent UI, Supabase dashboard settings and client registration are a later slice; do not
  add routes to `src/`.
- Do not change the protocol version, tool list ordering, or anything about `save_recipe_draft`.
- No new npm dependencies.
