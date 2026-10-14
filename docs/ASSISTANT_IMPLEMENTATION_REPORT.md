# Ezeji Assistant implementation and release report

Draft PR: https://github.com/SteveParadox/Ezeji-Assistant/pull/7
Branch: `codex/reliable-business-assistant`
Baseline: main `1b3bef6fff0793b71bfd0fa00f75a399ebe03985`, after merged premium UI PR #6. No open PRs existed when inspected. The existing dark/amber/semantic palette is unchanged.

## Confirmed initial defects

See [ASSISTANT_REPAIR_AUDIT.md](ASSISTANT_REPAIR_AUDIT.md) for severity, reproductions and baseline file references. Critical/high findings included forged browser memory, divergent WhatsApp knowledge, fabricated provider-success fallbacks, duplicate-request errors without replay, separate persistence/accounting, browser-only activation, absent durable handoff, and unchecked WhatsApp messaging windows.

## Implemented request architecture

Web, owner preview and WhatsApp now invoke `createAssistantService` with the same knowledge loader, privileged policy, context builder and Groq client:

1. Channel adapter validates business/request identifiers and identity. Web uses a 256-bit random capability, hashed with tenant and channel; preview requires a verified owner's bearer token; WhatsApp identity includes the verified connection phone ID and sender. Names and typed telephone numbers never link channels.
2. Saved profile, catalog and FAQ rows load afresh on each request. Bounds limit individual fields, total knowledge and recent context. Catalog overrides the legacy primary service; weekly hours override free-text summaries. Owner edits/deletions need no redeploy or cache invalidation.
3. Transactional request claim binds its key to the session and input hash. Current paid-period/trial entitlement, pause, atomic quota, tenant/global concurrency, and durable abuse budgets are checked before generation. Client history, plan and system prompts are discarded.
4. Deterministic handoff/opt-out/booking paths execute without LLM business-operation authority. Other requests use the shared Groq adapter with bounded text-only intent/reply output. Prices and hours are rendered from saved facts, supplementing output checks for unsupported amounts/times/action claims. General semantic grounding remains an LLM limitation; no claim of perfect hallucination detection is made.
5. A valid generated reply is checkpointed. A transaction commits ordered messages, the compatible legacy exchange, pending booking or WhatsApp outbox, and quota finalization. Retrying a committed key returns its original outcome; it does not generate or charge twice. Changed input is rejected.
6. Channel delivery is separate from generation. Operator logs include correlation IDs, latency, attempts, tokens and optional configured estimated cost, never raw conversations, prompts or credentials.

Groq keeps configurable `openai/gpt-oss-20b` as the default. No provider tools, browser search, arbitrary APIs or optional structured-output modes are enabled. Text JSON is parsed with an explicit schema. Empty choices, truncation, refusals, tools, malformed responses, auth/model errors, interrupted responses and timeouts fail honestly. Only explicit 429/5xx responses get bounded backoff with jitter/Retry-After; ambiguous network failures do not blindly regenerate. A failure never becomes a fake AI reply.

## Conversation, actions and UI

Server history returns the latest 24 ordered messages, excludes the current request, and trims to a conservative UTF-8 context budget. Older history is deliberately not summarized or sent unboundedly. Customer emails/phone numbers are redacted from subsequent provider context where recognizable. Full names and other free-text personal information may still occur in customer messages; this is not a complete PII detector.

Booking chat collects a verified catalog service, date/time in business timezone, name and contact, then shows a review and requires `CONFIRM`. Explicit date/time and ordinary weekday/tomorrow plus am/pm expressions are supported; ambiguous/missing details receive a clarification. DST gaps and duplicate local hours are rejected. The model never writes bookings. Form submissions use the same pipeline with explicit confirmation and input-bound replay. DB validation rechecks current entitlement, service ownership/duration, timezone, local date, saved schedule and date bounds. Requests remain pending; no calendar/inventory availability check is claimed. Staff confirmation and existing overlap/transition guards remain authoritative. Session-scoped booking status uses the server-created booking ID; unrelated identities cannot look up arbitrary bookings.

