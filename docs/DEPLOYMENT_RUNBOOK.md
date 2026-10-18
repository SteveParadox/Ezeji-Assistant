# Staging and production deployment runbook

**Scope:** Deploy the current React/Vite + Express + Supabase + Groq + Paystack + optional WhatsApp system, including background jobs and the assistant SQL schema. This is an **ordered procedure**, not a statement that any particular deployment has passed it.

**Never execute migrations, connect live Paystack, or activate real WhatsApp traffic on an unverified database.** First run the complete procedure against staging, using provider test credentials, and record the results.

## 1. Create an environment and release record

1. Choose distinct **development**, **staging** and **production** Supabase projects wherever possible.
2. Record the Git commit SHA/tag to deploy, current migration baseline, target database, frontend host/origin, API host/origin, Render services, provider account modes, and responsible reviewer.
3. Confirm you can restore an earlier database snapshot and redeploy the last known-good API/frontend versions. Test a restore in staging.
4. Record where backup and redacted monitoring evidence will live. Limit access to those artifacts.
5. Choose a short checkout/WhatsApp cutover window. Avoid a split deployment where old payment code and new SQL are simultaneously receiving live webhooks.
6. Confirm the source includes `render.yaml`, `scripts/assistant-maintenance.js`, `scripts/billing-maintenance.js` and `scripts/whatsapp-worker.js`.

## 2. Provision separate services and secrets

Provision:
- **Supabase Auth/PostgreSQL** for identity, tenant data, policies, billing/assistant RPCs.
- **Frontend** (e.g. Vercel) to serve the Vite `dist/` SPA.
- **Node/Express API** (e.g. Render Web Service) to run `node server.js`.
- **Render background worker** to run `node scripts/whatsapp-worker.js` if WhatsApp is in scope.
- **Billing cron** to run `node scripts/billing-maintenance.js` every 15 minutes.
- **Assistant cron** to run `node scripts/assistant-maintenance.js` every minute.
- **Groq**, **Paystack** and, if required, **Meta WhatsApp Cloud API** credentials for the **correct environment**.

Use secret stores provided by the host. Do not add actual secrets to `render.yaml`, git commits, SQL migrations, generated JS, screenshots or CI logs.

### Environment variable placement

| Variable | Where | Role |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Frontend build | Public Supabase project URL and publishable client key |
| `VITE_API_URL` | Frontend build | HTTPS API base URL, e.g. `https://api.example.com` |
| `VITE_WHATSAPP_WEBHOOK_URL` | Frontend build, optional | **Public URL only**, shown read-only to owner |
| `SUPABASE_URL` | API, crons, worker | Same environment's database/auth project URL |
| `SUPABASE_ANON_KEY` | API if configured | Public Supabase key used for approved server workflows |
| `SUPABASE_SERVICE_ROLE_KEY` | API, crons, worker **only** | Privileged DB access, never in frontend |
| `APP_URL` | API | Exact HTTPS frontend origin used for checkout return and CORS |
| `PORT` | API host | API listen port (Render provides or explicitly configures this) |
| `GROQ_API_KEY`, `GROQ_MODEL` | API and worker | Assistant generation |
| `PAYSTACK_SECRET_KEY` | API and billing cron | Provider checkout/verification |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | API | Webhook HMAC and Meta verification challenge |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | API and worker | Encrypt/decrypt stored WhatsApp access tokens; must match |
| `WHATSAPP_GRAPH_VERSION` | API/worker | Meta Graph API version |
| `ASSISTANT_CLIENT_HASH_SECRET` | API | Anonymous client rate-limit hashing; use a long random secret |
| `GROQ_CONNECTION_TIMEOUT_MS`, `GROQ_RESPONSE_TIMEOUT_MS`, `GROQ_MAX_ATTEMPTS`, `GROQ_MAX_REPLY_TOKENS` | API/worker where used | Optional bounded provider behavior |

The committed `.env.example` also contains **legacy Stripe placeholders**. The documented production checkout path is **Paystack NGN**, not a Stripe signup checkout. Do not enable or expose Stripe secrets merely because the example lists them. Review every environment variable in source before deployment.

