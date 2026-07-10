# Deploying Clareza to Vercel

The repository uses the standard Next.js lifecycle and no longer depends on Cloudflare Workers, Vinext, D1, Vite, or Wrangler. Vercel can build it directly. Supabase is the persistent PostgreSQL service used by the finance API.

## 1. Create and migrate Supabase

Use separate Supabase projects for preview and production when real data is introduced.

Run `supabase/migrations/202607100001_clareza_foundation.sql` in the Supabase SQL editor. Alternatively, link the Supabase CLI and run:

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
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
BANK_DATA_PROVIDER=mock
```

The following variables are placeholders for later authentication and real Open Banking work:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
BANK_DATA_CLIENT_ID=
BANK_DATA_CLIENT_SECRET=
BANK_DATA_WEBHOOK_SECRET=
BANK_TOKEN_ENCRYPTION_KEY=
```

Never use a `NEXT_PUBLIC_` prefix for the Supabase service-role key or banking secrets.

## 4. Deploy and smoke-test

Deploy from Vercel, then verify:

- `/` loads with the **Demonstração** label;
- `/api/finance` returns HTTP 200 after Supabase is configured;
- a manual account persists after a refresh;
- category, budget, and goal changes persist;
- the mock bank connection imports data without duplicate provider transactions;
- CSV export and report printing work;
- the PWA manifest and service worker load;
- no service-role or provider secret appears in browser responses or logs.

If `/api/finance` returns HTTP 503, confirm that both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present in the selected Vercel environment and redeploy.

## 5. Custom domain and deployment protection

Attach the custom domain only after the preview smoke tests pass. For demonstrations containing any non-public data, enable Vercel deployment protection and restrict the Supabase project. The current build is not suitable for real personal or bank data.

## Required work before production use

- Supabase Auth with MFA or passkeys and server-side workspace resolution;
- user-scoped data access plus tested RLS isolation;
- a contracted licensed AISP implementation behind `BankDataProvider`;
- encrypted provider tokens, validated callback state and webhook signatures;
- pending-to-booked reconciliation, incremental synchronisation, retries, rate limits, and consent renewal;
- data export, erasure, retention, backup recovery, monitoring, and incident procedures;
- Playwright journeys, security assessment, accessibility audit, and legal review.
