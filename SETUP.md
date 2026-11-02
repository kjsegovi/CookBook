# CookBook setup guide

Set up Supabase login and shared data, run CookBook locally, publish with GitHub Pages, and restore your saved recipe. Run commands from this project folder.

## 1. Create the Supabase backend

Create a Supabase project in your own account. Keep its database password and secret keys private. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then run from this directory:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase secrets set ALLOWED_ORIGINS=https://YOUR_USERNAME.github.io,http://localhost:5173,http://127.0.0.1:5173
npx supabase functions deploy cookbook
```

`db push` applies the migration in `supabase/migrations/`. Use a new project for this initial migration. Do not apply it to an unrelated existing application database. Alternatively, the SQL file can be applied once through Supabase's SQL editor, but deploy the Edge Function with the CLI afterward.

`ALLOWED_ORIGINS` contains origins, without a path or trailing slash. For a custom domain, add its exact HTTPS origin to this list. The function denies browser requests from other origins. Every request also verifies the signed-in user through Supabase Auth and checks household membership; turning off the gateway's legacy JWT verification in `config.toml` does not remove these checks.

The hosted function receives `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase's server environment. **Never put the service-role key in GitHub Pages, a `VITE_` variable, browser code, or an MCP client.**

## 2. Configure email sign-in

In Supabase Authentication settings:

- Enable email/password authentication and email confirmation.
- Set the minimum password length to 12 or more characters.
- Set the Site URL to `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`.
- Add that same URL and `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/?auth=recovery` to the redirect allowlist.
- For local development, also allow `http://localhost:5173/`, `http://localhost:5173/?auth=recovery`, `http://127.0.0.1:5173/`, and `http://127.0.0.1:5173/?auth=recovery`.
- Configure an email provider for confirmation and password reset delivery before inviting the household. Test delivery to an address outside the project's team. Supabase's default email service has restrictions; see [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

The app includes sign-in, account creation with email confirmation, password reset requests, password recovery, session refresh, and sign-out. Passwords are handled by Supabase Auth. The app does not implement its own password database or a cosmetic browser-only login gate.

## 3. Run locally

Use Node 22.13+ (Node 24 is used in deployment). Copy `.env.example` to `.env.local`, then supply your project URL and **publishable key** from Supabase's project settings. A legacy `anon` key also works. Both values are public browser configuration; a private `sb_secret_` or service-role key is rejected by the build check.

```sh
npm ci
npm run dev
```

Without configuration, the app shows the login screen and explains that sign-in is not connected yet. It never pretends a successful login. There is no sample household seeded into a real project.

## 4. Publish with GitHub Pages

Push this directory as the root of your GitHub repository. In the repository settings:

1. Under **Settings → Secrets and variables → Actions → Variables**, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` with the public values from step 3.
2. Under **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Push to `main`, or run **Deploy CookBook to GitHub Pages** from the Actions tab.

The workflow installs locked dependencies, validates configuration, runs regression tests, builds, checks the artifact, and uploads **only `dist/`**. It does not publish the database, source archive, or household backup. Relative asset paths and hash routes support repository subdirectories and custom domains without a rewrite server: a recipe link looks like `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/#/recipes/RECIPE_ID`.

GitHub Pages serves the public app files; household records and uploaded images are kept in Supabase behind authorization. See [GitHub's workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## 5. Restore the saved recipe and invite your household

Create an account, confirm the email, sign in, and create your kitchen. Open **Kitchen settings → Restore a backup** and choose the private household export under `backups/`. Only the owner can restore, and the destination kitchen must be empty. Restore validates records and references; existing kitchen records are never overwritten. Old duplicate-operation receipts are reset because they belong to the retired deployment. The preserved export has no uploaded photos requiring a separate transfer; its recipe's external source image remains attributed to the source.

To share a kitchen, the owner creates an invitation code for a specific email in Kitchen settings. Share that code privately. The recipient creates and confirms an account with that exact email, then chooses **Join your household**. Codes expire after seven days, are stored as hashes, and can be used once. Creating another code for the same email replaces the previous code. No invitation email is sent automatically. Each account belongs to one household. Removing an existing member is currently an administrator operation in the Supabase database.

## Connect an MCP client

In the Supabase dashboard, open **Authentication → OAuth Server** and enable the **OAuth 2.1 server**. Set the **Authorization Path** to `/oauth/consent` (the Site URL from step 2 supplies the repository base). Register a **public client** with redirect URI `http://127.0.0.1:8765/callback`, then use its client ID in your MCP client's OAuth configuration. The consent screen lets users sign in and approve without first creating or joining a household.

For Hermes, pin `oauth.redirect_port` to `8765` so its callback matches the registered redirect URI, and configure the registered public client ID. Run `hermes mcp add cookbook --url <mcp url> --auth oauth`, then `hermes mcp test cookbook`, using the endpoint in the [project README](README.md#mcp-outside-gpt-sites). Finish sign-in and consent in the browser, then follow the return link to deliver the OAuth callback; no copied secret is needed.

For verification commands, see the [project README](README.md#validation).