The service-role key and WhatsApp encryption key are privileged credentials. Changing the latter without a migration/reconnection plan can break decryption of existing encrypted channel tokens.

## 3. Apply the database migrations in order

### 3.1 Preflight

1. Back up the target DB and export current schema, functions, RLS policies, grants and migration history. Confirm recovery works.
2. Check whether you are initializing an empty project or **upgrading an existing database**. These are not interchangeable paths.
3. Review differences in legacy `profiles`, `invoices`, `checkout_attempts`, `subscriptions`, `bookings`, `usage_periods` and `whatsapp_events`. Investigate duplicate payment references and missing owner associations.
4. Run the migration series on disposable/staging DB first. Stop immediately on any statement error. Do not skip a failed earlier migration or keep issuing later ones.
5. Apply **each not-yet-applied versioned migration once**, in lexical order, with a privileged migration role. Record the filename, time, result and committed migration version.

### 3.2 Ordered list: foundational series

The following files are in `supabase/migrations/`:

| Order | Filename | Purpose |
| --- | --- | --- |
| 1 | `202610130000_core_schema_bootstrap.sql` | Core tables and initial policies |
| 2 | `202610130001_tenant_guardrails.sql` | Restrict unsafe tenant writes |
| 3 | `202610130002_atomic_paystack_settlement.sql` | Server-owned attempts/locked settlement |
| 4 | `202610130003_checkout_subscription_lifecycle.sql` | Checkout ledger and expiring paid periods |
| 5 | `202610130004_staff_identity.sql` | Verified user-ID staff membership and invitations |
| 6 | `202610130005_atomic_usage_quota.sql` | Atomic AI reservation/finalization |
| 7 | `202610130006_whatsapp_outbox.sql` | Durable webhook events/outbox |
| 8 | `202610130007_booking_conflict_guard.sql` | Pending booking RPC and conflict rules |
| 9 | `202610130008_paystack_refunds.sql` | Refund state and controlled entitlement changes |
| 10 | `202610130009_audit_booking_entitlement.sql` | Booking/entitlement guardrails |
| 11 | `202610130010_audit_ai_idempotency.sql` | AI request identity corrections |
| 12 | `202610130011_whatsapp_receipt_ordering.sql` | Monotonic WhatsApp receipt updates |
| 13 | `202610130012_atomic_staff_seats.sql` | Concurrent staff-seat enforcement |
| 14 | `202610130013_ai_rate_limits.sql` | Tenant/global AI request throttling |
| 15 | `202610130014_business_contact_persistence.sql` | Saved business contact fields |

### 3.3 Ordered list: current assistant series

Continue **after** the applicable 2026-10-13 migrations:

| Order | Filename |
| --- | --- |
| 16 | `202610140001_assistant_conversations.sql` |
| 17 | `202610140002_assistant_controls.sql` |
| 18 | `202610140003_validated_assistant_bookings.sql` |
| 19 | `202610140004_assistant_operational_guards.sql` |
| 20 | `202610140005_whatsapp_ordering.sql` |
| 21 | `202610140006_assistant_history_ids.sql` |
| 22 | `202610140007_assistant_recovery_guards.sql` |
| 23 | `202610140008_whatsapp_delivery_guards.sql` |
| 24 | `202610140009_assistant_knowledge_bounds.sql` |

The assistant migrations address durable sessions/messages, active/paused controls, policy/handoff, validated bookings, history IDs, recovery, WhatsApp ordering/delivery and saved knowledge bounds. Inspect each SQL file for actual DDL, revocations and dependencies rather than treating the description as an executable contract.

### 3.4 Example controlled application

