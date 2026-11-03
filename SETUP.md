# CookBook setup guide

Set up one shared personal cookbook, run it locally, and publish with GitHub Pages. Run commands from this project folder.

## Upgrade the existing cookbook

1. Export the current cookbook privately and keep its Storage files. Recheck the live record counts and confirm public self-service sign-up is disabled before applying the migration; provision the intended logins through Supabase administration.
2. Apply `20261103000000_shared_cookbook.sql` through the migration runner. Its explicit transaction locks the original document while copying records, retains the existing revision and photo namespace, and makes the original household documents read-only archives. Requests from old functions/tabs cannot silently write to an archived document after the copy.
3. Deploy the updated `cookbook` Edge Function, then publish this website. Complete these as one release; old tabs can temporarily fail during the transition and should reload after publication.
4. Verify two confirmed accounts open the same recipes, pantry, plan, shopping, and settings. Check a persisted edit, sign-out, a private old/new photo, cooking/purchases, and Reminders preparation. Existing account sign-ins remain separate; the cookbook data is shared.

If multiple populated cookbooks exist, the migration stops before choosing one. Review private exports and explicitly select the intended source with the migration's `cookbook.migrate_household` transaction setting. Other original documents remain archived; their contents are not merged automatically. A fresh installation creates the one empty cookbook without an account-specific setup screen.

Prefer rolling forward after the new release accepts writes. The retained archives are the pre-migration state, not a current rollback copy. Export the current normalized cookbook before considering any rollback. Publishing only the website is insufficient for this release.

## 1. Create the Supabase backend

Create a Supabase project in your own account. Keep its database password and secret keys private. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then run from this directory:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase secrets set ALLOWED_ORIGINS=https://YOUR_USERNAME.github.io,http://localhost:5173,http://127.0.0.1:5173
npx supabase functions deploy cookbook
```

`db push` applies both migrations in `supabase/migrations/`. Use a new project for initial setup, or follow the upgrade steps above for the existing CookBook. Do not apply it to an unrelated existing application database. For a manual SQL-editor installation, execute each complete migration in its own explicit transaction, then deploy the Edge Function with the CLI.

`ALLOWED_ORIGINS` contains origins, without a path or trailing slash. For a custom domain, add its exact HTTPS origin to this list. The function denies browser requests from other origins. Edge requests verify the signed-in user through Supabase Auth. Direct database reads and small flag saves check the confirmed account, active session, and account status inside the database. Anonymous requests and raw browser writes are denied. The gateway's legacy JWT switch in `config.toml` does not replace these checks.

The hosted function receives `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase's server environment. **Never put the service-role key in GitHub Pages, a `VITE_` variable, browser code, or an MCP client.**

## 2. Configure email sign-in

In Supabase Authentication settings:

