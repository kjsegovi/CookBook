# CookBook

One personal cookbook shared by every confirmed login: recipes, pantry, meal plans, leftovers, shopping, and settings all belong to the same collection. The static React website runs on **GitHub Pages**. **Supabase** supplies email/password sign-in, private records/photos, imports, and MCP access.

Work from this directory (`CookBook`), the repository root. The ignored `cookbook-app/` directory and private `backups/` directory retain previous source/data archives and never enter the website build.

## Updating an existing installation

The shared-cookbook performance release needs its database migration, updated `cookbook` Edge Function, and website together. Follow [the upgrade steps](SETUP.md#upgrade-the-existing-cookbook) before publishing. The migration copies the existing cookbook into individual records, retains its identity and revision, and preserves the original household documents as read-only archives. It refuses to choose silently between multiple populated collections.

## Setup

Follow the [setup guide](SETUP.md) to configure Supabase, run the app locally, publish with GitHub Pages, and restore your saved recipe.

## Behavior retained

Recipes include ingredients, instructions, source attribution, photos, personal notes, categories, tags, favorites, and want-to-try status. Recipe-page and YouTube imports create reviewable drafts; inaccessible sources leave explicit warnings instead of guessed ingredients. Only confirmed cooking deducts pantry ingredients. Batch cooking reserves leftovers without counting the ingredients again: cooking more than you eat schedules the extra portions as leftover meals on the following days, one meal per usual serving (up to four days ahead, skipping days already planned), and those auto-planned meals shrink or disappear if you later reduce the batch. Settings can turn this off. Shopping accounts for stock, quantity uncertainty, manual rows, and explicit overrides. Export includes the complete cookbook document and photo references; image files remain in private Storage.

Updates use a conditional database revision so concurrent edits cannot silently overwrite each other. Stable operation IDs make retries duplicate-safe. Open recipe and inventory forms check the records they were opened from. Records are stored separately, while the existing 1.7 MB complete-state validation bound is retained.

Shopping checkmarks respond immediately and save in the background. Rapid taps keep the latest choice; purchases and Reminders sync wait for confirmed saves. Failed saves show an error and restore the confirmed list. Checkmarks and favorites use a single authenticated database operation; other edits retain server-side domain validation and return only changed records.

Opening the app can show a confirmed saved snapshot while checking its revision. Cached data is scoped to the project and signed-in account, expires after 24 hours, and is cleared on sign-out. Signed photo lookups are batched and start near the viewport. New uploads get a resized recipe image and a smaller WebP card preview; older photos use their original image. Optional screens load on demand, pantry calculations are reused, and large recipe libraries render 24 cards at a time with search across the entire collection.

## MCP outside GPT Sites

The standalone server is included at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/cookbook/mcp
```

Connect using OAuth: the client discovers Supabase's authorization server through the protected resource metadata at `https://YOUR_PROJECT_REF.supabase.co/functions/v1/cookbook/.well-known/oauth-protected-resource`. Sign in to CookBook in the browser, review the client, redirect host, and requested scopes, then approve or deny the request. Use **Return to the client** on the confirmation screen to complete the callback. The client needs no copied secret or pasted access token; it manages OAuth tokens and refresh. See [Connect an MCP client](SETUP.md#connect-an-mcp-client) for registration steps.

For Hermes, replace `<mcp url>` with the endpoint above:

```sh
hermes mcp add cookbook --url <mcp url> --auth oauth
hermes mcp test cookbook
```

The server retains recipe search/read, pantry, plan, leftovers, availability, imports, and direct `update_recipe` edits. **`save_recipe` publishes to the recipe library; `save_recipe_draft` is review-only.** The same confirmed-login, shared-cookbook, and revision checks apply. The service-role key must never go to a client. The old Sites plugin no longer connects to this server.

## Validation

Shopping’s **Sync groceries** button exchanges checkmarks with an existing Apple Reminders list using the bundled **CookBook Groceries** Shortcut. It updates linked quantities and preserves unrelated reminders. Sync is user-triggered, confirms both sides before reporting success, and keeps pantry purchases separate. Deploy the updated Edge Function as well as the website. See [two-way Reminders setup](SETUP.md#two-way-grocery-sync-with-apple-reminders).

```sh
npm test
npm run check
npm run build
npm run verify:pages
npm run test:database
```

The database check requires Docker and uses a disposable PostgreSQL 17 container with no exposed ports. It verifies actual PostgreSQL grants, row policies, security-definer functions, and invitation handling against small local Auth/Storage schema fixtures. API tests use an in-memory adapter to exercise membership rejection, conflicts, duplicate retries, backup restore, photo isolation, and MCP edits. These checks do not substitute for testing real Supabase sign-up, email delivery, Storage, and Edge deployment after project setup.

Database checks exercise both migration and fresh installation, data preservation, the shared login gate, revoked/expired sessions, disabled accounts, raw-write denial, single-record writes, and conflicts/retries. API and domain tests cover recipe editing, cooking/leftovers, pantry purchases, imports, backups, MCP, and serialized Reminders sync. Browser checks use two synthetic accounts with the actual Supabase browser client under `/CookBook/`, including slow saves/refreshes, shared edits, large-library search/pagination, optimized uploads, cache reopening, and phone layout. Synthetic fixtures never enter `dist/`.

For optional live timing, run `COOKBOOK_BENCHMARK_REGIONS=us-east-1 node scripts/benchmark-api.mjs outputs/performance/live-timing.json`. Authenticated measurements reuse an existing local CookBook CLI session; otherwise the script measures only the public gateway and reports the skipped checks. Never paste credentials into source files. Edge responses expose `Server-Timing` for Auth, database reads/writes, and total processing. Keep automatic regional routing until measurements justify the optional `SUPABASE_FUNCTION_REGION` repository variable.
