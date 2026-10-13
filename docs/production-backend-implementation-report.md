# Ezeji backend lifecycle implementation report
Date: 2026-10-13
Branch: `feat/complete-production-backend-lifecycle`
PR: https://github.com/SteveParadox/Ezeji-Assistant/pull/4
Base dependency: https://github.com/SteveParadox/Ezeji-Assistant/pull/3

## Executive summary

Source modifications, schema migrations, React integration, jobs, and tests have been committed to a draft PR. This is an **unverified candidate**, not a production deployment. The current repository had a count-before-usage AI quota, non-durable WhatsApp inbound events, one-time payment activation without an expiry model, email-only staff identification, and dashboard pages reporting save success before database confirmation.

The feature branch inherits PR #3's orphaned-account login fix and locked Paystack settlement. Its migrations convert the original `payment_attempts` ledger into a **single canonical `checkout_attempts` table**, add expiring subscriptions, and extend the same settlement function. Do not maintain two authoritative payment ledgers.

## Requirement completion matrix

| Area | Code status | Specific evidence | Unverified / missing |
| --- | --- | --- | --- |
| P0 Persistent checkout | Partially implemented | `server.js`, migrations 002/003, provider verifier | Real Paystack test checkout, migration tested on DB |
| P0 Subscription lifecycle | Partially implemented | `subscriptions`, periods and expiry RPC in migration 003; cancellation endpoint | Provider recurring renewal, failed renewal, cancellation policy and grace automation |
| P0 Payment reconciliation | Partially implemented | `server/paymentReconciler.js`, `scripts/billing-maintenance.js`, authenticated verify route | Live missed-webhook replay, real cron operations |
| P0 Database bootstrap | Partially implemented | migration 000 core schema and sequential migrations 001–008 | Fresh and legacy PostgreSQL migration execution, existing RLS drift check |
| P1 Onboarding state | Partially implemented | prior PR #3 provisioning, `onboarding_completed_at` field | Full derived completion state, form requirements, real confirmed signup |
| P1 Auth callbacks | Partially implemented | prior auth lifecycle plus multi-staff selection | Real Supabase PKCE / expired callback browser test |
| P1 Staff membership | Partially implemented | migration 004 and `server/staffRoutes.js`, React selection | Email invitation deliverability, revoked access and multi-business cross-tenant integration tests |
| P1 WhatsApp durability | Partially implemented | migration 006, webhook persistence, `scripts/whatsapp-worker.js`, Render worker | Real Meta ingestion/outbound and delivery order tests; operational manual-review UI |
| P1 Booking workflow | Partially implemented | migration 007, `server/bookingValidation.js`, chat form, pending booking RPC | Capacities >1, staff calendars, blackout/buffers, notification delivery, DST E2E |
| P1 Atomic quota / AI spend | Partially implemented | migration 005 reserve/finalize/expire RPC, web/WhatsApp integration | Provider token/cost accounting, daily/model/global spending caps, live concurrency tests |
| P1 Dashboard save | Partially implemented | Profile + AI settings await writes; booking statuses wait for DB | Every screen's timeout/conflict/reload test, no Playwright suite yet |

**No row above is reported as production-validated.** All areas have remaining work or integration evidence gaps.

## Database architecture

Migrations in lexical order:

1. `202610130000_core_schema_bootstrap.sql`: additive tables, key indexes, restrictive tenant policies, non-billing client profile update grants and server-only billing trigger.
2. `202610130001_tenant_guardrails.sql`: remove legacy public conversation-write permissions.
3. `202610130002_atomic_paystack_settlement.sql`: prior persistent payment ledger / locked settlement.
4. `202610130003_checkout_subscription_lifecycle.sql`: rename ledger to `checkout_attempts`, add `subscriptions`, authoritative paid periods, expiring entitlement RPC and scheduled expiration.
5. `202610130004_staff_identity.sql`: verified user-ID staff memberships, invitations, scoped RLS and locked invitation acceptance.
6. `202610130005_atomic_usage_quota.sql`: usage periods, reservations, lock-based quota enforcement, idempotent finalization and expiration.
7. `202610130006_whatsapp_outbox.sql`: WhatsApp event inbox, outbound message ledger and SKIP LOCKED queue claiming.
8. `202610130007_booking_conflict_guard.sql`: pending booking request RPC, idempotency, exclusive confirmed resource exclusion, workflow transition trigger.
9. `202610130008_paystack_refunds.sql`: processed refund ledger and controlled suspension of the currently refunded subscription.

**Preflight is mandatory** on an existing Supabase project. Compare column types, duplicate invoice/payment references, unknown legacy RLS policies, grants, and orphaned customer data before running anything. Some production tables may differ from the supplied baseline; migrations deliberately do not destructively replace them, and may fail on incompatible schema instead.

## Key invariants targeted

