# Clareza architecture — deployable demonstration slice

## Outcome

Clareza is a standard Next.js App Router application deployed through Vercel. React provides the responsive client experience, Vercel Functions execute the server-only finance API, and Supabase PostgreSQL stores the demonstration financial state. Money is represented as integer minor units and financial calculations remain independent of React and the database adapter.

## Runtime boundaries

1. The Next.js page sends only display-safe demonstration identity values to the client.
2. The client reads and writes state through `/api/finance`; database and banking secrets remain server-only.
3. The finance route validates actions, scopes every operation to the demonstration workspace, and records audit events.
4. The server-only Supabase client uses the service role. It is a deliberate demonstration bootstrap, not the final user-authenticated access pattern.
5. PostgreSQL constraints, indexes, foreign keys, integer-cent fields, and RLS policies establish the first persistence boundary.
6. `BankDataProvider` isolates the application from an AISP. Only `MockBankDataProvider`, which returns fictitious data, is active.
7. Pure functions in `lib/finance/calculations.ts` calculate balances, cash flow, savings, savings rate, pending values, category totals, and net worth.

## Critical flows

### Initial state

The first API request creates the fixed demonstration workspace and idempotently seeds its fictitious accounts, transactions, budgets, goals, and mock connection. When Supabase is not configured, the API returns an actionable 503 response and the browser uses its explicitly labelled, non-persistent fallback dataset.

### Manual account

The client converts a validated Portuguese decimal input to integer cents. The API validates safe integers, inserts the account within the fixed demonstration workspace, and writes an audit event.

### Mock bank connection

The user selects a fictitious institution. The provider contract returns accounts and transactions. Stable provider transaction identifiers and a unique database constraint make repeated imports idempotent.

### Category correction

The API updates the selected transaction only inside the workspace and records the correction. A production schema must preserve original provider data and user overlays separately.

### Financial summary

Only booked, non-internal transactions enter income and consumption totals. Pending values remain separate. Net worth equals assets minus liabilities at the reference time.

## Current data model

- `workspaces` and `workspace_members`: ownership and access boundary.
- `accounts`: manual, imported, or synchronised financial accounts.
- `transactions`: booked or pending entries with stable provider identifiers.
- `budgets`: category limit per workspace and month.
- `goals`: target, progress, date, and priority.
- `bank_connections`: non-secret provider and consent lifecycle metadata.
- `audit_events`: server-side mutation history.

The production model must add consent/token envelopes, balance snapshots, splits, merchants, tags, rules, recurring items, debts, investments, documents, notifications, imports, synchronisation jobs, and immutable audit detail.

## Security posture

- Supabase and provider access are server-only.
- No password, complete IBAN, provider token, or document is present in client state or application logs.
- Financial values use integer cents in application and database storage.
- The PWA service worker does not cache finance API responses.
- RLS policies exist for authenticated workspace members, but the current API uses a fixed demonstration workspace and service role.
- Public authentication, MFA, user-scoped API access, independent RLS testing, token encryption, penetration testing, and legal review remain production prerequisites.
