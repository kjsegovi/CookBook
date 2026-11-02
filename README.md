# CookBook

A household recipe library, pantry, meal planner, leftovers tracker, and shopping list. The website is a static React app built for **GitHub Pages**. **Supabase** supplies email/password login, the private household database, recipe imports, private photos, and the MCP endpoint. There is no GPT Sites runtime or ChatGPT sign-in in this version.

Work from this directory (`CookBook`), which is the GitHub repository root. The previous `cookbook-app/` directory is retained as an ignored archive with its source history. It is not part of the new app or deployment.

## Before launching

The new Supabase project still needs to be created and configured. No cloud project, GitHub repository, commit, push, or GitHub Pages deployment was created for this migration.

The old GPT-hosted app now returns an offline response (HTTP 410), including its API and MCP routes. Its private project record and stored data have been retained. Its MCP capability was removed. The original household export is saved privately at `backups/cookbook-household-2026-11-01.json`; it contains the saved chicken-and-gnocchi soup recipe. The backup and archived checkout are excluded from Git and from the Pages artifact. Do not move household exports into `public/`.

## Setup

Follow the [setup guide](SETUP.md) to configure Supabase, run the app locally, publish with GitHub Pages, and restore your saved recipe.

## Behavior retained

Recipes include ingredients, instructions, source attribution, photos, personal notes, categories, tags, favorites, and want-to-try status. Recipe-page and YouTube imports create reviewable drafts; inaccessible sources leave explicit warnings instead of guessed ingredients. Only confirmed cooking deducts pantry ingredients. Batch cooking reserves leftovers without counting the ingredients again. Shopping accounts for stock, quantity uncertainty, manual rows, and explicit overrides. Export includes the complete household document.

Updates use a conditional database revision so concurrent edits cannot silently overwrite each other. Stable operation IDs make cooking and other retries duplicate-safe. Open recipe and inventory forms also check the record they were opened from. The document is bounded to about 1.7 MB; migrate to normalized tables before increasing this limit.

## MCP outside GPT Sites

The standalone server is included at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/cookbook/mcp
```

It retains recipe search/read, pantry, plan, leftovers, availability, import drafts, draft saving, and direct `update_recipe` edits. Calls require a **Supabase user access token** as `Authorization: Bearer …` plus the user's `x-household-id` header. The same membership and revision checks apply. Tokens expire, so a client must manage its own Supabase session refresh. The old Sites plugin no longer connects to this server. Interactive OAuth setup for a new Codex/ChatGPT connector is a separate integration step; this rewrite does not claim that the old plugin works automatically or expose a permanent secret to replace it.

## Validation

```sh
npm test
npm run check
npm run build
npm run verify:pages
npm run test:database
```

The database check requires Docker and uses a disposable PostgreSQL 17 container with no exposed ports. It verifies actual PostgreSQL grants, row policies, security-definer functions, and invitation handling against small local Auth/Storage schema fixtures. API tests use an in-memory adapter to exercise membership rejection, conflicts, duplicate retries, backup restore, photo isolation, and MCP edits. These checks do not substitute for testing real Supabase sign-up, email delivery, Storage, and Edge deployment after project setup.

The migration checkpoint passed 32 Node regression tests, TypeScript, the production build, artifact checks, and actual PostgreSQL access-control tests. Browser checks used a local synthetic backend with the real Supabase browser client, served under `/CookBook/`; desktop and 390px navigation, sign-in/sign-out, a persisted recipe edit, page reload, and phone overflow checks passed. This fixture is not a cloud Auth or email-delivery test. The preserved production export also passed restore validation locally. The unconfigured release build contains no fixture URL or key.
