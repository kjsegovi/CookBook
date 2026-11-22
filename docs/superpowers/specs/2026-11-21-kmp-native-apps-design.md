# CookBook native apps (Kotlin Multiplatform) — design

Status: draft for approval · 2026-11-21

## Intent and why

CookBook today is a web app (React, GitHub Pages) on Supabase. The Mac app (Tauri) and the planned iPhone app (Capacitor) both wrap that web build. The owner wants **native infrastructure instead of relying on the web app**: real Android and iOS apps written in Kotlin, sharing one codebase, talking to the same Supabase backend.

Version 1 is **full parity** with the website: everything the website does today, the phones do too, before the first release.

## Goals

- Native Android and iOS apps from one Kotlin Multiplatform (KMP) codebase: a shared Kotlin core plus shared Compose Multiplatform screens.
- Full feature parity with the website (inventory below).
- Full offline editing, as on the website: the cookbook lives on the device, changes apply immediately, and an outbox syncs in order when online, with the same conflict choices.
- The same Supabase backend and data. Phones, website and Mac app edit one shared cookbook at the same time.

## Non-goals (v1)

- Replacing the website. It stays as it is, and keeps hosting the MCP OAuth consent page.
- A native desktop app. The Tauri Mac app stays; Compose Desktop can replace it later from the same code.
- Changing the backend's behaviour. The apps use the existing API (small additive server changes only if the builder finds a hard need, and they must not change website behaviour).
- App-store release. v1 runs as debug and simulator builds; signing and store setup come after.

## Anti-goals (a failure even if it "works")

- **Rule drift.** Recipe and sync rules now exist twice: TypeScript on the server and website, Kotlin in the apps. If the two disagree, offline edits get rejected or applied differently. Every command must give identical results in both languages, enforced by tests.
- **Data loss.** An app must never silently drop a queued change, a photo, or fields it doesn't know about. An older app saving a recipe must not strip fields a newer server or website added.
- **Weaker offline than the website.** The apps must open, browse and edit with no connection.

## Constraints from the existing system

