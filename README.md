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

## Project Structure

```text
expense-manager-web/
|-- src/app/                 Angular UI and client-side data layer
|-- src/environments/        Supabase environment config
|-- supabase/schema.sql      Postgres schema + RLS policies
|-- firebase.json            Firebase Hosting config
|-- .firebaserc.example      Firebase project id template
```

## Supabase Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase/schema.sql`.
3. Open `src/environments/environment.ts` and set:

```ts
export const environment = {
  production: false,
  supabase: {
    url: 'https://YOUR_PROJECT.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY'
  }
};
```

4. In Supabase Auth, enable email sign-in and magic links.
5. Add these redirect URLs in Supabase Auth:
   - `http://localhost:4200`
   - your Firebase Hosting domain

## Local Development

From `expense-manager-web/`:

```bash
npm install
npm start
```

The app runs at `http://localhost:4200`.

## Firebase Hosting

`firebase.json` is already configured for Angular's build output at `dist/expense-manager-web/browser`.

1. Set your Firebase project id in `.firebaserc`.
   Use `.firebaserc.example` as the starting template.
2. Build the app:

```bash
npm run build:firebase
```

3. Deploy Hosting:

```bash
npm run deploy:hosting
```

## Data Model

The Supabase schema includes:

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
