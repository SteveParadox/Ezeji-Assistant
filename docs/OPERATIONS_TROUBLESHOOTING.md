# Operations and troubleshooting playbook

Use this guide after deployment or whenever an owner reports a broken journey. It complements [Deployment](DEPLOYMENT_RUNBOOK.md), [Developer setup](DEVELOPER_SETUP.md), and [Testing](TESTING_AND_RELEASE.md). All commands and database checks must target the **intended environment**.

## 1. First-response checklist for any incident

1. Record UTC timestamp, environment, frontend URL, API URL, deployed commit SHA and user-visible screen/status. Do **not** request passwords, access tokens, entire message histories or card details.
2. Decide whether the incident affects **billing**, **customer privacy/tenant access**, **bookings**, **AI replies**, **WhatsApp delivery** or **UI-only layout**.
3. Check whether the same issue reproduces in staging with synthetic test accounts.
4. Confirm frontend and API deployments use compatible commits/migrations.
5. Query the liveness and readiness endpoints (next section).
6. Review structured API, cron and worker logs with the narrowest relevant correlation/request ID, **redacting PII**.
7. If customer data or payment integrity might be compromised, disable the affected ingress/action using the approved operational control and escalate immediately.
8. Record hypothesis, evidence, corrective action, re-test result and recovery approval.

Never “fix” billing by editing browser storage, entering a success row manually, or forcing an active flag on a profile.

## 2. Determine whether the backend is operational

From a trusted operator terminal:

```bash
curl -i https://YOUR_API/health
curl -i https://YOUR_API/health/ready
```

Interpretation:

| Finding | Meaning | Next step |
| --- | --- | --- |
| Connection error / timeout | API host/network/DNS/TLS may be down | Check host deploy, logs, TLS and routing |
| `/health` responds `alive` | HTTP process responds | Still inspect `/health/ready` |
| `/health/ready` 503 reason `database` | Backend Supabase client unavailable | Verify backend-only URL/key and secret injection |
| `/health/ready` 503 reason `assistant_configuration` | `GROQ_API_KEY` missing | Verify API deployment secret |
| `/health/ready` 503 reason `dependencies` | DB query or migration readiness failed | Inspect `production_billing_ready`, `assistant_schema_ready`, profiles access |
| `/health/ready` 200 | Required DB/assistant dependency probe passed | Also inspect `paystackConfigured`; test providers/jobs separately |

`paystackConfigured: false` can be present even when the route responds 200. Readiness alone does not assert webhook correctness, settlement safety, encryption-key parity or worker health.

## 3. Authentication and onboarding

### Symptoms: verification email not arriving

1. Check the email typed at signup.
2. In the correct Supabase project, inspect Auth SMTP configuration and delivery/error metrics.
3. Verify Site URL and allowed confirmation redirect URL match the environment exactly.
4. Confirm the email template sends a valid supported confirmation token/hash.
5. Request resend only through the UI; respect provider rate limits.
6. Test with a fresh staging account. Never disable email confirmation on production just to make the flow appear to work.

### Symptoms: login succeeds but business setup is missing

1. Reproduce with an authenticated verified test account.
2. Inspect the owner's profile, not the browser-only display fields. The profile primary key must belong to the authenticated Supabase user.
3. Determine whether the profile is genuinely missing or a query failed. Database errors must not be treated as proof the record does not exist.
4. Use the **Business Setup** recovery path for legitimate missing profiles.
5. Confirm provisioning is idempotent and does not mutate an existing paid subscription.
6. Verify the user can reach **Getting Started** after returning from setup.

### Symptoms: password reset link fails

1. Confirm `/?auth_callback=recovery` is allowlisted.
2. Check link expiry and whether the user opened the same environment as the signup account.
3. Inspect the auth callback state and recovery session without logging its token.
4. Request a new link and test password validation/confirmation.
5. Verify sign-in with the newly set password and unchanged business identity.

## 4. Payment and subscription incidents

### Symptoms: Paystack charged customer but Ezeji still shows pending

1. **Do not encourage a second payment yet.** Record the timestamp, environment, the owner business ID internally, and **a restricted transaction reference**.
2. Check that the checkout attempt was created on the server and belongs to the authenticated owner, with immutable plan, period, expected NGN amount and provider reference.
3. Verify the transaction with Paystack's trusted `transaction/verify` API using server-side credentials or via the authenticated verification endpoint.
4. Confirm status is truly successful and reference, currency, amount and expected owner all match. Pending/ongoing/failed is not settlement.
5. Check webhook signature validation and webhook delivery attempts at `/webhooks/paystack`.
6. Inspect server logs for settlement RPC failures or duplicate idempotency requests.
7. Confirm **exactly one** paid invoice and corresponding subscription entitlement were committed by the atomic settlement function.
8. If the webhook was missed, use the existing authenticated `GET /verify-paystack/:reference` recovery path or normal billing maintenance; do not insert a fake invoice.
9. If the transaction is inconsistent or in `review_required`, escalate to billing operations and preserve provider/DB evidence.
10. Recheck UI after a fresh profile fetch.

