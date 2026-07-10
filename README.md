# Clareza

Clareza is a responsive personal and family finance application for Portugal. This repository contains the first functional vertical slice: a persistent financial workspace, manual and sandbox-synchronised accounts, transactions, budgets, goals, reports, PWA metadata, deterministic money calculations, and an auditable mock Open Banking boundary.

The interface is intentionally explicit about demonstration data. No bank credentials are collected, and the current connector never contacts a real financial institution.

## What works

- Responsive dashboard with booked, available, pending, asset, liability, cash-flow, and net-worth values kept separate.
- Durable D1-backed accounts, transactions, budgets, goals, connections, and audit events.
- Manual account creation and account detail views.
- Sandbox bank connection and idempotent transaction import through `BankDataProvider`.
- Transaction search, filters, CSV export, and persisted category corrections.
- Budget creation/update, goal creation, forecasting assumptions, report printing, and demo reset.
- Light/dark themes, keyboard focus, reduced-motion support, mobile navigation, accessible chart labels, and tabular chart alternatives.
- Integer minor-unit money storage and pure calculation tests.

## Local development

Requirements: Node.js 22.13 or newer, npm, and a Linux environment supported by the included Sites scripts.

```bash
npm run install:ci
npm run dev
```

The local runtime provides a D1-compatible database binding. The finance endpoint creates the phase-one schema idempotently and seeds an entirely fictitious demonstration workspace when it is empty.

## Validation

```bash
npm run test:unit
npx tsc --noEmit
npm test
```

`npm test` builds and validates the deployable artifact before running the calculation and rendered-HTML tests.

## Database

The active phase-one schema is defined in `db/schema.ts`. Generate a migration after a schema change:

```bash
npm run db:generate
```

The checked-in migration under `drizzle/` must be reviewed before deployment. Financial values are stored as integer cents; every financial row is scoped to a workspace.

## Open Banking configuration

`lib/banking/provider.ts` defines the provider-agnostic contract and the demonstration provider. Phase 3 must add an implementation for a licensed Account Information Service Provider and configure the server-only environment values documented in `.env.example`.

The production connector must validate callback state, webhook signatures, redirect URLs, consent lifecycle, stable provider identifiers, pending-to-booked reconciliation, idempotency, rate limits, retries, and token encryption. It must never expose tokens or home-banking credentials to the browser.

## Architecture and limitations

See `docs/architecture.md` for the current system boundaries and `docs/production-readiness.md` for the explicit gap between this functional slice and a regulated production service.

## Vercel deployment

The recovered application targets the Cloudflare Workers runtime and D1. It cannot be deployed as a fully functional Vercel application without replacing that persistence adapter. Read `VERCEL_DEPLOY.md` before attempting a Vercel deployment; it explains the required Supabase/PostgreSQL migration and avoids publishing a build whose financial write operations silently fail.