Explicit staff requests/complaints and model escalation signals durably set the thread to human control. Staff/owner inbox controls pause, resolve or return to automation. The UI accurately says recorded for review, never that an external notification was sent. Staff messaging, refunds and automatic cancellation are not fabricated: unsupported sensitive requests go to staff. Existing supported contact channels remain the staff response path.

Customer chat has stable message IDs, multiline input/Enter-to-send, loading and duplicate-send guards, timestamps, original-key retry, tab/session restoration, preserved drafts, cancellation and late-result fences. Starting a new conversation is distinct from deleting server content. Deletion has an accessible native confirmation and transactional in-flight protection. Preview is private, cannot create customer exchanges/bookings/outbound messages, and successful generation consumes the ordinary AI allowance. Its temporary server sessions expire after one day.

Existing active businesses retain their activation, and saved legacy owner pause preferences are migrated. New businesses start paused until the owner explicitly activates after readiness checks. AI Settings now manages backend activation, optional policies/languages, honest readiness and private preview in the premium two-column layout. The conversation inbox shows real sessions/handoff states; Analytics adds actual channel, message, reply, escalation and pending-booking counts. Existing authentication, onboarding, billing, Paystack settlement and staff restrictions remain in place.

## Database migrations

Apply migrations **001–006 dated 20261014**, after all main migrations through `202610130014`, in chronological order. Do not deploy intermediate draft-branch migration snapshots.

| Migration | Purpose |
|---|---|
| `202610140001_assistant_conversations.sql` | Add profile policy/activation and service description; private threads, messages, durable requests, tenant FKs, claim/checkpoint/atomic commit/failure/recovery/retention RPCs; compatible legacy exchange linkage. |
| `202610140002_assistant_controls.sql` | Authorized handoff, bounded knowledge writes, current-entitlement personality enforcement and schema readiness. Validation only checks changed knowledge and cannot block unrelated billing updates because of legacy fields. |
| `202610140003_validated_assistant_bookings.sql` | Harden the existing pending-booking function with transactional ownership, current premium entitlement, duration/timezone/schedule checks and identical replay. The raw insert helper is not externally executable. |
| `202610140004_assistant_operational_guards.sql` | Tenant-bound usage FK, transactional deletion, durable client rate limit, owner aggregates and canonical delivery-status synchronization. |
| `202610140005_whatsapp_ordering.sql` | Serialize inbound leases per tenant/connection/sender and process earlier known events first. |
| `202610140006_assistant_history_ids.sql` | Private history view exposes stable request IDs for restoration/replay without duplicate UI messages. |

New private tables have RLS enabled and no anon/authenticated grants; all RPCs are service-only. Owners/staff use server authorization before privileged reads. Existing legacy read policies remain in use for existing dashboard data. No production schema was changed during this task. Legacy flat exchanges cannot safely reconstruct historical customer identities and are not guessed/merged into new sessions.

## Accounting and recovery policy

One allowance unit is consumed for a valid, committed Groq generation, including private preview. Policy/booking-control replies do not consume LLM units. Delivery failure after valid generation does not reverse its generation usage. Provider/validation failure releases the reservation and keeps the incoming message. Tenant/global rate/concurrency controls are database-backed, not dependent on a single process.

If checkpoint succeeds but commit fails, the generated reply/reservation remains durable; replay or the maintenance task retries the atomic commit. Legacy blind reservation expiry excludes pipeline requests. Three-minute generation leases allow the bounded provider/database deadlines. A process crash before a verified checkpoint is fundamentally ambiguous: maintenance releases the unverified usage into `review_required`, never blindly reruns that request. Provider token spend in this narrow crash window cannot be reconstructed without a provider reconciliation API. Operators must investigate correlation IDs; customers are not charged for an unverified answer. This limitation is explicit, not silently counted as successful usage.

## WhatsApp delivery and privacy

Existing HMAC webhook verification, encrypted credentials, unique provider-event ingestion and monotonic receipts are retained. Inbound timestamps are persisted. The worker validates connection/tenant, premium entitlement, activation and the 24-hour customer-service window before generation/delivery. Missing/expired timestamps enter review; no free-form reply is sent outside the window. Approved-template sending is not an existing implemented feature and has not been invented. STOP preserves a minimal opt-out identity; subsequent messages do not produce an outbox reply until verified START.