For **staging only**, with `psql` installed and an explicitly confirmed staging database URL, run one SQL file at a time:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202610130000_core_schema_bootstrap.sql
# Review output and schema before moving to the next numbered file.
```

Repeat only for migrations that your staging environment has not already applied. Do **not** paste the entire list against production without a reviewed migration ledger and change approval. SQL Editor execution is also possible, but keep file/order/results traceable. Legacy one-off scripts such as `supabase/invoices.sql`, `supabase/staff_access.sql` and `supabase/auth_business_profile_security.sql` are historical context, **not extra blanket commands to rerun after the ordered migrations**.

### 3.5 Verify DB security and readiness

1. With a privileged DB session, confirm `production_billing_ready()` and `assistant_schema_ready()` exist and return true when appropriate.
2. Use two distinct authenticated test owners to attempt cross-business `profiles`, `services`, `faqs`, bookings and inbox access. Ensure the wrong owner is denied.
3. Confirm public/`anon` roles cannot execute payment settlement, quota reservation or privileged staff management functions.
4. Confirm authenticated owners cannot grant themselves a paid plan or change another business's assistant settings.
5. Run migrations/tests on a **separate** test DB. Never “test” settlement or refunds by inserting fake rows into a live finance ledger.

## 4. Configure Auth URLs and mail

1. In **Supabase Dashboard > Authentication > URL Configuration**, set the frontend origin as Site URL.
2. Add exact HTTPS redirect URLs for:
   - `https://YOUR_FRONTEND/?auth_callback=confirm`
   - `https://YOUR_FRONTEND/?auth_callback=recovery`
3. Configure authorized sender/SMTP and review signup, reset and invitation email templates.
4. Keep the production email-confirmation behavior enabled and test that it returns an approved verified account.
5. Test new signup, expired/duplicate callbacks, password reset, previously incomplete owners, and staff invitations. The app must be able to reload direct SPA callback URLs.
6. Do not point staging email links at production or vice versa.

## 5. Deploy the API and background services

The committed `render.yaml` declares a web API, billing cron, WhatsApp worker and assistant cron.

1. Create/synchronize the Render services from the repository, using the **tested commit**.
2. Configure Node 22 on all relevant services.
3. For the API, use `npm ci` or the documented install/build process and start `node server.js`.
4. Set all API-side variables listed in section 2; ensure `APP_URL` is the frontend origin, not the API origin.
5. Deploy and query:
   ```bash
   curl -i https://YOUR_API/health
   curl -i https://YOUR_API/health/ready
   ```
6. Require `/health/ready` HTTP 200 with status `ready` and both billing/assistant migrations `ready`. `paystackConfigured` must also be true before enabling payments; `/health/ready` can report that field without making it a readiness gate.
7. Configure billing cron every **15 minutes**, sharing the correct Supabase project and Paystack secret; inspect its first successful structured log.
8. Configure assistant maintenance cron every **minute**, sharing the correct Supabase project; confirm reconciliation and pruning run without errors.
9. If WhatsApp is used, start exactly the intended worker deployment with matching DB, Groq settings and token-encryption key; inspect event claim/process logs.
10. Set alerts for failing scheduled jobs, stale queues, failed reconciliation, quota errors and 5xx spikes.

**Never enable the same WhatsApp event stream on an old worker binary after the new SQL rollout.** Rolling deployments and lease semantics need staging rehearsal.

## 6. Deploy the Vite frontend

For Vercel (or equivalent static hosting):

1. Connect the repository at the verified commit/tag.
2. Choose the Vite/React build configuration.
3. Install with `npm ci`, build with `npm run build`, and publish the `dist` output.
4. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_URL=https://YOUR_API_ORIGIN`.
5. If using a same-origin Vercel API catch-all (`api/[...path].js`) **instead** of Render for backend requests, set `VITE_API_URL=https://YOUR_FRONTEND/api` and configure backend secrets in the Vercel runtime. Do not inadvertently route requests through both competing backends.
6. Optionally set `VITE_WHATSAPP_WEBHOOK_URL` to the real public HTTPS callback for read-only display.
7. Verify the static host serves the SPA on query-string URLs such as `/?view=dashboard&tab=overview`, `/?view=chat&biz=...`, and Auth callback URLs after a hard reload.
8. Redeploy frontend whenever any `VITE_*` build-time value changes.
9. Confirm HTTPS, approved CORS origins, and no service-role/Groq/Paystack/Meta secrets embedded in public JS assets.

