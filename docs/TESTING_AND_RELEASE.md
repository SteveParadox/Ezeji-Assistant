# Testing and release acceptance: step by step

This is a verification **procedure**, not a historical test report. Capture actual results for the **candidate commit**. The checked-in browser suite uses intercepted provider fixtures; passing it does not prove real provider delivery, PostgreSQL RLS on a deployed Supabase project, or financial settlement.

## 1. Prepare isolated test environments

1. Record the commit SHA, Node version, npm version, target branch and test date.
2. Use **staging** Supabase/Paystack/Groq/Meta environments with synthetic user profiles and phone numbers.
3. Make sure no test uses live credentials or live customer data.
4. Ensure the migrations have been applied to staging as described in [Deployment](DEPLOYMENT_RUNBOOK.md).
5. Install Node 22, npm and optional `psql`.
6. Save command output and browser reports to your approved internal test evidence location, with tokens/PII redacted.

## 2. Install, lint, run unit tests and build

From the repository root:

```bash
npm ci
npm run lint
npm test
npm run build
```

Expected conditions:
- `npm ci`: lockfile and dependencies install successfully.
- `npm run lint`: no error-level lint violations; investigate warnings instead of assuming they are harmless.
- `npm test`: zero **failed** tests. Read the number of skipped tests and their reason; skip is not a pass.
- `npm run build`: Vite exits successfully and emits `dist/`; inspect warnings and public bundle for accidental secrets.

Additionally:

```bash
node --check server.js
node --check server/staffRoutes.js
node --check server/whatsappConnections.js
```

You can use the workflow in `.github/workflows/ci.yml` as an automation reference. Its **application** and **browser** jobs must each pass for the candidate commit.

## 3. Run browser regression tests

Install a browser, then execute:

```bash
npx playwright install --with-deps chromium
npm run test:browser
```