Replies enter the outbox in the same transaction as history/usage. A conditional claim prevents two workers sending one row. Meta acceptance requires its returned message ID; receipts update canonical message delivery state. Failed/ambiguous sends enter review rather than being labelled delivered or blindly resent. The queue has leased claims, bounded retry and terminal review/dead states. A provider-delivery ambiguity still requires staff/operator review. Live token validity, Meta delivery and business opt-in/legal notices require deployment acceptance.

Chat records expire after 30 days; preview after one day. The maintenance task deletes expired content and older legacy exchanges/events. Bookings, payment records and allowance ledgers are retained separately; customer deletion wording makes this distinction. WhatsApp opted-out identifiers survive content expiry to avoid automatically opting someone back in. Production backups, provider retention, booking/financial retention and the controller's erasure/access process require an operational policy; this change is not a legal compliance certification. The Nigerian Act/NDPC guidance were reviewed for purpose limitation, minimization, retention and data-subject rights.

## Validation and second audit

- `npm ci`: passed (114 installed packages).
- `npm run lint`: passed; existing Fast Refresh/unused-variable warnings and the chat cleanup ref warning remain nonblocking.
- `npm test`: **155 tests: 153 passed, 0 failed, 2 skipped**. Includes all migrations in disposable PostgreSQL via PGlite, real SQL transactions/RLS/roles, HTTP channel adapters, replay and persistence failure recovery, overlapping requests/last quota unit, paid/trial expiry, owner preview, complete booking collection/form replay, WhatsApp outbox/receipts/send failure/opt-out and provider failure simulations.
- The two pre-existing native PostgreSQL suites require `EZEJI_LIFECYCLE_TEST_DATABASE_URL`/payment test database plus `psql` and were skipped. PGlite validates SQL behavior and serialized overlapping orchestration, **not independent native DB connections/process scheduling**.
- `npm run build`: passed; Vite frontend builds with existing React/Vite architecture.
- `npm run test:browser`: **54 passed** in the final full run, including the restored-ID regression. Fixtures run the actual React UI; they do not claim live provider E2E verification. Chromium 153 was extracted into a temporary runtime because default browser installation was unavailable. Representative mobile/desktop screenshots were inspected; WCAG A/AA automation and all eight widths are covered.
- Express starts and `/health` returns 200. With no service credentials, `/health/ready` correctly returns 503. Worker/maintenance syntax checks pass; missing required settings fail startup. No live worker was pointed at production.

A separate post-implementation read-through found and corrected checkpoint replay acknowledgement handling, cross-tenant usage references, deletion/claim races, late restore/voice results, draft scope leakage, obsolete error notices, booking-form/session separation, expired WhatsApp session behavior, opt-out delivery, profile-validation interference with legacy billing, and timestamp-sensitive browser assertions. No known internal release-blocking defect remains; the external/native acceptance gates below remain open.

## Deployment and release gates

1. Back up the target DB and inspect legacy column/policy compatibility. Apply the six versioned migrations on staging; verify readiness and actual RLS through Supabase/PostgREST. Keep PR draft until native multi-connection tests and release CI pass.
2. Configure backend/worker `SUPABASE_URL`, server-only `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`, the existing Paystack keys and trusted `APP_URL`. See `.env.example` for validated provider/database deadlines and optional price estimates/client HMAC secret. Never put a service key in a VITE variable.
3. Deploy the updated WhatsApp worker with `WHATSAPP_TOKEN_ENCRYPTION_KEY`, `WHATSAPP_GRAPH_VERSION` and the same DB/provider configuration. Configure/reverify Meta webhook app secret, verify token, phone identity and encrypted credentials. Rotate/revoke provider credentials through their actual services; reconnect afterward.
4. Deploy `scripts/assistant-maintenance.js` every minute (Render cron added). Keep billing maintenance separate. Alert on reconciliation failure, abandoned/review requests, dead events and ambiguous outbox sends. Retention depends on this job running successfully; monitor it.
5. Verify Groq response behavior and spend limits, real Supabase owner/customer/staff access, WhatsApp signatures/delivery/windows/opt-out, and native concurrent reservations/claims. Use Paystack sandbox and Supabase auth email/recovery to rerun existing journeys; local fixtures are not actual external acceptance.
6. Review the customer/provider privacy notice and cross-border/provider processing terms, backup/booking retention and erasure workflow with the business controller. No legal guarantee or unsupported external notification/availability/template feature is implied.

