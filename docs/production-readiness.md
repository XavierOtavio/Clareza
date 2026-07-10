# Production-readiness limits

This build is a functional first vertical slice, not a regulated production release.

## Required before real users or real bank data

- Select and contract a licensed AISP with verified Portuguese and EU bank coverage.
- Implement callback, consent renewal, webhook verification, token encryption, idempotent incremental synchronisation, pending-to-booked reconciliation, retries, rate limiting, and circuit breaking.
- Replace demonstration identity with a reviewed public authentication path, MFA or passkeys, session protection, recovery, and workspace membership controls.
- Implement the complete PostgreSQL/Supabase schema, Row Level Security policies, cross-workspace isolation tests, private document storage, retention, erasure, and anonymisation.
- Separate original provider data from user corrections, splits, tags, and categorisation rules.
- Add encrypted backups, tested restoration, incident response, observability without sensitive values, and secret rotation.
- Complete DPIA/privacy review, legal terms, consent records, supplier contracts, security assessment, penetration testing, accessibility audit, and operational runbooks.
- Add Vitest integration tests and Playwright desktop/mobile journeys for authentication, callbacks, revocation, CSV imports, RLS, and failure recovery.

## Deliberate first-slice substitutions

- Cloudflare D1 is used by the current hosted environment instead of Supabase PostgreSQL. Financial and banking boundaries are isolated so the persistence adapter can be replaced, but that migration is not implemented yet.
- The Open Banking flow is a labelled mock. It proves the interface and idempotent import behaviour but does not prove bank coverage or regulatory compliance.
- Forecasts use labelled demonstration assumptions. They are not advice or guarantees.
- PDF export currently uses the browser print-to-PDF flow; a server-rendered, archived report is future work.
- Documents, family invitations, investments, debt amortisation, recurring-item detection, AI insights, and data erasure are represented in the roadmap but not implemented in this slice.
