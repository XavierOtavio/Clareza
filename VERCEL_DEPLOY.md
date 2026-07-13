# Deploying Clareza to Vercel

The repository uses the standard Next.js lifecycle and no longer depends on Cloudflare Workers, Vinext, D1, Vite, or Wrangler. Vercel can build it directly. Supabase is the persistent PostgreSQL service used by the finance API.

## 1. Create and migrate Supabase

Use separate Supabase projects for preview and production when real data is introduced.

Run all SQL files in `supabase/migrations/` in filename order in the Supabase SQL editor. The current order is:

1. `202607100001_clareza_foundation.sql`
2. `202607110001_financial_core.sql`
3. `202607130001_open_banking.sql`

Alternatively, link the Supabase CLI and run:

```bash
supabase db push
```

The migration creates the demonstration financial schema, indexes, workspace membership boundary, and Row Level Security policies. The current API deliberately uses the server service role for a fixed demonstration workspace; public multi-user authentication is not implemented yet.

## 2. Import the GitHub repository

1. In Vercel, select **Add New → Project**.
2. Import `XavierOtavio/Clareza` and select the Vercel-ready branch or merge its pull request first.
3. Keep **Framework Preset** set to **Next.js**.
4. Leave the build command as `npm run build` and the output directory on the Next.js default.
5. Use Node.js 22 in Project Settings if Vercel does not infer it from `package.json`.

## 3. Configure environment variables

Add the following values in **Project Settings → Environment Variables**. Apply them independently to Preview and Production as appropriate.

```text
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
NEXT_PUBLIC_DEMO_USER_NAME=Tiago
NEXT_PUBLIC_DEMO_USER_EMAIL=modo@demonstracao.pt
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-server-only-secret-key
BANK_DATA_PROVIDER=mock
CRON_SECRET=generate-a-long-random-value
```

For the real provider API with fictitious Sandbox Finance data, use:

```text
BANK_DATA_PROVIDER=gocardless
BANK_DATA_ENVIRONMENT=sandbox
BANK_DATA_ACCESS_VALID_DAYS=90
BANK_DATA_HISTORY_DAYS=90
GOCARDLESS_BANK_ACCOUNT_DATA_SECRET_ID=your-sandbox-secret-id
GOCARDLESS_BANK_ACCOUNT_DATA_SECRET_KEY=your-sandbox-secret-key
```

Never use a `NEXT_PUBLIC_` prefix for the Supabase service-role key or banking secrets.

`NEXT_PUBLIC_APP_URL` must be the exact HTTPS origin that receives `/api/banking/callback`. Each Vercel preview has a different origin, so either configure a stable protected preview domain or set separate credentials/origins per environment. Vercel invokes `/api/banking/sync` every six hours and supplies `CRON_SECRET` as a bearer token.

## 4. Deploy and smoke-test

Deploy from Vercel, then verify:

- `/` loads with the **Demonstração** label;
- `/api/finance` returns HTTP 200 after Supabase is configured;
- a manual account persists after a refresh;
- manual accounts and movements persist, and hidden accounts leave the dashboard totals;
- category corrections persist without changing normalized transaction fields;
- rules apply according to priority and do not overwrite user corrections;
- a CSV import reports imported, duplicate, and invalid rows separately;
- category, budget, and goal changes persist;
- the mock bank connection imports data without duplicate provider transactions;
- with GoCardless sandbox enabled, Sandbox Finance redirects back successfully, writes a consent and sync job, and can be manually synchronised, renewed, and revoked;
- CSV export and report printing work;
- the PWA manifest and service worker load;
- no service-role or provider secret appears in browser responses or logs.

If `/api/finance` returns HTTP 503, confirm that both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are present in the selected Vercel environment and redeploy.

## 5. Custom domain and deployment protection

Attach the custom domain only after the preview smoke tests pass. For demonstrations containing any non-public data, enable Vercel deployment protection and restrict the Supabase project. The current build is not suitable for real personal or bank data.

## Required work before production use

- Supabase Auth with MFA or passkeys and server-side workspace resolution;
- user-scoped data access plus tested RLS isolation;
- contracted AISP coverage and supplier/regulatory validation for the production provider mode;
- distributed rate limiting, signed webhooks if supported, and an encrypted token envelope if a future provider requires persistent user tokens;
- data export, erasure, retention, backup recovery, monitoring, and incident procedures;
- Playwright journeys, security assessment, accessibility audit, and legal review.
