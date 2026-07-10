# Clareza architecture — first vertical slice

## Outcome

The first slice is a server-rendered Vinext/Next.js application with a React client experience and a server-only financial API. It deliberately keeps financial rules out of presentation components and stores money as integer minor units. The deployed environment provides the relational D1 binding; the target production architecture may replace this adapter with Supabase PostgreSQL without changing the banking or calculation contracts.

## Runtime boundaries

1. The server page reads optional workspace identity headers and sends only display-safe identity data to the client.
2. The React application reads and writes financial state through `/api/finance`; it never reads database or banking secrets.
3. The finance route validates requested actions, scopes every query to one workspace, records audit events, and returns a normalised view model.
4. D1 stores relational phase-one state. Money is stored in cents and timestamps use ISO 8601 UTC strings.
5. `BankDataProvider` isolates the application from an AISP. `MockBankDataProvider` is the only active implementation and uses fictitious data.
6. Pure functions in `lib/finance/calculations.ts` calculate assets, liabilities, net worth, available balance, income, expenses, savings, savings rate, pending values, and category totals.

## Critical flows

### Manual account

The user submits a name, account type, and balance. The client converts a validated Portuguese decimal input to integer cents. The server validates safe integers, inserts the account within the workspace, and writes an audit event.

### Sandbox bank connection

The user selects a fictitious institution. The mock provider creates a consent-shaped connection, returns accounts and transactions, and the server imports them in one batch. Unique provider transaction identifiers make repeated imports idempotent.

### Category correction

The client submits the selected category and transaction identifier. The server applies the change only inside the active workspace and records the correction in the audit log. A later phase will preserve original provider fields and user overlays in separate normalised tables.

### Financial summary

Only booked, non-internal transactions enter income and consumption totals. Pending values remain separate. Net worth equals positive account balances minus the absolute value of negative balances at the reference time.

## Phase-one data model

- `workspaces`: ownership boundary and demonstration flag.
- `accounts`: manual, imported, or synchronised sources; booked and available balances.
- `transactions`: stable provider identifier, booked/pending state, category, and internal-transfer flag.
- `budgets`: one category limit per workspace and month.
- `goals`: target, current amount, target date, and priority.
- `bank_connections`: provider, institution, state, synchronisation timestamp, and consent expiry.
- `audit_events`: action, entity, metadata, and timestamp.

The full target model adds users, workspace membership, consent/token envelopes, balance snapshots, splits, merchants, tags, rules, recurring items, bills, subscriptions, debts, assets, valuations, investment positions, prices, documents, notifications, import jobs, sync jobs, and immutable audit detail.

## Security posture

- Database and provider access is server-only.
- No token, password, complete IBAN, or sensitive document is present in client state or logs.
- Workspace scope is included in every read and write.
- Destructive and connector actions require explicit user interaction.
- The PWA service worker does not cache finance API responses.
- The current demonstration identity is not a substitute for public authentication, MFA, RLS, penetration testing, or a legal review.