GitHub Actions for both implementation commits reported both jobs failed **without steps/logs** (runs [38519010046](https://github.com/SteveParadox/Ezeji-Assistant/actions/runs/38519010046) and [38521746767](https://github.com/SteveParadox/Ezeji-Assistant/actions/runs/38521746767)), as on the earlier UI PR. Local passing checks do not turn that into a passing release gate. Do not merge/deploy until the repository runner/check issue and external acceptance are resolved.

## Changed components

Backend: `server.js`; shared service/routes/knowledge/prompt/facts/policy/booking/provider/database-request/maintenance modules; WhatsApp processor and worker; removed obsolete preview generation module (preview now uses the shared routes); assistant cron and `render.yaml`; `.env.example`; six migrations. Frontend: chat widget/payload/fallback, owner AI Settings, handoff inbox/Conversations, Analytics and profile activation mapping; existing palette/styles reused. Coverage: provider/prompt/booking/preview/pipeline tests, disposable SQL helper, browser chat tests/fixtures and corrected previous regression selectors. Build output is not committed. Implementation commits: [`f218ddb`](https://github.com/SteveParadox/Ezeji-Assistant/commit/f218ddb6de4b0e521d75374ba657ce880b88a0cc) (pipeline/accounting) and [`f16d927`](https://github.com/SteveParadox/Ezeji-Assistant/commit/f16d927e02884847ed3948cfebe4880a18bd6c34) (channel/UI/actions and regression audit). This report follows in a documentation commit.

References: [Groq supported models](https://console.groq.com/docs/models), [Groq error codes](https://console.groq.com/docs/errors), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Meta Cloud API messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages), [NDPC GAID 2025](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf), [Nigeria Data Protection Act (government copy)](https://cert.gov.ng/ngcert/resources/Nigeria_Data_Protection_Act_2023.pdf). Meta documentation retrieval was restricted; live policy/configuration verification remains a release gate.


Reproducible local output: [unit/SQL/provider results](verification/assistant-unit-tests.txt) and [browser results](verification/assistant-browser-tests.txt). These logs contain deterministic fixtures, not real customer conversations.

### Exact affected file list

```text
.env.example
docs/ASSISTANT_IMPLEMENTATION_REPORT.md
docs/ASSISTANT_REPAIR_AUDIT.md
docs/verification/assistant-browser-tests.txt
docs/verification/assistant-unit-tests.txt
package-lock.json
package.json
render.yaml
scripts/assistant-maintenance.js
scripts/whatsapp-worker.js
server.js
server/assistantBooking.js
server/assistantBooking.test.js
server/assistantDatabaseRequest.js
server/assistantFacts.js
server/assistantKnowledge.js
server/assistantMaintenance.js
server/assistantPipeline.test.js
server/assistantPolicy.js
server/assistantPreview.js
server/assistantPreview.test.js
server/assistantPrompt.js
server/assistantPrompt.test.js
server/assistantRoutes.js
server/assistantService.js
server/groqClient.js
server/groqClient.test.js
server/whatsappProcessor.js
src/AssistantInbox.jsx
src/assistantLogic.js
src/assistantLogic.test.js
src/chatRequest.test.js
src/chatSafety.test.js
src/chatWidget.jsx
src/pages/AISettingsPage.jsx
src/pages/AnalyticsPage.jsx
src/pages/ConversationsPage.jsx
src/shared.jsx
src/workspace.css
supabase/migrations/202610140001_assistant_conversations.sql
supabase/migrations/202610140002_assistant_controls.sql
supabase/migrations/202610140003_validated_assistant_bookings.sql
supabase/migrations/202610140004_assistant_operational_guards.sql
supabase/migrations/202610140005_whatsapp_ordering.sql
supabase/migrations/202610140006_assistant_history_ids.sql
tests/browser/chat.spec.js
tests/browser/fixtures.js
tests/browser/ui-regressions.spec.js
tests/browser/workspace.spec.js
tests/helpers/assistantDatabase.js
```