## 7. Configure Paystack test mode before live mode

1. Keep the API using `PAYSTACK_SECRET_KEY` for the **correct Paystack environment**.
2. Configure webhook URL to `https://YOUR_API/webhooks/paystack` in the provider dashboard.
3. In Paystack **test mode**, initiate checkout while signed in as a staging owner. Confirm the server creates a checkout attempt before redirecting.
4. Verify monthly/yearly **NGN kobo** values and exact plan match against `shared/planCatalog.js`.
5. Complete a test payment; verify the server checks Paystack transaction reference, amount, currency and owner-linked attempt before settlement.
6. Confirm the settled attempt, exactly one paid invoice and correct subscription term are committed as one database transaction.
7. Replay the same valid webhook twice. Confirm no duplicate invoice or double activation.
8. Simulate webhook delivery failure then use authenticated `/verify-paystack/:reference` or billing maintenance to reconcile.
9. Exercise pending, failed, wrong-currency, wrong-amount, different-owner, delayed older checkout, refund and settlement database-error paths.
10. **Only after signed evidence and approval** configure live Paystack and repeat a controlled small payment/refund test with a real operator.

A successful browser redirect or existing “active” plan **never** proves that a new charge has settled.

## 8. Configure Meta WhatsApp

1. Create a Meta app/business test setup and obtain Phone Number ID, app secret and permitted access token.
2. Supply the **API host** with `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`. Supply API + worker the **same** `WHATSAPP_TOKEN_ENCRYPTION_KEY`.
3. In Meta dashboard, configure `https://YOUR_API/webhook/whatsapp` (not localhost), the matching server verify token, and the supported subscribed events.
4. Test the webhook GET verification challenge and a signed POST callback. An invalid HMAC must be rejected.
5. In the owner **Integrations** page, enter Phone Number ID and access token. The API verifies and encrypts it; UI “configuration saved” alone is insufficient.
6. Send an actual controlled inbound message. Verify event persistence, worker claim, server-grounded reply/outbox, delivery to the intended number and provider receipt updates.
7. Send duplicate/out-of-order receipt events, failure retries and STOP/START opt-out messages. Confirm ordering, deduplication, safe suppression and retry handling.
8. Rotate the access token in staging; verify old credentials cease to work and the replacement works. Test business disconnection.
9. Only connect production after end-to-end tests, privacy review and operator ownership are clear.

## 9. Run release acceptance and cut over

Follow [Testing and release](TESTING_AND_RELEASE.md). Minimum:

```bash
npm ci
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser
```

Check the GitHub Actions **application** and **browser** jobs against the exact commit. Passing mocked-browser tests is necessary but does not replace real staging Supabase Auth/RLS, Groq, Paystack and Meta checks.

Then:
1. Capture release sign-off from application, data/security and billing owners.
2. Verify current backups, recovery runbook, migrations and active worker versions.
3. Deploy API/worker/cron and validate readiness before switching public frontend traffic.
4. Release the frontend built with matching environment API URL.
5. Run synthetic authenticated and anonymous tests (no real user data).
6. Observe payment settlement, assistant requests, booking status, queue processing and error rates during the cutover.
7. Keep a rollback route and escalation contact active.

## 10. Rollback procedure

1. If payment/tenant integrity is at risk, temporarily **disable new checkout or inbound traffic** through controlled routing/configuration; do not fabricate payment success.
2. Preserve database and provider logs. Record a sanitized incident timeline and affected requests.
3. Roll back frontend/API/worker binaries **only when their SQL compatibility is verified**. Database migrations that add or alter financial/integrity rules may not be safely reversible.
4. Do not blindly reverse a schema migration or delete invoices, attempts, messages or booking records.
5. Reconcile in-flight Paystack attempts directly with provider truth and the appropriate atomic RPC before restoring service.
6. Perform recovery checks and retest the failing scenario in staging.
7. Resume traffic only after responsible operators confirm tenant, billing and message consistency.

See [Operations and troubleshooting](OPERATIONS_TROUBLESHOOTING.md) for incident triage and routine maintenance.
