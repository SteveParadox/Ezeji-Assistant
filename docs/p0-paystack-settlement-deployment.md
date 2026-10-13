# Ezeji P0 login recovery and atomic Paystack settlement

## Root causes repaired

- src/shared.jsx previously dereferenced an undefined `userMetadata` on missing-profile login. Its resolver now uses verified auth-user metadata and a testable dependency-injected helper; profile DB errors remain errors rather than triggering provisioning.
- Previously, server.js updated a business subscription first, inserted the invoice later, and relied on an invoice lookup before either operation. Concurrent webhooks could both pass the lookup and failed invoice writes could leave active subscriptions without invoices.
- Previously, signed webhook metadata could choose which business and plan to activate. The new server-owned checkout ledger supplies these immutable fields.

## Migration before backend release

1. Backup production Supabase schema and data. Confirm `public.profiles`, `public.invoices`, the `auth.role()` function, and the base `supabase/invoices.sql` schema exist. Inspect invoices for duplicate `(provider,provider_reference)` and repair via controlled provider reconciliation, not destructive deletes.
2. Deploy `supabase/migrations/202610130002_atomic_paystack_settlement.sql` via a privileged migration/SQL editor session. It creates private `payment_attempts`, indexes, constraints, and the `settle_paystack_payment` and `paystack_settlement_ready` functions. Ensure the SQL transaction commits successfully.
3. Check the new functions are EXECUTE-restricted to `service_role` and the attempt ledger denies `anon` and `authenticated` access. Verify the backend Supabase service-role connection resolves `paystack_settlement_ready() = true`.
4. Deploy the backend and frontend code from this PR, keeping existing Supabase and Paystack credentials server-only. `PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and frontend origin `APP_URL` must be configured. Never set `VITE_SUPABASE_SERVICE_ROLE_KEY`.
5. Check production `/health` and perform staging checkout for Starter/Professional/Business monthly and yearly using Paystack test mode. Confirm immutable NGN kobo values, signed webhook verification, committed invoice and entitlement, login, and account recovery.
6. Only route real traffic to the new backend after the migration and staging tests have passed. An old backend processing payments after migration is **not** safe; replace old instances before enabling new checkout traffic.

## Settlement policy

A server-generated payment reference and immutable business/plan/period/NGN amount/email are persisted **before** Paystack initialization. The transaction is verified by calling Paystack's trusted `transaction/verify` endpoint, then compared with the stored attempt. A signed webhook's metadata does not change the business or plan.

The settlement SQL function row-locks the attempt and business, inserts one paid invoice, conditionally updates the business subscription, and marks the attempt settled within the same PostgreSQL transaction. Unique references and unique provider transaction IDs prevent duplicate payment attribution. Any failed write rolls back all changes. A repeat verified delivery returns `already_settled` without activating the business again. A refunded invoice cannot be reactivated by replay. Provider refunds must be handled by a separate verified refund/cancellation workflow, which is outside this two-defect patch.

**Delayed payments:** A successful older checkout gets a paid invoice but cannot overwrite a more recently initiated and already settled checkout on the same business. This is determined using `(created_at,id)` of the *server-recorded attempt*, not arrival order of webhooks. The newest successfully settled checkout wins; there is no automatic proration or refund of duplicate legitimate payments. Such cases require a defined customer billing/refund policy.

The payment verification GET endpoint reads only the authenticated owner's attempt and invoice and does not activate service. An HTTP redirect is never payment proof. Webhook transient/database errors return a non-2xx response so Paystack may retry; repeatedly invalid/unknown references require operational reconciliation rather than fake invoice creation.

## Controlled legacy reconciliation

Before declaring production billing consistent, investigate active profiles that have no paid invoice. This query is a **diagnostic**, not automatic backfill:

```sql
select p.id,p.plan,p.billing_period,p.payment_status
from public.profiles p
where p.payment_status='active'
  and not exists (
    select 1 from public.invoices i
    where i.business_id=p.id and i.status='paid'
  );
```

For each finding, verify the business and reference with Paystack, inspect gateway amount, currency, status and payment time, and decide the corrective transaction under change control. Do not fabricate invoices or revoke service solely from this query. Similarly, legacy Paystack invoices do not automatically create a newly trusted attempt row.

## Tests and required release gate

Run:

```bash
npm ci
npm run lint
npm test
npm run build
```

For genuine database atomicity tests, create a **disposable PostgreSQL database whose name ends with `_test`**, with `psql` installed. Then execute:

```bash
PAYSTACK_TEST_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/ezeji_test npm test
```

The real-PostgreSQL suite intentionally skips unless the guarded URL and psql are provided. It covers rollback on invoice failure, rollback on profile-update failure, 20 concurrent overlapping settlement RPC calls, duplicate delivery, older checkout ordering, integrity mismatches, and refund replay. A skipped test is **not a passing PostgreSQL test**. In addition, exercise a staging deployed backend with 20 parallel signed webhook requests, real Paystack test credentials, a real Supabase service role, and verify the committed state. This PR cannot assert that provider-connected end-to-end scenario passes merely from JS mocks or SQL source review.

**Hold production rollout** until an isolated migration, DB tests, staging webhooks, required account-recovery scenarios, and CI checks all pass. Keep Paystack test mode separate from live transactions.