- Enable email/password authentication and email confirmation.
- Disable public self-service sign-up ("Allow new users to sign up"). Add logins through Supabase administration so this personal cookbook is limited to the accounts you provide.
- Set the minimum password length to 12 or more characters.
- Set the Site URL to `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`.
- Add that same URL and `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/?auth=recovery` to the redirect allowlist.
- For local development, also allow `http://localhost:5173/`, `http://localhost:5173/?auth=recovery`, `http://127.0.0.1:5173/`, and `http://127.0.0.1:5173/?auth=recovery`.
- Configure an email provider for confirmation and password reset delivery before adding another login. Test delivery to an address outside the project's team. Supabase's default email service has restrictions; see [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Create and confirm accounts through Supabase Authentication administration. The website includes sign-in, password reset requests, password recovery, session refresh, and sign-out. Every confirmed account in this dedicated Supabase project opens the same cookbook; no per-account kitchen or invitation is required. Passwords are handled by Supabase Auth. The app does not implement its own password database or a cosmetic browser-only login gate.

## 3. Run locally

Use Node 22.13+ (Node 24 is used in deployment). Copy `.env.example` to `.env.local`, then supply your project URL and **publishable key** from Supabase's project settings. A legacy `anon` key also works. Both values are public browser configuration; a private `sb_secret_` or service-role key is rejected by the build check.

```sh
npm ci
npm run dev
```

Without configuration, the app shows the login screen and explains that sign-in is not connected yet. It never pretends a successful login. Synthetic test records are never seeded into a real project.

## 4. Publish with GitHub Pages

Push this directory as the root of your GitHub repository. In the repository settings:

1. Under **Settings → Secrets and variables → Actions → Variables**, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` with the public values from step 3. Optionally add `SUPABASE_FUNCTION_REGION` after comparing live request timings against automatic routing; leave it empty otherwise.
2. Under **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Push to `main`, or run **Deploy CookBook to GitHub Pages** from the Actions tab.

The workflow installs locked dependencies, validates configuration, runs regression tests, builds, checks the artifact, and uploads **only `dist/`**. It does not publish the database, source archive, or household backup. Relative asset paths and hash routes support repository subdirectories and custom domains without a rewrite server: a recipe link looks like `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/#/recipes/RECIPE_ID`.

GitHub Pages serves the public app files; household records and uploaded images are kept in Supabase behind authorization. See [GitHub's workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## 5. Open or restore the shared cookbook

Sign in with any confirmed account. The existing cookbook opens directly. Other accounts see the same records and edits, with no create/join/invitation step.

For an empty installation, open **Kitchen settings → Restore a backup** and choose a private CookBook export. Restore validates records and references and refuses to overwrite any existing records. Operation receipts and external Reminders connections are reset on restore. Exports contain photo references rather than the image files themselves; preserve private Storage files separately when migrating between projects.

## Two-way grocery sync with Apple Reminders

Open **Shopping → Keep groceries in sync**. Expand **Install or update the two-way Shortcut**, download **CookBook Groceries**, and open the `.shortcut` file in Apple Shortcuts on your iPhone or Mac. Replace the old one-way Shortcut if you installed it already; keep the exact name `CookBook Groceries`.

Enter the exact, unique name of your existing regular grocery list. Tap **Sync groceries**, then **Open Shortcuts to sync**. Apple may ask you to allow Reminders access and requests to your CookBook backend. When Shortcuts finishes, it opens CookBook again. The website shows **Synced** only after the Shortcut confirms its Reminders updates. Long lists instead offer **Copy grocery sync → Open Shortcuts to sync** so the browser does not have to open an oversized link.

### What syncs

Checkmarks travel both ways for linked CookBook groceries, including unchecking a previously completed item. A CookBook checkmark changed since the last confirmed sync takes priority; otherwise the current Reminders checkmark comes back. CookBook supplies titles, quantities, and notes. If a grocery's amount or content changes while a run is open, that row is skipped so an old completion does not hide a new need; sync again to use its new amount. Pantry purchases still require the existing **Add purchases to pantry** confirmation, and already-purchased groceries cannot be reopened by Reminders.

Only reminders carrying a CookBook marker are linked. Keep that marker in the notes so future runs can recognize the item. Editing a linked reminder's title or notes is temporary: the next sync replaces them from CookBook. Unfinished reminders made by the old Shortcut are adopted automatically; completed old reminders are left as history. Manually created Reminders items are not imported or edited. Deleting a CookBook grocery does not delete its reminder. A new generated shopping week or a new purchase row gets a new link, keeping past completed reminders separate.

This connection runs when you tap it; there is no continuous background sync. A run that stops after sending checkmarks but before updating Reminders is shown as still finishing. Starting a fresh run repairs pending writes using the last confirmed baseline. The Shortcut refuses duplicate markers and displays API errors instead of claiming success.

### Connection and privacy

The website starts each run while you are signed in. The server returns an HMAC-signed scope containing only that run's groceries, cookbook/account identity, baseline checkmarks, and a 15-minute expiration. The Shortcut posts observations to `/reminders/finish`, receives the resolved checkmarks, updates Reminders, then posts `/reminders/ack`. It never receives a login token, password, or service credential. Deleting or disabling an account revokes its outstanding scopes. Retries cannot reapply an older run or submit different observations under a completed run.

The existing server-only service credential derives the dedicated signing key; no new secrets are needed. The shared-cookbook migration stores its receipts with cookbook metadata. Deploy the updated `cookbook` Edge Function before publishing the website. Browser-only deployment cannot enable the return path. Sync baselines and the latest receipt are stored with shared cookbook metadata, capped at 20 connections and 250 groceries per run; restored backups reset external connections. The website remembers the list name and a pending run identifier, not a reusable integration credential. Clipboard handoffs contain grocery data and that short-lived scope until the clipboard is replaced.

### Rebuild the installable Shortcut

The maintained workflow is `scripts/reminders-shortcut.mjs`. The public signed download is `public/shortcuts/CookBook Groceries.shortcut`; it contains only generic workflow instructions. Rebuild and sign on a Mac after changing it:

```sh
npm run build:reminders
plutil -convert binary1 'outputs/CookBook Groceries.unsigned.shortcut'
shortcuts sign --mode anyone --input 'outputs/CookBook Groceries.unsigned.shortcut' --output 'public/shortcuts/CookBook Groceries.shortcut'
```

Apple receives the generic workflow for signing. The `anyone` mode does not attach your contact information. Unsigned files remain under ignored `outputs/`. Tests execute the serialized read/merge/write/ack workflow against synthetic reminders and the actual API handler, including conflict and retry behavior. Installation, Apple permission prompts, live list-name resolution, and iCloud delivery still need an iPhone acceptance check. Apple documents [Shortcut URL handoffs](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios) and [API requests from Shortcuts](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios).

## Connect an MCP client

In the Supabase dashboard, open **Authentication → OAuth Server** and enable the **OAuth 2.1 server**. Set the **Authorization Path** to `/oauth/consent` (the Site URL from step 2 supplies the repository base). Register a **public client** with redirect URI `http://127.0.0.1:8765/callback`, then use its client ID in your MCP client's OAuth configuration. The consent screen lets users sign in and approve and open the one shared cookbook.

For Hermes, pin `oauth.redirect_port` to `8765` so its callback matches the registered redirect URI, and configure the registered public client ID. Run `hermes mcp add cookbook --url <mcp url> --auth oauth`, then `hermes mcp test cookbook`, using the endpoint in the [project README](README.md#mcp-outside-gpt-sites). Finish sign-in and consent in the browser, then follow the return link to deliver the OAuth callback; no copied secret is needed.

For verification commands, see the [project README](README.md#validation).
