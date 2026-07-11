# Clareza

Clareza is a responsive personal and family finance application for Portugal. This repository contains a deployable demonstration vertical slice built with standard Next.js App Router, Supabase PostgreSQL, and Vercel Functions.

The interface explicitly identifies fictitious demonstration data. The mock Open Banking provider never contacts a financial institution and the application never collects home-banking credentials.

## Included functionality

- Dashboard with booked, available, pending, asset, liability, cash-flow, and net-worth values kept separate.
- Supabase-backed accounts, transactions, categories, categorization rules, import jobs, budgets, goals, bank connection metadata, and audit events.
- Manual account and transaction creation, account detail views, and the option to exclude an account from financial totals.
- Labelled mock bank connection with idempotent transaction import behind `BankDataProvider`.
- Transaction search, account/category/status filters, sorting, CSV import/export, and persisted category corrections stored separately from source data.
- Configurable, prioritized categorization rules that respect user corrections and apply to existing and newly imported transactions.
- CSV column mapping, Portuguese and ISO dates, decimal validation, partial-error reporting, and idempotent duplicate detection.
- Budget and goal flows, forecasting assumptions, report printing, and demonstration reset.
- Responsive PWA shell, light/dark themes, keyboard focus, reduced-motion support, accessible chart labels, and tabular alternatives.
- Integer minor-unit money storage and deterministic financial calculation tests.

## Technology

- Next.js 16 and React 19
- TypeScript in strict mode
- Supabase PostgreSQL through a server-only service client
- Tailwind CSS 4
- Node.js built-in test runner
- Vercel deployment configuration

## Local development

Requirements: Node.js 22.13 or newer, npm, and a Supabase project.

1. Install dependencies and create the local environment file:

   ```bash
   npm install
   cp .env.example .env.local
   ```

2. In Supabase, run every file in `supabase/migrations/` in filename order using the SQL editor. If the Supabase CLI is linked to the project, `supabase db push` is the preferred equivalent.

3. Fill at least these server variables in `.env.local`:

   ```text
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
   ```

4. Start the application:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000`. Without the two Supabase server variables, the UI still renders the explicitly labelled in-browser demonstration dataset, but API-backed changes are intentionally unavailable.

## Validation

```bash
npm run lint
npm run verify
```

`verify` performs the strict TypeScript check, unit/configuration tests, and a production Next.js build.

## CSV import

Open **Movimentos → Importar CSV**, choose an existing account, and map the file columns. Data, description, and amount are mandatory. The importer accepts semicolon, comma, or tab delimiters; quoted fields; `DD/MM/YYYY` or `YYYY-MM-DD` dates; and Portuguese or dot-decimal amounts.

Each accepted row receives a SHA-256 fingerprint derived from account, date, amount, and normalized description. Re-importing the same file therefore reports duplicates instead of inserting them again. Invalid rows are reported separately and do not prevent valid rows from being imported.

## Environment variables

Copy `.env.example` to `.env.local`. Never commit `.env.local` or expose `SUPABASE_SERVICE_ROLE_KEY` through a `NEXT_PUBLIC_` variable.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are reserved for the future authenticated browser client. The current demonstration API uses only the server-side URL and service-role key.

## Open Banking boundary

`lib/banking/provider.ts` defines the provider-agnostic contract and the active demonstration implementation. A real launch requires a licensed Account Information Service Provider, callback and webhook verification, encrypted tokens, consent lifecycle handling, and independent legal and security review.

## Deploying to Vercel

See [VERCEL_DEPLOY.md](VERCEL_DEPLOY.md) for the exact import, environment, migration, deployment, and smoke-test sequence.

## Architecture and limitations

See [docs/architecture.md](docs/architecture.md) for system boundaries and [docs/production-readiness.md](docs/production-readiness.md) for the explicit gap between this deployable demonstration and a production financial service.
