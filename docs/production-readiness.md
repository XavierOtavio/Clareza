# Production-readiness limits

This repository is deployable to Vercel as a functional demonstration. It is not a regulated production release and must not process real personal or bank data in its current form.

## Implemented deployment foundation

- Standard Next.js build and Vercel configuration.
- Supabase PostgreSQL migration with constraints, indexes, workspace membership, and RLS policies.
- Server-only persistence client and no Cloudflare runtime dependency.
- Integer minor-unit money fields and deterministic financial calculations.
- Labelled mock Open Banking provider and idempotent provider transaction identifiers.
- Explicitly fictitious data and a non-persistent fallback when Supabase is absent.

## Required before real users or real bank data

- Implement Supabase Auth, MFA or passkeys, secure recovery, and server-side user/workspace resolution.
- Replace fixed demonstration service-role operations with user-scoped clients; reserve service-role access for verified callbacks and background jobs.
- Test cross-workspace reads, inserts, updates, and deletes against RLS.
- Select and contract a licensed AISP with verified Portuguese and EU coverage.
- Implement callback state, consent renewal, webhook signatures, encrypted tokens, incremental synchronisation, pending-to-booked reconciliation, retries, rate limiting, and circuit breaking.
- Separate provider source data from user corrections, splits, tags, and categorisation rules.
- Add private document storage, personal data export and erasure, retention, anonymisation, encrypted backups, restoration tests, incident response, and secret rotation.
- Complete DPIA/privacy work, terms, consent records, supplier contracts, security assessment, penetration testing, accessibility audit, and operational runbooks.
- Add integration and Playwright desktop/mobile journeys for authentication, callbacks, revocation, CSV imports, RLS, and failure recovery.

## Deliberate demonstration substitutions

- The finance API uses one fixed demonstration workspace and a server-only Supabase service-role client.
- Open Banking is a labelled mock; it proves the interface and deduplication boundary, not bank coverage or regulatory compliance.
- Forecasts are labelled scenarios, not advice or guarantees.
- PDF export uses browser print-to-PDF rather than an archived server-rendered report.
- Family invitations, documents, investments, debt amortisation, recurring-item detection, AI insights, and complete data erasure remain roadmap work.
