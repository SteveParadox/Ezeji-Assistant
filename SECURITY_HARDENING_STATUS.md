# Ezeji hardening review (October 13, 2026)

This is a **partial implementation checkpoint**, not evidence of production readiness. Do not merge or open public paid subscriptions solely because this branch is pushed.

## Implemented on this branch

- Server-owned business profile, service and FAQ context for public AI messages; client-supplied system prompts and plans no longer determine responses or usage entitlements.
- Trial expiration and payment-status checks fail closed on database errors (but usage counting is not atomic).
- Disabled unsafe AI booking tool side effects until authoritative availability and transactional booking requests are supported.
- Checkout requires an authenticated Supabase business owner, using server-derived identity, email and business name.
- Paystack signature verification retained; amount and plan metadata validated against server price map; failed invoice updates return errors.
- Meta webhook signature validation and plan/quota check.
- Staff list, invitation, removal and staff-access resolution routes.
- Authenticated, encrypted WhatsApp connection storage. Old plaintext connection tokens must be reconnected.
- UI repairs to integrations navigation, trial controls, paid checkout headers and conversation/booking claims.
- Server-side conversation recording; removed direct client-side conversation logging.
- RLS migration to revoke client-side sensitive writes, existing schema permitting.
- Tests and CI workflow.

## NOT validated / known blockers

1. **Database:** The repository still lacks a complete clean-bootstrap schema. Run migrations against a staging Supabase instance after backup. Verify all policies and columns, then validate tenant isolation with authenticated tokens. The incremental guardrail migration may require reconciliation with existing policies.
2. **Payments:** No durable server-owned payment-intent table or transactional settlement; signed webhook metadata is not yet matched against a persisted checkout intent. No verified renewal, cancellation, expiry, refund or chargeback lifecycle. Do not enable paid checkout publicly until resolved.
3. **Quotas:** Count-then-use checks remain vulnerable to concurrency races. Move to atomic database reservations and release on failures before billing customers.
4. **WhatsApp:** Incoming messages are still acknowledged before durable processing, with no replay deduplication or recovery queue. No real Meta validation has run. Historical plaintext tokens are intentionally rejected and need reconnection. Test the Graph API version and secret rotation.
5. **Bookings:** Booking tool is disabled because conflicts, dates, time zones, confirmations and concurrency are not authoritative. No real appointments are confirmed or persisted by AI.
6. **Staff:** Staff-seat counting is non-transactional. Invitations and RLS must be exercised against a staging Supabase database; membership selection for users working at multiple businesses needs redesign.
7. **Security:** No distributed rate limiter, per-user cost budgets, abuse monitoring, audit trails or verified data-retention/deletion workflows yet.
8. **Testing:** Source edits have not been locally compiled in an installed frontend checkout in this environment. CI results and real provider sandbox tests are required; do not report these as passed prematurely.
9. **Operations:** No staging load testing, restore drill, rollback rehearsal, production alerting or availability evidence yet.

## Required verification before merge

```sh
npm ci
npm run lint
npm test
npm run build
```

Run isolated PostgreSQL/Supabase RLS tests, staging registration-to-chat and staff workflows, Meta signed webhook replay tests, and Paystack test-mode reconciliation. Review the GitHub Actions outcomes.

Set `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_APP_SECRET` and a random 32-byte hex `WHATSAPP_TOKEN_ENCRYPTION_KEY` on the backend only. Do not publish them as Vite `VITE_*` values.

**Release status: blocked.** This branch deliberately prioritizes safety over prematurely claiming unavailable features are working.
