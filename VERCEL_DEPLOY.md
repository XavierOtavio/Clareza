# Deploying Clareza on Vercel

## Important compatibility constraint

This recovered source is the exact functional Sites version. Its server runtime is Vinext on Cloudflare Workers and its persistent database is Cloudflare D1. The finance API imports the native `cloudflare:workers` runtime module and expects a `DB` binding. Vercel does not provide either capability.

Consequently, importing this repository into Vercel without a persistence migration is not a valid production deployment. The page may render, but `/api/finance` will not have a database and financial write operations will fail. Do not hide that failure by relying on the client demonstration fallback.

## Recommended Vercel target

Use the following target architecture:

- Standard Next.js App Router on Vercel;
- Supabase PostgreSQL for structured financial data;
- Supabase Auth for public authentication and MFA;
- Supabase Storage for private documents;
- Vercel Functions for API routes and bank callbacks;
- Vercel Cron or Supabase scheduled functions for synchronisation;
- a licensed AISP implementation behind the existing `BankDataProvider` contract.

## Required migration work

### 1. Create the Supabase project

Create separate development, preview, and production projects. Record the project URL, public anonymous key, and server-only service-role key in the relevant Vercel environment. Never expose the service-role key through a `NEXT_PUBLIC_` variable.

Suggested variables:

```text
NEXT_PUBLIC_APP_URL=https://your-domain.example
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BANK_DATA_PROVIDER=mock
BANK_DATA_CLIENT_ID=
BANK_DATA_CLIENT_SECRET=
BANK_DATA_WEBHOOK_SECRET=
BANK_TOKEN_ENCRYPTION_KEY=
```

### 2. Convert the current schema to PostgreSQL

The current phase-one schema is defined in `db/schema.ts` and `drizzle/0000_swift_maggott.sql`. Recreate the following tables in PostgreSQL:

- `workspaces`;
- `accounts`;
- `transactions`;
- `budgets`;
- `goals`;
- `bank_connections`;
- `audit_events`.

Preserve all primary keys, foreign keys, unique provider identifiers, workspace indexes, integer minor-unit money fields, and `ON DELETE CASCADE` relationships. Add `workspace_members` before enabling multiple users.

Apply Row Level Security to every workspace-owned table. A policy must allow access only when the authenticated user is a member of the row's workspace. Test cross-workspace reads, writes, updates, and deletes before using real data.

### 3. Replace the D1 adapter

Replace `db/index.ts` with server-only Supabase clients:

- a user-scoped client for normal reads and writes;
- a service-role client only for verified callbacks, background synchronisation, and narrowly defined administrative operations.

Do not scatter Supabase calls throughout React components. Keep persistence behind domain repositories so calculations and `BankDataProvider` remain independent of the database vendor.

Update `app/api/finance/route.ts` to use the PostgreSQL repositories instead of `getD1()`. Preserve server-side validation, workspace scoping, idempotent inserts, and audit events.

### 4. Return to the standard Next.js build

After the persistence adapter is migrated:

1. Remove the Cloudflare-specific Vite, Vinext, Worker, D1, and Wrangler build dependencies.
2. Remove `worker/`, `vite.config.ts`, `cloudflare-env.d.ts`, and the D1 binding from `.openai/hosting.json` only in the Vercel-specific branch.
3. Change the scripts to use the standard Next.js lifecycle:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test:unit": "node --experimental-strip-types --test tests/finance-calculations.test.ts"
  }
}
```

4. Run the type check, unit tests, and `npm run build` locally.

### 5. Import into Vercel

1. Push the migrated Vercel branch to a Git repository.
2. In Vercel, choose **Add New Project** and import that repository.
3. Keep **Framework Preset** set to Next.js.
4. Add the environment variables separately for Development, Preview, and Production.
5. Deploy and verify `/`, `/api/finance`, authentication, workspace isolation, CSV export, and every write flow.
6. Configure the bank provider callback and webhook URLs using the final HTTPS domain.

## Minimum verification before real financial data

- no D1 or `cloudflare:workers` imports remain in the Vercel build;
- every finance API request resolves an authenticated workspace server-side;
- RLS blocks access between workspaces;
- money remains integer minor units or PostgreSQL `numeric`, never floating point;
- bank tokens are encrypted and never returned to the browser;
- callback state and webhook signatures are verified;
- duplicate provider transactions are rejected idempotently;
- pending transactions reconcile with booked transactions;
- logs contain no tokens, complete IBANs, documents, or sensitive financial payloads;
- desktop and mobile end-to-end tests pass in the Vercel preview environment.

## Fast but limited alternative

For a visual-only demonstration, the frontend can be published after replacing `/api/finance` with a non-persistent mock route. That is not equivalent to this functional build and must be labelled as a demonstration. It must not be used for real accounts, consent tokens, or personal financial data.
