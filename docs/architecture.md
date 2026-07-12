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
8. The `lib/transactions` domain parses and normalizes CSV files, creates stable duplicate fingerprints, validates API actions with Zod, and evaluates categorization rules independently of React and Supabase.

## Critical flows

### Initial state

The first API request creates the fixed demonstration workspace and idempotently seeds its fictitious accounts, transactions, budgets, goals, and mock connection. When Supabase is not configured, the API returns an actionable 503 response and the browser uses its explicitly labelled, non-persistent fallback dataset.

### Manual account

The client converts a validated Portuguese decimal input to integer cents. The API validates safe integers, inserts the account within the fixed demonstration workspace, and writes an audit event.

An account may be hidden from totals without deleting it. The flag affects assets, liabilities, available balance, and net worth while preserving the account and its movements.

### Manual transaction

The user chooses an account, date, state, category, and amount. The shared schema rejects invalid identifiers, unsafe monetary integers, and invalid ISO dates. Internal transfers remain explicit and are excluded from consumption metrics.

### CSV import

The client reads the selected file only to propose a column mapping and preview three rows. The server repeats parsing and validation, records an `import_job`, normalizes valid rows, applies the highest-priority active rule, and inserts only unseen fingerprints. Invalid and duplicate rows are counted separately. The application does not treat an inferred transfer as confirmed.

### Categorization rules

Rules target either merchant or description and support contains, equality, and starts-with operators. Matching is case-insensitive and accent-insensitive. Re-evaluation uses explicit priority and never overwrites a transaction with a user-authored category overlay.

### Mock bank connection

The user selects a fictitious institution. The provider contract returns accounts and transactions. Stable provider transaction identifiers and a unique database constraint make repeated imports idempotent.

### Category correction

The API writes category corrections to `transaction_user_edits` rather than changing normalized source fields. The effective category is resolved when state is loaded, and every correction increments its version and creates an audit event.

### Financial summary

Only booked, non-internal transactions enter income and consumption totals. Pending values remain separate. Net worth equals assets minus liabilities at the reference time.

## Current data model

- `workspaces` and `workspace_members`: ownership and access boundary.
- `accounts`: manual, imported, or synchronised financial accounts.
- `transactions`: booked or pending entries with stable provider identifiers.
- `categories`: workspace-owned system and custom categories.
- `categorization_rules`: transparent prioritized matching rules.
- `transaction_user_edits`: versioned user overlays separated from normalized source data.
- `import_jobs`: source file metadata, mapping, status, and row outcome counts.
- `budgets`: category limit per workspace and month.
- `goals`: target, progress, date, and priority.
- `bank_connections`: non-secret provider and consent lifecycle metadata.
- `audit_events`: server-side mutation history.

The production model must add consent/token envelopes, balance snapshots, splits, normalized merchants, tags, recurring items, debts, investments, documents, notifications, synchronisation jobs, and immutable audit detail.

## Security posture

- Supabase and provider access are server-only.
- No password, complete IBAN, provider token, or document is present in client state or application logs.
- Financial values use integer cents in application and database storage.
- The PWA service worker does not cache finance API responses.
- RLS policies exist for authenticated workspace members, but the current API uses a fixed demonstration workspace and service role.
- Public authentication, MFA, user-scoped API access, independent RLS testing, token encryption, penetration testing, and legal review remain production prerequisites.
