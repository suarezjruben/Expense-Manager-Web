# Expense Manager Web

`expense-manager-web` is a stripped-down branch of the original Expense Manager app.

This version keeps the Angular UI and monthly budgeting workflow, but removes:

- Spring Boot and all Java backend code
- Plaid integration
- OFX/QFX parsing

The app is designed to run as a browser-only client with:

- Angular 19
- Supabase Auth + Postgres
- Firebase Hosting
- CSV-only statement import in the browser

## Current Scope

- Dashboard with month summary and starting balance
- Transactions by month, type, and account
- Plans and category management
- CSV statement import with optional column mapping memory per account
- Supabase magic-link sign-in

## Public Repo Safety

This repository is intended to be safe for public GitHub hosting.

What is safe to expose in the browser:

- Supabase project URL
- Supabase `publishable` key, or legacy `anon` key
- Firebase Hosting site or project identifier
- Firebase web app config, if the Firebase client SDK is added later

What must never be committed or shipped to the browser:

- Supabase `service_role` key
- Supabase database password
- JWT signing secret
- Firebase service account JSON
- Google Cloud private keys
- Third-party admin tokens
- CI deploy tokens

Firebase Hosting can serve public runtime config to the browser, but it cannot keep browser-consumed values secret. If the app later needs real secrets, add a server-side component such as Firebase Cloud Functions, Cloud Run, or Firebase App Hosting with Secret Manager.

## Project Structure

```text
expense-manager-web/
|-- public/runtime-config.example.js   Example local runtime config
|-- src/app/                           Angular UI and client-side data layer
|-- src/environments/                  Placeholder-only Angular environment config
|-- supabase/schema.sql                Postgres schema + RLS policies
|-- firebase.json                      Firebase Hosting config
|-- .firebaserc.example                Firebase project id template
```

## Supabase Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase/schema.sql`.
3. In Supabase Auth, enable email sign-in and magic links.
4. In Supabase Settings > API, expose the `expense_manager` schema to the Data API.
5. Add these redirect URLs in Supabase Auth:
   - `http://localhost:4200`
   - your Firebase Hosting domain
   - any custom domain you actually use
6. Copy `public/runtime-config.example.js` to `public/runtime-config.js`.
7. Fill in your Supabase URL and either a `publishableKey` or legacy `anonKey`.

Example:

```js
window.__appConfig__ = {
  supabase: {
    url: 'https://YOUR_PROJECT.supabase.co',
    publishableKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
    schema: 'expense_manager'
  }
};
```

`public/runtime-config.js` is intentionally ignored by git.

## Local Development

From `expense-manager-web/`:

```bash
npm install
npm start
```

The app runs at `http://localhost:4200`.

## GitHub Actions Deploy

For a public GitHub repo, the recommended deploy path is to generate `public/runtime-config.js` during the GitHub Actions workflow instead of storing it locally in the repo.

Use a GitHub Actions environment named `production` and set:

Variables:

- `FIREBASE_PROJECT_ID`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- Optional fallback: `SUPABASE_ANON_KEY`
- Optional override: `SUPABASE_SCHEMA` (defaults to `expense_manager`)

Secrets:

- `FIREBASE_SERVICE_ACCOUNT`

The workflow at `.github/workflows/deploy-hosting.yml` will:

1. Read GitHub Actions variables and secrets
2. Generate `public/runtime-config.js` during CI
3. Build the Angular app
4. Deploy to the Firebase Hosting live channel

This keeps the repo clean on GitHub, but remember that browser runtime config is still public after deployment. Only browser-safe values belong in these variables.

## Firebase Hosting (Local Manual)

`firebase.json` is already configured for Angular's build output at `dist/expense-manager-web/browser`.

1. Copy `.firebaserc.example` to `.firebaserc`.
2. Set your Firebase project id in `.firebaserc`.
3. Build the app:

```bash
npm run build:firebase
```

4. Deploy Hosting:

```bash
npm run deploy:hosting
```

## GitHub Safety Checklist

Before making the repo public:

1. Keep `public/runtime-config.js` and `.firebaserc` untracked.
2. Never place a `service_role` key or any admin secret in Angular source files.
3. Store deploy-time values in GitHub Actions environment variables and secrets.
4. Enable GitHub secret scanning.
5. Enable GitHub push protection.
6. Keep Supabase RLS enabled for every app table.
7. Verify unauthenticated users cannot read or write app data.

The repo also includes a GitHub Actions gitleaks workflow to catch accidental secret commits, but it is a backup layer, not the primary protection.

## Data Model

The Supabase schema includes these tables under `expense_manager`:

- `accounts`
- `categories`
- `month_settings`
- `plans`
- `transactions`
- `csv_mappings`
- `import_batches`
- `import_issues`

All tables are user-scoped with row level security using `auth.uid()`.

## Notes

- Statement import is CSV only.
- CSV parsing and dedupe run in the browser.
- Summary calculations now run in the Angular client instead of a server endpoint.
- No Firebase client SDK is used in-app; Firebase is only used for Hosting in this project.
