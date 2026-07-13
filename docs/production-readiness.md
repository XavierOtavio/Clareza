# Production-readiness limits

This repository is deployable to Vercel as a functional demonstration. It is not a regulated production release and must not process real personal or bank data in its current form.

## Implemented deployment foundation

- Standard Next.js build and Vercel configuration.
- Supabase PostgreSQL migration with constraints, indexes, workspace membership, and RLS policies.
- Server-only persistence client and no Cloudflare runtime dependency.
- Integer minor-unit money fields and deterministic financial calculations.
- Provider-agnostic Open Banking boundary with labelled local mock and a configurable GoCardless Bank Account Data sandbox implementation.
- Hashed single-use callback state, consent lifecycle, incremental jobs, balance snapshots, retries, circuit breaker, scheduled synchronisation, revocation, and pending-to-booked reconciliation.
- Explicitly fictitious data and a non-persistent fallback when Supabase is absent.
- Server-validated CSV import with explicit mappings, row-level error counts, and stable duplicate fingerprints.
- Prioritized categorization rules and versioned user category overlays that preserve normalized source fields.

## Required before real users or real bank data

- Implement Supabase Auth, MFA or passkeys, secure recovery, and server-side user/workspace resolution.
- Replace fixed demonstration service-role operations with user-scoped clients; reserve service-role access for verified callbacks and background jobs.
- Test cross-workspace reads, inserts, updates, and deletes against RLS.
- Contract the chosen licensed AISP and independently verify the exact Portuguese/EU institutions and data products required at launch; the current GoCardless configuration is an engineering integration, not a regulatory approval.
- Replace the fixed demo workspace before enabling production provider mode. Add per-user authorization to connection, refresh, revoke, and sync operations; test those paths against RLS.
- Add distributed rate limiting and a shared circuit state appropriate for serverless concurrency. The current circuit breaker is in-process and provider rate-limit responses are retried conservatively.
- Add signed webhook handling if the contracted provider offers a suitable Bank Account Data webhook. This slice uses an authenticated Vercel schedule and manual sync.
- Extend the source/overlay model to transaction splits, tags, attachments, merchant normalization, refunds, and pending-to-booked reconciliation.
- Add private document storage, personal data export and erasure, retention, anonymisation, encrypted backups, restoration tests, incident response, and secret rotation.
- Complete DPIA/privacy work, terms, consent records, supplier contracts, security assessment, penetration testing, accessibility audit, and operational runbooks.
- Add integration and Playwright desktop/mobile journeys for authentication, callbacks, revocation, CSV imports, RLS, and failure recovery.

## Deliberate demonstration substitutions

- The finance API uses one fixed demonstration workspace and a server-only Supabase service-role client.
- CSV imports are limited to 2 MB and recent import history; production requires malware-safe document handling, asynchronous large-file jobs, retention limits, and downloadable error reports.
- Open Banking defaults to a labelled local mock. The GoCardless sandbox calls a real provider API but only Sandbox Finance; it does not prove production bank coverage, regulatory status, uptime, or data completeness.
- GoCardless application access tokens are deliberately ephemeral in server memory. A future provider requiring persistent connection tokens needs a reviewed encrypted envelope and key-rotation design.
- Forecasts are labelled scenarios, not advice or guarantees.
- PDF export uses browser print-to-PDF rather than an archived server-rendered report.
- Family invitations, documents, investments, debt amortisation, recurring-item detection, AI insights, and complete data erasure remain roadmap work.