### Symptoms: plan expired unexpectedly

1. Check the recorded paid-period end and current UTC timestamp.
2. Review the invoice/checkout reference that funded the current term.
3. Check billing cron `expire_paid_subscriptions`, reconciliation logs and actual provider status.
4. Confirm delayed older payment attempts have not incorrectly overwritten the latest settled subscription.
5. Reconcile genuine provider anomalies with a reviewed financial procedure; do not extend access with a frontend plan toggle.

### Symptoms: duplicate webhook or payment concern

1. Compare provider transaction ID and attempt reference; differentiate a **replayed callback** from **two legitimately charged checkouts**.
2. Inspect the unique constraints and settlement outcome (`settled` vs. `already_settled`).
3. Repeated delivery of the same verified transaction must not create a second invoice.
4. If there were two real charges, use the approved refund/manual review policy. Idempotency does not automatically refund duplicate legitimate purchases.

### Read-only diagnostics (privileged, correct database only)

```sql
-- Anomaly inventory: active businesses with no paid invoice.
SELECT p.id, p.plan, p.payment_status
FROM public.profiles AS p
WHERE p.payment_status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.invoices AS i
    WHERE i.business_id = p.id AND i.status = 'paid'
  );
```

Treat the result as an **investigation list**, not authorization to cancel accounts or fabricate invoices.

## 5. Assistant replies: unavailable, repeated or inaccurate

1. Check API readiness, Groq config and whether the business has a valid current trial/paid entitlement and available AI allowance.
2. Inspect **AI Settings** for active/paused state and missing readiness inputs.
3. Verify saved service catalog, FAQs, policies, timezone and weekly schedule directly, with authorized tenant access.
4. Reproduce with **owner preview** to separate customer-channel issues from business-knowledge issues.
5. Compare the same question via customer web chat without sending a client-crafted system prompt. The backend uses saved facts and deterministic safety policy.
6. When available, correlate by the stable `requestId` and database request state. Never replay the same ID with a different message payload.
7. If Groq times out, inspect `GROQ_CONNECTION_TIMEOUT_MS`, `GROQ_RESPONSE_TIMEOUT_MS`, `GROQ_MAX_ATTEMPTS`, model availability and network limits. Do not enable unbounded retries.
8. If the reply is generated but missing from visible history, check maintenance reconciliation (next section) instead of generating it again under a new ID.
9. If hours/prices are incorrect, fix the authoritative saved knowledge and retry; do not embed guessed prices/hours in fallback copy.
10. If an AI booking answer claims a guaranteed booking, treat that as a production defect and verify the booking database before notifying the customer.

Common server-side error categories include invalid request/session (400), access/entitlement blocked (403), concurrent processing/idempotency conflict (409), rate limited (429) and unavailable dependency (503). **Use actual response status and code**, not the wording of a stale UI notice.

## 6. Customer conversation and handoff issues

1. In the owner **Conversations** page, check the live session list and history before falling back to legacy conversation summaries.
2. Confirm staff access is associated with the correct business, and that the requested thread belongs to that business.
3. For a human handoff, inspect thread status (`human`, `automated`, `resolved`, or opt-out state) and use the saved status update, not a local display toggle.
4. If automation is paused for staff review, **no outbound staff messaging composer exists in this inbox**. Contact the customer through an approved channel.
5. If a customer used STOP, respect opt-out; only a valid customer START flow may re-enable supported automated messages.
6. For “clear chat” or session deletion requests, distinguish thread content deletion from booking records, usage accounting, invoices and other retained records. Use the correct authenticated/session capability endpoint.
7. Handle access requests, retention and erasure under the organization's privacy procedure. Do not publicly share transcripts.

## 7. Booking operations and conflicts

1. Locate the request by booking ID in the authorized tenant's **Bookings** page.
2. Confirm whether it is `pending`, `confirmed`, `canceled`, or another recorded state.
3. Compare service, date/time, timezone, customer consent and staff/resource availability.
4. If confirming fails, inspect database conflict/transition safeguards. Do **not** force the UI to display confirmed.
5. Check that the server's returned booking ID and status match the requested update.
6. For overlapping time slots or DST/invalid local times, investigate `server/bookingValidation.js` and the related booking SQL constraints.
7. Preserve the original request and audit record during review; notify staff/customer only after the authoritative status is saved.

## 8. WhatsApp webhook, queue and worker recovery

### Symptoms: integration shows “saved” but no messages arrive

1. Check the account is entitled to connect WhatsApp, and that the Meta phone number ID/access token are valid.
2. Confirm the public HTTPS callback exactly matches `/webhook/whatsapp`, the verify token, and required event subscriptions.
3. Check API `WHATSAPP_APP_SECRET`, webhook verification and signature rejects.
4. Confirm signed inbound events are persisted before being acknowledged.
5. Confirm the separate WhatsApp worker is **running** and uses the same Supabase environment and encryption key.
6. Inspect queue records and worker log event IDs (not phone/token contents) to locate failures or retries.
7. Check outbound provider rate limits, token expiry, Graph version and delivery receipts.
8. Send a test from an authorized number. Verify inbound -> claimed event -> committed assistant result -> outbound send -> receipt; “configuration saved” is not this test.