- **Backend API** (see `supabase/functions/_shared/api.ts`; the website's calls in `src/lib/api.ts`):
  - Supabase Auth: email and password; sign-up is disabled.
  - PostgREST RPCs: `read_cookbook(known_revision)`, `read_cookbook_changes(since)`, and `set_cookbook_flag(...)` (the fast path for checkmarks and favourites).
  - Edge Function `cookbook/*` with a bearer token: `command` (`{type, payload, id, revision, response: 'delta'}`), `import`, `photos` (upload, with optional `?id=`), `photos/urls`, `export`, `restore`, `reminders/begin` and `reminders/status`.
  - Native requests send no `Origin`, so the origin allowlist doesn't apply.
- **Data model.** The truth is the TypeScript types in `supabase/functions/_shared/domain.ts`: Recipe, IngredientLine, PantryItem, PlanEntry, PreparedBatch, ShoppingItem, ImportDraft, Menu, ingredients, movements, settings, reminders. Records are JSON; the server stores them per record (`cookbook_records`).
- **Commands.** Every change is a named command run by `applyCommand` (`_shared/commands.ts`). The full set is listed under "Shared core" below.
  - Ids a command creates derive from its operation id (`<operationId>-<n>`).
  - Commands take an optional clock, so a queued change replays with the time it was made.
  - Recipe `updatedAt` always moves forward.
  - Per-record conflict checks: `expectedUpdatedAt`, the `__expected` JSON snapshot, and cook `usage[].expected`.
- **Sync semantics** (the reference implementation is `src/lib/sync-engine.ts`): confirmed snapshot plus outbox replay, guard rewriting after each acknowledgement, checkmark coalescing, problems (409/4xx) with keep-mine, copy and discard, retry with backoff, and `uploadPendingPhotos` before commands.
- **Photos:** a private bucket, signed URLs that expire after 300 seconds, a WebP at 1,600 px plus a 480 px thumbnail, and a device-chosen id for offline uploads.
- Limits: 2,000 recipes, about 200 KB per record.

## Approaches considered

1. **Shared Kotlin core and shared Compose Multiplatform screens** — chosen. One codebase for both phones, native performance, offline parity, and a later path to desktop. On iOS it looks native-ish rather than pixel-perfect Apple style.
2. Shared Kotlin core with separate native screens (Jetpack Compose and SwiftUI): the most authentic look per platform, but about twice the interface work, and every feature lands twice.
3. Thin native clients with the logic on the server: much less to port, but offline editing mostly goes away.

The owner picked 1, with full parity for v1.

## Design

### Repository layout (my call)

A new Gradle project in this repo at `native/`, so the server, website and apps change together in one pull request:

```
native/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml, gradlew
  shared/        KMP library: domain, commands, sync, storage, API (commonMain + androidMain + iosMain)
  composeApp/    Compose Multiplatform UI (commonMain screens, theme, navigation)
  androidApp/    Android application module (MainActivity, manifest, intents)
  iosApp/        Xcode project hosting the Compose UI; Swift share extension
```

### Technology (my calls; the builder picks exact current stable versions)

- **Language and UI:** Kotlin 2.x, Compose Multiplatform, and Navigation for Compose Multiplatform.
- **Data:** kotlinx.serialization (JSON), kotlinx.coroutines, kotlinx-datetime.
- **Network and auth:** Ktor client (OkHttp on Android, Darwin on iOS) for the Edge Function; supabase-kt Auth for the session (sign-in, token refresh, password reset email); PostgREST RPC through supabase-kt or Ktor.
- **Local storage:** SQLDelight. Photo bytes live in files.
- **Images:** Coil 3 (multiplatform).
- **Minimum versions:** Android API 26, iOS 17.
- **Identifiers:** application id and bundle id `app.cookbook.mobile`, and the `cookbook://` scheme. The native app **replaces the planned Capacitor iPhone app** (my call: the owner wants native rather than web-based apps). v1 therefore removes `capacitor.config.json`, the `@capacitor/*` packages, the Capacitor-only code in `src/lib/native.ts` and the iPhone section of SETUP.md. The Tauri Mac app stays.

### Shared core (`shared`)

1. **Records stay JSON.** Records are held as `JsonObject` exactly as the server returns them. Screens read them through typed views. Commands start from the stored object and change only the fields they touch, so fields the app doesn't know about survive a save (this is the guard against data loss).
2. **Port `applyCommand` to Kotlin, every command:** recipe.save, recipe.update, recipe.delete, recipe.favorite, recipe.rate, recipes.import, draft.save, draft.delete, pantry.save, pantry.delete, ingredient.save, plan.save, plan.move, plan.delete, cook, leftover.eat, batch.update, shopping.generate, shopping.save, shopping.toggle, shopping.delete, shopping.purchase, menu.save, menu.delete, menu.plan, settings.save.
   - This includes the helpers they rely on: normalizeRecipe, parseIngredient, units and conversion, availability and requirements, generatedShopping and aisles, autoLeftovers, statePatch and applyStatePatch.
   - `reminders.sync` and `reminders.ack` run only on the server and are not ported.
   - **Unknown fields vs. identical results (my call):** Kotlin commands keep fields they don't know about, while the TypeScript `normalizeRecipe` drops them. The golden vectors therefore compare only the fields the domain types define. The website and server stay unchanged. The trade-off is accepted: a field added later on the server survives edits made from the apps, but not edits made from the website's editor, which is today's behaviour.
3. **Golden test vectors (the guard against rule drift).**
   - A Node script (`scripts/export-command-vectors.mjs`) runs scripted command sequences through the TypeScript `applyCommand`, with fixed operation ids and clocks. It writes the inputs, the outputs (or the error message and status) and the state patches to `native/shared/src/commonTest/resources/vectors/*.json`.
   - Kotlin tests replay every vector and compare the results key-order-independently.
   - CI (my call): a new pull-request workflow, `.github/workflows/native.yml`, on a Linux runner. It runs the vector export, the Kotlin JVM and Android tests, and an Android build. It doesn't block the website's Pages deploy. iOS compilation runs in the same workflow on a macOS runner only when files under `native/` change. Drift is caught at pull-request review time. Server deploys stay manual, so the release checklist adds "vectors green" before `functions deploy`.
   - Vectors cover every command, its error paths, and every conflict check.
4. **Sync engine.** A Kotlin port of `src/lib/sync-engine.ts`, with the same behaviours (the list under Constraints above).
   - The outbox, problems, confirmed snapshot and pending photo uploads persist in SQLDelight.
   - Draining happens when the app comes to the foreground, when connectivity returns, and on a backoff timer.
   - Sync never runs in the background while the app is closed in v1 (my call: simpler, and it matches the website).
5. **Reading the cookbook:** `read_cookbook_changes(since)` when there is a saved snapshot, otherwise `read_cookbook`. Deltas are applied with `applyStatePatch`.
6. **Photos.**
   - Upload: resize to a 1,600 px WebP plus a 480 px thumbnail (platform code), choose the id up front, cache locally, and upload with `?id=`.
   - Display: batched `photos/urls` (up to 24 references a call) for signed URLs, with the bytes kept in a disk cache keyed by the stable `photo:` reference, so photos show offline.
7. **Paprika import:** a zip reader plus gzip, ported from `src/lib/paprika.ts`. Decompression is platform code (zlib on iOS, `java.util.zip` on Android).

### Screens (`composeApp`) — parity inventory

Each item matches what the website does today.

- **Sign in:** sign in, forgot password (the reset link opens the hosted website), sign out with an unsynced-changes warning, and opening offline as the last signed-in user.
- **Home:** recently added, drafts banner, categories, this week's meals, leftovers.
- **Library:**
  - search
  - filters: nested category, collection, tags, time, pantry-ready, minimum rating
  - sort: recent, A–Z, rating, time
  - 24-at-a-time paging
- **Recipe detail:**
  - stars, category chips, photo strip, scaling
  - cooking view, which keeps the screen awake (my call: a small native improvement over the website)
  - crossing off ingredients and steps
  - pantry status, nutrition, related recipes, cooking history
  - mark as cooked (pantry usage and leftover portions), favourite
  - print (Android PrintManager, iOS print controller), delete
- **Recipe editor:**
  - all fields, ingredients and paste-parse, steps, notes
  - several categories, rating, up to 12 photos (camera or library), photo link
  - related recipes, nutrition
- **Import:**
  - a link (server `import` route)
  - shared links: Android share target; on iOS, a Swift share extension that opens `cookbook://import?url=…`
  - drafts review
  - offline links saved as a draft
- **Meal plan:** week view and month view, drag and tap-to-move (`plan.move`), add, edit, delete, cook, eat leftovers.
- **Menus:** list, create and edit, add to the plan.
- **Pantry:** items, locations, aliases, and the stock-change log.
- **Shopping:**
  - generate from the plan, sorted by aisle in your order
  - manual items, quantity overrides
  - checkmarks (fast path), add purchases to the pantry
  - Reminders sync on iOS, through the same Shortcut handoff as the website, returning by `cookbook://`
- **Settings:**
  - servings, week start, auto-leftovers, categories, aisle order
  - Paprika import
  - export backup (share sheet), restore backup (file picker)
- **Sync status and conflicts:** the offline and syncing banner, and the keep-mine, copy and keep-theirs card.

**Design language:** match the website — its palette (green `#35664b`, paper `#faf9f5`), fonts (bundled from `public/fonts`), photo-led cards, and a bottom tab bar (Home, Recipes, Plan, Pantry, Shop), with Menus and Settings reachable from the header.

### Links and platform hooks

- `cookbook://` deep links on both platforms: Reminders return (`#/shopping?reminders-sync=…`) and `cookbook://import?url=…`.
- Android: `ACTION_SEND` text/plain intent filter. iOS: share extension target.
- Server: nothing is needed for these. The Reminders return already accepts `cookbook://`.

## Testing and verification

**Where testing writes data (decided by the owner):** a separate, free Supabase test project.
- It gets the same migrations and Edge Function as production, plus a synthetic cookbook (`[Sample]` recipes) and test accounts.
- The apps choose the project with a build setting: debug builds use the test project, and release builds use production.
- Production is used only for the final sign-off, and mostly read-only.
- The owner creates the project (it is an account action). The builder then links it, pushes the migrations, deploys the function and seeds it.
- The production cookbook is never written by tests.


- **Shared core:** golden vectors for every command, plus Kotlin ports of the sync-engine scenarios in `tests/sync-engine.test.mjs`, run against a fake server.
- **Contract:** a test run against a local or synthetic backend covering sign-in, read, delta, command, photo upload and conflict. `tests/fixtures/preview-backend.mjs` needs a small change first: it currently returns 403 to requests without an `Origin` header, which native requests never send.
- **Interface:** Compose UI tests for key flows, all running against the test project. Manual checks on the Android emulator (`Medium_Phone_API_37.0`) and the iOS simulator (iPhone 18 Pro, iOS 27.2).
- **Done for v1:**
  - every inventory item works on both platforms against the test project, and the app opens and syncs against production
  - the same edit made offline on a phone and online on the website resolves as it does between two browsers
  - CI is green for the TypeScript tests, the vector export and the Kotlin tests

## Left to the builder

- Exact library versions and Gradle setup; navigation structure; code layout inside the modules.
- Whether PostgREST calls go through supabase-kt or plain Ktor.
- The order features land in, provided the shared core and its vectors land first.
- Screen layouts within the design language above.
