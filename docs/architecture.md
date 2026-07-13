# Clareza architecture — deployable demonstration slice

## Outcome

Clareza is a standard Next.js App Router application deployed through Vercel. React provides the responsive client experience, Vercel Functions execute the server-only finance API, and Supabase PostgreSQL stores the demonstration financial state. Money is represented as integer minor units and financial calculations remain independent of React and the database adapter.

## Runtime boundaries

1. The Next.js page sends only display-safe demonstration identity values to the client.
2. The client reads and writes state through `/api/finance`; database and banking secrets remain server-only.
3. The finance route validates actions, scopes every operation to the demonstration workspace, and records audit events.
4. The server-only Supabase client uses the service role. It is a deliberate demonstration bootstrap, not the final user-authenticated access pattern.
5. PostgreSQL constraints, indexes, foreign keys, integer-cent fields, and RLS policies establish the first persistence boundary.
6. `BankDataProvider` isolates the application from an AISP. `MockBankDataProvider` returns local fictitious data and `EnableBankingBankDataProvider` implements the configurable Enable Banking AIS sandbox/production API.
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

### Bank connection and callback

The client obtains institutions from the server, selects a country and starts a connection. The backend generates a random 256-bit callback `state`, stores only its SHA-256 hash with a 15-minute expiry, creates an Enable Banking authorization and returns its URL. Authentication and consent take place outside Clareza. The callback is single-use, validates the state in constant time, exchanges the temporary `code` for an AIS `session_id`, and starts the first synchronisation only after that session is authorized.

In `mock` mode the same service completes immediately with fictitious data. In `enablebanking` + `sandbox` mode it uses the real Enable Banking API and its sandbox institutions, including Mock ASPSP. The server signs each request with a five-minute RS256 JWT. The application ID and RSA private key stay in environment secrets and are not persisted or returned to the browser.

### Synchronisation and reconciliation

Callback, manual, and daily scheduled jobs pass through the same idempotent service. Each job records its trigger, idempotency key and outcome. The service refreshes account balances, writes timestamped snapshots, looks back seven days from the previous successful sync, follows all Enable Banking transaction continuation keys with a bounded safety limit, and upserts provider transactions by stable identifiers. The daily schedule is the deployable Vercel Hobby baseline; production may use a shorter cadence on an appropriate plan.

Booked movements replace matching pending rows by explicit provider reference or, when absent, by a conservative account/amount/currency/description/date match. This preserves the local transaction identifier and any user overlay. Transient provider errors use exponential backoff and a small in-process circuit breaker; one unavailable institution does not block the finance API.

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
- `financial_institutions`: workspace-scoped provider institution cache.
- `consents`: scopes, provider authorization reference, grant, expiry, and revocation metadata.
- `balance_snapshots`: separate booked, available, and pending values at a timestamp.
- `sync_jobs`: idempotent callback, manual, and scheduled synchronisation outcomes.
- `audit_events`: server-side mutation history.

The production model must still add splits, normalized merchants, tags, recurring items, debts, investments, documents, notifications, and immutable audit detail. If a future provider requires persistent user tokens, they must be stored in a dedicated encrypted envelope rather than `bank_connections`.

## Security posture

- Supabase and provider access are server-only.
- No password, complete IBAN, provider token, or document is present in client state or application logs.
- Financial values use integer cents in application and database storage.
- The PWA service worker does not cache finance API responses.
- RLS policies exist for authenticated workspace members, but the current API uses a fixed demonstration workspace and service role.
- Callback state is short-lived, hashed, and single-use; callback origins require HTTPS outside localhost.
- Provider requests stay server-only, use bounded retries, and retain only minimal reconciliation metadata. Full IBANs and raw transaction payloads are not stored.
- Public authentication, MFA, user-scoped API access, independent RLS testing, penetration testing, provider contracts, and legal review remain production prerequisites.
