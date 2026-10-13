# Ezeji business authentication and checkout repair (2026-10-13)

## Source audit / root causes

- src/authScreens.jsx treated a null Supabase signUp().data.session as an error and did not persist business fields for later provisioning.
- src/NightlineApp.jsx restored a session once, with no auth event lifecycle, no missing-business recovery, and no recovery-password destination.
- src/shared.jsx conflated profile query failures with missing rows, allowed frontend upserts of payment-related fields, and silently proceeded to staff lookup.
- The original CheckoutScreen signed up an owner and attempted checkout in the same request flow. Email confirmation made this impossible.
- ForgotScreen sent reset email but had no callback exchange, password form, or updateUser({password}).
- Checkout depended on an owner profile already existing and could not heal legacy verified but incomplete users.

## Implementation

- src/authState.js: pure plan-selection, signup metadata, callback parsing, and routing utilities.
- src/authLifecycle.js: controlled Supabase signup, callback exchange/OTP, server provisioning and authorized Paystack initialization.
- src/authScreens.jsx: verification pending/resend, legacy recovery, password update, authenticated-only checkout, payment-pending status.
- src/NightlineApp.jsx: one Supabase auth listener, stale async cancellation, deterministic provisioning and recovery destinations, staff compatibility.
- src/shared.jsx: profile query errors are not "profile missing"; client updates are limited to non-billing fields.
- src/supabaseClient.js: disable SDK auto callback consumption so the app handles callback exactly once.
- server/businessProvisioning.js and server.js: verified bearer tokens, owner IDs derived from auth, immutable existing subscriptions, primary-key idempotency.
- supabase/auth_business_profile_security.sql: owner-profile RLS and server-only billing-field protections.
- src/authState.test.js and server/businessProvisioning.test.js: focused, runnable Node regression tests.
- .github/workflows/auth-checks.yml: npm ci, npm test, npm run lint, npm run build.

## Deploy and test configuration

Use the Supabase Dashboard > Authentication > URL Configuration:
- Site URL: the actual frontend HTTPS origin.
- Redirect URLs: <FRONTEND_ORIGIN>/?auth_callback=confirm and <FRONTEND_ORIGIN>/?auth_callback=recovery.
- Local test redirects: http://localhost:5173/?auth_callback=confirm and http://localhost:5173/?auth_callback=recovery.
- Keep email confirmation enabled for production; configure working SMTP and email templates.
- The Supabase email templates must preserve the token/code or use a supported token_hash + type combination. Do not change from implicit links to PKCE without testing the configured SDK flow.

Frontend: set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_API_URL.
Backend: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only), PAYSTACK_SECRET_KEY, APP_URL (HTTPS frontend origin), and appropriate CORS origin.
Set APP_URL to the frontend origin without a trailing query string; callback used by Paystack is APP_URL + ?checkout=success.
Serve the SPA at / for both direct callback navigation and page reloads.
Do not inject the service-role key into any VITE_ variable.

Run the existing supabase/staff_access.sql first if not already applied, then apply supabase/auth_business_profile_security.sql through a privileged SQL migration process. Take a schema/policy backup first; verify profiles.id is still auth-user UUID PK and profiles contain the columns used by provisioning. The repository does not contain a baseline CREATE TABLE for profiles, so staging validation is mandatory.

## Recover legacy incomplete accounts

On their next verified sign-in, existing owners without a profile are directed to business setup. Existing profiles with blank business names can be completed without touching plan or payment status. Valid profiles are reused. Network/DB errors are shown as recoverable errors, not treated as missing data.

For an inventory without unsafe automatic backfills:

SELECT u.id, u.email, u.created_at
FROM auth.users AS u LEFT JOIN public.profiles AS p ON p.id = u.id
WHERE p.id IS NULL ORDER BY u.created_at;

This is a *diagnostic* query. Do not mass-create businesses from unverified or missing metadata; the user must authenticate and provide the necessary details.

## Staging end-to-end verification

1. Configure Supabase staging with Confirm Email enabled, local SMTP or test inbox, and the SQL migration.
2. Signup using the free-trial and paid-plan paths. Verify signUp() yields null session. Open confirmation email and confirm that exactly one profile with id=auth.uid() is created and the correct route is shown.
3. Refresh and restart the browser, sign in, check that the existing profile is reused. Simulate an orphaned verified account and confirm the business-setup recovery flow.
4. Request recovery email, open it, try invalid/expired link, try mismatched passwords, and reset a valid password. Sign in using the new password; confirm the business ID remains unchanged.
5. Paid plan: finish verified onboarding, open Paystack test checkout, return to the app. Confirm no active plan is shown until a signed webhook writes the update and invoice; check payment status again.
6. Call checkout as another owner or without a bearer token: it must reject the request; use an invalid webhook HMAC and confirm rejection. Verify tenant RLS with two distinct accounts.
7. Test staff login and public chat business lookup to ensure preexisting features still work.

Commands after checkout: npm ci; npm test; npm run lint; npm run build.

## Limitations and release gate

GitHub Actions on this branch currently reports failed jobs and connector log retrieval is unavailable. Hosted SMTP, live Supabase RLS/migrations, Paystack test payment/webhooks, and browser E2E have not been verified by this change. Do not promote this branch to production until the CI failure and staging steps above are resolved.

Review existing public.profiles SELECT policies for cross-tenant data exposure: this migration preserves unknown policies to avoid breaking public chat. Check existing grants and other policies before claiming complete multi-tenant isolation.

Migration rollback: restore the previously backed-up protect_paid_plan_fields() function and its trigger; remove only newly named Ezeji policies added by this migration, leaving other policies and data intact. Revert frontend/backend code as one deployment unit. Do not delete profiles or invoices.


## Verification evidence collected 2026-10-13

A source-derived JavaScript smoke harness fetched the exact committed source files
from the PR branch and executed 12 checks covering plan allowlisting,
signup metadata redaction, callback detection, recovery marker expiry,
safe first-time provisioning, retry idempotency, missing-profile protection,
null-session signup, and OTP session exchange. All 12 checks passed.

A second harness instantiated the actual server.js route handlers with mocked
Supabase and Paystack clients and executed 8 checks: unauthenticated/invalid
token rejection, unconfirmed email rejection, authenticated ownership binding,
privilege flag stripping, authorized checkout despite a spoofed businessId,
unsupported plan rejection, and active-plan duplicate purchase rejection.
All 8 checks passed.

These are **mock-backed smoke checks**, not the repository's npm test suite, real
database isolation tests, Paystack integration tests, or browser E2E. The GitHub
Actions runs currently report failure with no recorded steps; root cause
cannot be determined from the connected log endpoint. The rollout gate remains
blocked until npm ci, npm test, npm run lint, npm run build and staging flows
all succeed with evidence.