If the operating system cannot run the standard Playwright download, use an approved locally installed executable only after verifying its provenance. The configuration supports `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Do not claim browsers were tested merely because a script was added.

The browser suite lives in `tests/browser/` and uses `playwright.config.js`. It exercises the React app against **explicit network fixtures**, not real provider sandboxes.

Review:
- Failed test names, screenshots, traces and `playwright-report/`.
- Desktop and mobile viewport overflow (320, 375, 390, 430, 768, 1024, 1440 and 1920 px, where covered).
- Landing, signup, account recovery, navigation, page loading, empty/error states.
- Customer preview, local chat isolation, services/FAQ CRUD and rejected writes.
- Booking confirmation rejection and stale-success response handling.
- Hours editor with empty/partial week, timezone save and canonical profile navigation.
- WhatsApp connect/disconnect race, focus-managed dialogs and keyboard operation.
- Palette token consistency and automated accessibility tests.

### Manual mobile checks

1. Use a real or representative narrow device with on-screen keyboard.
2. Open the dashboard drawer; verify focus, Escape/back navigation and no horizontal overflow.
3. Edit a service and weekly hours; ensure time inputs, save controls and error messages remain visible.
4. Test the chat input when the on-screen keyboard is expanded.
5. Check scroll/focus restoration when closing dialogs.
6. Test `prefers-reduced-motion` and keyboard-only navigation.
7. Record device/OS/browser, screenshots and any unresolved defects.

## 4. Run guarded real-PostgreSQL integration tests

The repository includes two native Postgres test entry points that intentionally **skip** unless all safeguards are met:

- `server/backendLifecycle.postgres.test.js` reads `EZEJI_LIFECYCLE_TEST_DATABASE_URL`.
- `server/paystackSettlement.postgres.test.js` reads `PAYSTACK_TEST_DATABASE_URL`.

**Critical:** Each URL must point to a **disposable** database whose name ends with `_test`. These suites create schema, exercise real locking/concurrency and may modify/drop test database objects. Never set them to a production or shared staging database.

Example using a private isolated database (substitute your own endpoint):

```bash
export EZEJI_LIFECYCLE_TEST_DATABASE_URL="postgres://USER:PASSWORD@TEST_HOST:5432/ezeji_test"
export PAYSTACK_TEST_DATABASE_URL="$EZEJI_LIFECYCLE_TEST_DATABASE_URL"
npm test
```

PowerShell:

```powershell
$env:EZEJI_LIFECYCLE_TEST_DATABASE_URL = "postgres://USER:PASSWORD@TEST_HOST:5432/ezeji_test"
$env:PAYSTACK_TEST_DATABASE_URL = $env:EZEJI_LIFECYCLE_TEST_DATABASE_URL
npm test
```

Run those only if the database is **truly disposable and isolated**, `psql --version` works and the URL has been checked by a second reviewer. The name suffix guard does not prove the endpoint is safe.

Validate:
1. Full clean migration bootstrap succeeds on a fresh test DB.
2. Duplicate Paystack webhook/verification paths produce one invoice.
3. Invoice or profile-update failures roll back settlement.
4. Concurrent valid checkouts serialize under row locks.
5. Trial/paid quota reservations never oversubscribe.
6. Duplicate AI request keys never create two generation authorizations.
7. Confirmed booking conflict constraints reject overlapping exclusive slots.
8. Staff seat limits remain consistent under concurrent invitations.
9. Server-only functions reject unauthorized callers.
10. Cross-tenant RLS prevents reading and writing another business.

Stop if a migration or test fails; record the exact SQL/error and do not continue deploying.

## 5. Staging Auth and profile end-to-end acceptance

Use two owner accounts (Owner A and B) and at least one staff account:

1. Register Owner A with email confirmation required. Verify an unconfirmed account cannot access the owner workspace.
2. Confirm the email, complete business setup, and check that one correct profile is provisioned.
3. Refresh and log in again; the business ID remains stable.
4. Register Owner B and verify A cannot see or modify B's profile, FAQs, services, invoices or chat records.
5. Invite a staff user with the proper plan. Check invitation acceptance, permitted business selection and restricted owner-only pages.
6. Revoke staff access and confirm server authorization fails for old membership.
7. Request password reset and verify link, expiration, new password and login.
8. Simulate a verified orphan account in staging and verify recovery without subscription mutation.

Acceptance: no auth loop, cross-tenant data visibility, duplicate provisioned business or privilege escalation.

## 6. Staging assistant and knowledge acceptance

1. Save a unique service, price, hours, FAQ, cancellation/refund policy and timezone for Owner A.
2. Keep Owner B's catalog and prices distinctly different.
3. In A's private preview, ask about pricing/hours; verify answers use only A's saved facts.
4. In a public customer chat for A, repeat the same questions. The backend must ignore browser-supplied fake instructions, plans or prior messages.
5. Attempt to use B's business ID with A's owner preview token; expect denial.
6. Test paused assistant, expired trial, insufficient quota and missing provider/model. All should fail safely without promising successful operation.
7. Test successive conversation turns with one valid session; verify ordered history, unique message identifiers and no cross-session mixing.
8. Retry an identical accepted request ID; verify idempotent outcome and no second provider generation.
9. Retry a request ID with different message content; verify conflict/rejection.
10. Simulate provider timeout and database commit interruption; verify reservations, recovery and no duplicate external reply.
11. Test staff handoff: switch to `human`, verify automation pauses, then return to `automated` only through an authorized status update.
12. Check customer STOP/START behavior for eligible WhatsApp traffic and real message suppression.
13. Verify customer/preview deletion and retention semantics separately from bookings/invoices.

Acceptance: verified provider behavior, tenant isolation, correct quota accounting, factual answers and deterministic handoff.

## 7. Staging booking acceptance

1. Ask about a saved service in web chat.
2. Follow the booking dialogue for date/time, name and contact.
3. Ensure the entered time is valid for the business timezone and configured service duration.
4. Inspect the review prompt; only submit with the explicit confirmation mechanism.
5. Verify the created booking row is actually saved with **pending** status and a stable booking/request ID.
6. In Bookings, confirm only when real staff/resource availability is established.
7. Attempt a conflicting confirmed slot; verify database rejection and unchanged previous status.
8. Verify cancellation and authorized status transitions.
9. Retry the same booking request ID; confirm no duplicate booking.
10. Test invalid/ambiguous dates, DST/timezone boundaries, stale UI data and access from another owner.

Acceptance: no phantom appointments, no cross-business booking write and no browser-only “confirmed” status.

## 8. Staging Paystack acceptance

Run with **test-mode Paystack** and fully migrated staging DB.

1. Check Starter/Professional/Business monthly and yearly amounts in `shared/planCatalog.js` against the server-created checkout attempt.
2. Create an authenticated owner checkout; attempt an anonymous/staff/other-owner checkout and verify denial.
3. Complete a successful Paystack test transaction.
4. Check provider transaction verification (same exact reference, amount, currency, owner) and atomic paid invoice/subscription/attempt state.
5. Simulate a missed webhook and recover through authenticated reference verification or scheduled reconciliation.
6. Replay the signed webhook multiple times; there must be no duplicate paid invoice.
7. Test bad HMAC, wrong amount, wrong currency, failed/pending transaction, expired attempt and unexpected provider ID.
8. Test concurrent settlement, delayed old payment and refund replay.
9. Confirm checkout redirect alone never activates a plan, even if a previous same-plan term was active.
10. Verify the frontend shows pending/review/failed states accurately and does not encourage immediate double payment.

Acceptance: no owner/amount substitution, replay double-settlement, unmatched invoice, or premature entitlement.

## 9. Staging Meta WhatsApp acceptance

1. Configure HTTPS webhook and signature verification.
2. Verify legitimate provider challenge and reject incorrect verification token.
3. Send legitimate signed webhook and reject invalid signature.
4. Confirm durable event storage and deduplicated provider IDs.
5. Start the worker with matching Supabase and encryption keys.
6. Send a customer message; observe claim -> process -> outbound delivery and provider receipt.
7. Deliver duplicate and out-of-order events; verify replay/ordering guards.
8. Test provider timeout, expired token, retry/backoff and dead-letter review.
9. Send STOP to pause and START to re-enable as permitted by policy.
10. Disconnect channel and verify no further unauthorized sends.

Acceptance: customer messages are not lost before acknowledgment, the right tenant receives them, and delivery is evidenced by provider results.

## 10. Security and privacy checks

- Search public static output for sensitive environment variable **values**, not only names.
- Verify RLS with distinct real auth tokens, including when browser query parameters are forged.
- Confirm service-role key, Groq key, Paystack secret, Meta app secret and WhatsApp encryption key do not appear in frontend assets.
- Confirm role/tenant checks are in backend/RPC, not only hidden tabs.
- Verify request/session ID validation, replay protection and rate limits.
- Verify privacy handling: user consent, retention and deletion (customer threads versus booking/billing records), staff revocation and encrypted backups.
- Verify logs/alerts never include entire customer messages or credentials by default.
- Inspect assistant outputs and user-supplied FAQ/policy text for prompt-injection attempts that must not authorize business operations.

## 11. Production readiness sign-off

A release can be approved only when all relevant rows are **proven**:

| Gate | Record |
| --- | --- |
| Exact commit/branch and deployment versions | SHA, date, API/frontend/worker versions |
| Lint/unit/build | Commands, exit status and warnings |
| Browser regression | Passed/failed counts, artifacts, tested device/browser |
| Native PostgreSQL and PGlite tests | Migration version, DB identity, skipped/failed counts |
| Supabase Auth and tenant RLS | Separate-account test evidence |
| Paystack test-mode settlement/replay | Provider refs recorded securely, DB settlement evidence |
| Groq end-to-end and quota handling | Real provider results and failure behavior |
| Meta delivery (if enabled) | Signed webhook/worker/outbound/receipt evidence |
| Background jobs | Last successful cron runs and queue state |
| Security/privacy/accessibility | Findings and sign-off |
| Rollback and restore | Tested procedure and responsible operator |

**If any critical gate is unverified, do not mark the deployment production-ready.** Clearly label unavailable credentials, skipped integrations and fixtures as limitations. A green GitHub Actions run is helpful but cannot replace real external-provider validation.