### Symptoms: repeated messages, stuck processing or dead events

1. Identify the provider event ID and corresponding `whatsapp_events` state.
2. Check the lease, retry count and delivery/order guards.
3. Ensure only intended version(s) of worker are processing the same queue.
4. Investigate failures logged as `whatsapp_processing_failed` or `whatsapp_lease_update_failed`.
5. Do **not** manually requeue a dead event without verifying its effects and the approved recovery procedure. Duplicate sends can create unwanted customer notifications.
6. Test replay/out-of-order receipts with provider test traffic and verify no incorrect regression in delivery state.

A read-only query for a trusted operator:

```sql
SELECT id, status, attempts, next_attempt_at, lease_until
FROM public.whatsapp_events
WHERE status IN ('queued','processing','dead')
ORDER BY next_attempt_at NULLS FIRST
LIMIT 50;
```

## 9. Background maintenance jobs

### Billing maintenance

`scripts/billing-maintenance.js` is designed to run every **15 minutes** through Render cron and performs due-checkout reconciliation, expired subscription updates, AI reservation expiry and rate-bucket pruning.

1. Verify the Render job exists at the correct schedule and uses backend-only secrets.
2. Check the latest `billing_maintenance` structured log and exit status.
3. If `billing_maintenance_failed` appears, investigate Supabase, Paystack or RPC availability before retrying.
4. Do not run multiple overlapping manual billing jobs as an ad hoc fix.

### Assistant maintenance

`scripts/assistant-maintenance.js` runs every **minute**. It tries committing generated replies, runs abandoned-request recovery and invokes data pruning.

1. Check the latest `assistant_maintenance` event.
2. Investigate `assistant_maintenance_failed` and any `assistant.reconciliation_failed` correlation IDs.
3. Examine the affected request state; do not trigger a second Groq generation under a different ID.
4. Verify retention/pruning succeeded and customer-message privacy limits are being enforced.
5. Escalate database lock/conflict problems to an operator who can inspect the relevant SQL RPC.

Read-only example:

```sql
SELECT id, status, updated_at
FROM public.assistant_requests
WHERE status = 'generated'
ORDER BY updated_at ASC
LIMIT 50;
```

Run manual maintenance only against approved isolated or production environments under operational change control:

```bash
node scripts/billing-maintenance.js
node scripts/assistant-maintenance.js
```

Do not run the worker script as a single-shot cron; `node scripts/whatsapp-worker.js` is a long-running process.

## 10. Security, retention and incident response

1. Maintain separate provider and Supabase credentials per environment.
2. Restrict access to API, cron/worker secrets and service-role key; log only sanitized correlation identifiers.
3. Rotate exposed credentials immediately under a coordinated procedure. Redeploy affected services.
4. For WhatsApp encryption-key rotation, first plan token re-encryption or authorized reconnection. A mismatched key can prevent reading saved credentials.
5. The assistant schema/maintenance implementation targets **30-day customer conversation retention** and shorter **preview retention (one day)**, with separately retained booking/billing/audit artifacts. Verify deployed pruning jobs and the project's privacy obligations before promising deletion.
6. Make encrypted/controlled backups, test restoration, and comply with business retention/erasure requirements.
7. For suspected cross-tenant leaks, halt affected access, preserve minimal evidence, revoke exposed credentials, investigate RLS and authorization, and follow the incident-notification policy.
8. For suspected payment corruption, prioritize provider truth, attempt ledger, atomic settlement and invoice consistency over frontend appearance.

## 11. Troubleshooting quick reference

| Symptom | First likely checkpoint |
| --- | --- |
| Frontend blank or broken after release | Browser console, Vite build, lazy imports and static-host SPA routing |
| Login redirects repeatedly | Supabase Auth session + callback config + `src/NightlineApp.jsx` |
| Email not received | Supabase SMTP/template/rate limits |
| Profile saves appear lost | Authenticated RLS/write response and account identity |
| No weekday rows in Hours & Location | `hours_json`, normalized weekly schedule and currently deployed UI version |
| Preview unavailable | Owner token, assistant settings, provider and quota |
| Customer web chat unavailable | Public business link, business ID, API readiness and entitlement |
| Charged but plan pending | Correct reference, webhook verification, settlement RPC, invoice |
| Booking still pending after Confirm | Database conflict/status update, not button appearance |
| WhatsApp saved but no reply | Meta callback, signed inbound, durable event, worker/outbox |
| Analytics shows unavailable | Permission, DB query and metrics endpoint; do not substitute zero |
| Old messages reappear after clearing chat | Distinguish browser cache, server thread/session and separately retained operational records |

If the issue is not isolated, provide a reproducible sanitized issue and the exact deploy SHA to the maintainers. **Do not post secrets or personal customer information.**