- Checkout owner and amount are server-derived and written before Paystack initialization.
- The only settlement RPC creates paid invoice, updates subscription, and marks the attempt settled atomically. A refund can suspend an entitlement only when the refunded invoice is the subscription's current paid invoice.
- An active string on profiles is **insufficient** for access: paid entitlements check subscription period end at authorization time.
- A missed webhook can be reconciled through Paystack verification against the owner's stored attempt; automated maintenance retries pending and expired attempts.
- Staff membership binds the verified Supabase UUID, never an unverified email alone, and revocation updates database authorization immediately.
- Meta inbound events are durably stored before ACK, then leased by a worker. Ambiguous outbound sends require review rather than automatically sending duplicates.
- Web AI requests obtain an atomic reservation before provider invocation and finalize or release it. Retry-safety and end-to-end cost reporting still need validation.
- A chatbot-created appointment is **pending**. Confirmed overlapping exclusive-resource windows are blocked by PostgreSQL, not browser logic.
- UI confirms saves only after a database acknowledgement in the repaired flows.

## Deployment preflight and command sequence

1. Take Supabase backup and preserve all `auth.users`, profiles, invoices, staff, booking, and WhatsApp records.
2. Inspect existing `public.profiles`, `public.invoices`, `public.staff_members`, RLS grants/policies, and status check constraints. Compare to migration 000. Do not apply automatically to an unknown production schema.
3. Create a throwaway Supabase/PostgreSQL staging database. Apply all migrations in lexical order with Supabase CLI or an authorized migration runner. In environments using CLI: `supabase db reset` only against local/disposable development (NEVER production). On production use an approved migration deployment workflow after staging succeeds.
4. Run `npm ci`, `npm run lint`, `npm test`, `npm run build`.
5. Run `EZEJI_LIFECYCLE_TEST_DATABASE_URL=postgres://.../ezeji_test npm test` with `psql` installed and a privileged disposable test DB. The test sets up Supabase auth-role stubs; it is **not equivalent to real Supabase Auth/RLS integration testing**.
6. Configure backend secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `GROQ_API_KEY`, `APP_URL`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TOKEN_ENCRYPTION_KEY`. Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` in frontend. Never put service credentials in `VITE_` variables.
7. Deploy API, frontend, Render billing cron and WhatsApp worker together. Cron executes `node scripts/billing-maintenance.js` every 15 minutes; worker executes `node scripts/whatsapp-worker.js`. Configure secrets separately for every Render service.
8. Confirm `GET /health` liveness vs `GET /health/ready` database readiness. Run Paystack test-mode monthly/yearly purchases for every tier, refunds and missed webhook reconciliation; exercise two tenants, multiple staff roles, quota races, WhatsApp test messages and booking conflict races.
9. Review operational `review_required` checkout/refund and WhatsApp records before enabling real transactions. Never fabricate invoices or silently delete history.

## Actual validation evidence and release blockers

- GitHub PR checks have been failing before usable execution logs/runner steps; this is a **failed check**, not a test success.
- Source JavaScript backend syntax was parsed for 17 server/scripts files using V8, adapting top-level-await scripts for module parsing. This does **not** replace `node --check` against the checked-out repository.
- A direct pure-logic check evaluated booking duration and Africa/Lagos timezone conversion successfully.
- Real PostgreSQL concurrency/migration tests, Paystack test transactions, Meta Cloud API, and Supabase Auth links **were not executed** in this environment. No credentials or disposable test database were provided.
- No production migration or deployment occurred.

## Post-implementation bug audit and outstanding risks

1. Validate every migration against the **actual** staging Supabase schema. Earlier manual SQL scripts and migration files may overlap in RLS policy and trigger names.
2. Verify checkout initialization retry, abnormal provider refund payloads, paid-at timestamps, delayed older paid events, and disputes through real provider test data.
3. Introduce confirmed provider-managed recurring subscription configuration before promising automatic renewals or grace handling. Existing checkout is a one-time purchase with period-based expiry.
4. WhatsApp worker needs a secure admin reconciliation/dead-letter UI, observed delivery-status races, operator metrics, and sustained soak testing.
5. Business-specific resource capacities, staff schedules, blackout hours, DST and notification delivery need more comprehensive booking logic and tests.
6. AI token-cost usage and spending budgets are not yet fully enforced globally or per model. Current max output token cap is an initial safety limit, not a budget.
7. Complete real browser tests for signup, account recovery, staff invitation and business switching, billing return, saving, and reload persistence.
8. Confirm restrictive RLS and API-field permissions under multiple actual Supabase JWTs. SQL source inspection does not prove isolation.
9. Real-world public booking and chat abuse/rate limiting require distributed safeguards.

## Production readiness verdict

**Not ready for live customers** until migrations, CI, multi-tenant security, provider integrations, and recovery behavior pass in a deployed staging environment. Provisional **implementation progress: 60/100**, **verified production readiness: 25/100**, because production-critical real database/provider testing is absent. These are engineering estimates, not measured reliability metrics.

Pull request must remain draft and unmerged while tests are failing or absent.
