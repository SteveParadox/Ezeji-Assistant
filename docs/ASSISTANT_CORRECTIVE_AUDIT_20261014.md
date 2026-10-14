# Corrective implementation audit — 14 October 2026

PR: https://github.com/SteveParadox/Ezeji-Assistant/pull/7
Branch: `codex/reliable-business-assistant`
Reviewed baseline: `e28582b385523163c764ccd467462d2ecdd2019a`; current main remains `1b3bef6fff0793b71bfd0fa00f75a399ebe03985`.

This is a second review of the actual implementation, with code corrections and regression tests. The first four database regressions were run against the previous implementation and all failed before the fixes. They now pass. The published migrations 001–006 are unchanged; corrections are additive.

## Confirmed findings and fixes

| Severity | Workflow / root cause | Implemented correction and regression evidence |
|---|---|---|
| High | Retry changed from model generation to a policy reply retained its released reservation, causing atomic commit to fail. `assistantService.js` and request claim/commit RPCs. | Retry clears reservation/outcome before deciding whether new usage is needed; policy replies never consume released units. Real SQL test verifies committed policy retry with zero consumed usage. |
| High | Late failure/checkpoint callbacks identified only a request, allowing an earlier attempt to release or overwrite its replacement. | Attempt-fenced failure/checkpoint RPCs and live generation lease check; stale callbacks cannot affect the newer attempt. SQL tests exercise both callbacks. |
| High | A booking failing deterministic validation remained `generated`, repeatedly occupying the global processing budget. | Expected validation/entitlement failures become durable unsuccessful actions with truthful messages. Unexpected persistence failures remain recoverable. SQL verifies terminal status; HTTP returns 422 for rejected booking submissions. |
| High | Chat deletion/expiry removed request IDs used as booking idempotency keys, allowing the same submission to create another booking. | Separate tenant-bound booking-key ledger hashes channel, verified identity and client request key; prior keys are backfilled. Delete/replay regression verifies one saved pending booking. |
| High | A queued WhatsApp reply could be sent by a replaced worker, after staff handoff/opt-out, or using credentials cached before generation. | Atomic service-only outbound claim checks event attempt/lease, exact tenant/recipient, committed outcome, current thread revision, consent/handoff, paid entitlement, activation, window and connection. It returns the current encrypted credential. Stale workers never call Meta; blocked replies become failed, not delivered. |
| Medium | Booking decisions used thread state loaded before a slow knowledge query; an intervening committed turn could be lost. | Database thread revision check before claim, with bounded snapshot reload. SQL orchestration test commits another turn during delayed knowledge loading and checks that the next booking question uses refreshed state. |
| Medium | Provider headers arrived but a stalled body or stalled cancellation cleanup could escape the deadline. Incomplete token metadata appeared as a zero estimate. | Reads race the abort signal, cleanup cancellation is nonblocking, retries remain limited to explicit transient responses. Missing prompt/completion counts produce unknown cost. Provider tests cover stalled reads and cancellation. |
| Medium | Grounding used substrings, accepting NGN 100 from NGN 1000 or 9:00 from 19:00. Weekly-hours entries could carry arbitrary unbounded properties. | Exact amount/time token sets; boolean output contract validation; whitelisted bounded hours. Save-time schedule trigger rejects malformed/duplicate weekdays without blocking untouched legacy billing/profile updates. |
| Medium | Booking collection captured pricing questions as names; catalog changes after review could be submitted without renewed consent. ISO dates allowed missing offsets or normalized nonexistent dates. | Fact questions go to the shared model, explicit draft edits are supported, price/duration appear in review and changed details require another CONFIRM. Explicit timezone, whole-minute and real calendar-date validation. Tests exercise new price/duration confirmation and malformed dates. |
| Medium | Lost booking responses/reloads could lose the submitted identity or let the customer change payload under the same key. Conversation controls remained active during submission. | Persist immutable pending payload/key, restore review and lock edits after an ambiguous result; deterministic validation failures allow a new key. Guard sends, starting and deletion while booking is in flight. Browser tests compare original and restored submissions byte-for-byte as parsed JSON. |
| Medium | Pausing could silently save unfinished policy edits; style saving resent unrelated profile fields; stale receipts could replace another current user. | Activation sends only the active field; style saves send only style fields; profile receipts merge only for the matching current user. Browser verifies the unsaved policy draft remains unchanged. |
| Medium | Inbox could retain another tenant's transient state, permit overlapping handoff actions and accept a mismatched response as success. Staff messages with null request IDs disappeared from model history. | Tenant-keyed inbox, verified thread/status receipts, loading/operation guards; thread switching disabled while a handoff mutation is pending. History filters the current request in application code, preserving null staff turns. Browser/SQL regression coverage. |
| Low | Permanent WhatsApp opt-out identities retained expired booking drafts; expired sessions remained listed in inbox. | Maintenance clears expired draft/context while retaining minimal opt-out identity; inbox excludes expired sessions. |

Removed `server/whatsappOutboxClaim.js` and its three mocks after replacing the unsafe client-side claim with the transactional SQL claim and actual worker/lease tests. Tests verify saved booking states, not merely successful HTTP responses. A JSONB key-order comparison bug introduced while adding reviewed booking snapshots was found by SQL tests and fixed with a deterministic scalar review key.

## Architecture and security boundaries

Web, private preview and WhatsApp still use the shared knowledge/policy/provider/conversation service. Claim, generation checkpoint, business-action commit and outbound delivery remain separate. The model cannot execute bookings, alter billing or grant permissions. Recovery callbacks carry an attempt, conversation decisions carry a revision, and WhatsApp delivery carries the worker attempt and committed thread revision. Private booking-key mappings have RLS and no anonymous/authenticated grants. No colors, payment APIs, authentication lifecycle or staff permissions were replaced.

The grounding checks reject specific unsupported amounts/times/actions; they are not proof against every semantic hallucination. Independent native PostgreSQL concurrency, actual provider output quality and platform delivery still need staging acceptance.

## Additional migrations and coordinated rollout

Apply **all nine** assistant migrations dated 20261014 in order after main's migrations through `202610130014`. If 001–006 have already been applied, apply only these additional migrations:

1. `202610140007_assistant_recovery_guards.sql`: thread revision trigger; fenced claim/checkpoint/failure contracts; released-reservation cleanup; durable booking keys with tenant FK/backfill; terminal action rejection.
2. `202610140008_whatsapp_delivery_guards.sql`: committed delivery revision; atomic outbound claim with current policy/credential checks; opt-out draft cleanup; readiness.
3. `202610140009_assistant_knowledge_bounds.sql`: changed-schedule validation; readiness checks for corrected RPC signatures.

Pause inbound generation and drain processing attempts before applying 007: the old unfenced RPC signatures are deliberately removed. Apply 007–009 together on staging, reload PostgREST schema, deploy/restart the API, WhatsApp worker and maintenance process together, and require `/health/ready` to pass before resuming traffic. Do not run an old worker/API against the new signatures. Back up and verify the legacy key backfill first. No production database was changed here.

## Validation

Final local results (deterministic providers/HTTP fixtures, actual React and disposable SQL):

- `npm ci`: passed earlier in this corrective turn; dependencies unchanged.
- `npm test`: **172 total, 170 passed, 0 failed, 2 skipped**.
- `npm run lint`: passed with nonblocking existing/style and cleanup-ref warnings; introduced unused booking-test import removed.
- `npm run build`: passed. Build output is restored and not committed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/ezeji-chromium npm run test:browser`: **58 passed**. Includes mobile/desktop, accessibility and auth/payment/workspace regressions plus lost booking response, guarded submission, policy draft and verified handoff interactions.
- `git diff --check`: passed.

The two native PostgreSQL suites need their database URLs and `psql`; they remain skipped. PGlite executes all versioned SQL/RLS/transaction tests, but does not prove independent native connection/worker scheduling. Live Groq, Supabase/PostgREST/auth email, Meta and Paystack were not exercised. GitHub Actions for corrective commit `02eddc7` also failed: [run 38529279697](https://github.com/SteveParadox/Ezeji-Assistant/actions/runs/38529279697), application and browser jobs both report failure with no steps/log URLs. The available response does not identify a cause; local passing tests are not release-CI approval. Keep the PR draft until those gates pass.

Evidence: [build and lint](verification/assistant-corrective-build-lint.txt), [unit tests](verification/assistant-corrective-unit-tests.txt), [browser tests](verification/assistant-corrective-browser-tests.txt). Prior evidence files remain historical and are not overwritten.

## Affected implementation areas

Backend: assistant service/routes/knowledge/policy/booking, booking validation, Groq provider, WhatsApp processor, three additive migrations. Frontend: chat widget, handoff inbox, AI settings, partial profile receipt handling. Coverage: corrective SQL suite, pipeline/provider/prompt/booking tests, SQL query helper and browser chat/handoff tests. The original [implementation report](ASSISTANT_IMPLEMENTATION_REPORT.md) contains the full shared architecture and deployment configuration.

A final read-through checked RPC call sites and grants, stale callbacks, replay/identity scope, lifecycle cleanup, delivery acknowledgement, profile save boundaries and migration ordering. No additional confirmed internal defect remains from this review. External/native/CI release gates remain unresolved; this is not a production-readiness claim.

## Repository delivery

Implementation commit: [`02eddc7`](https://github.com/SteveParadox/Ezeji-Assistant/commit/02eddc7aedd94fe6be01a150b475904a0bbf0e7a). Delivered to the existing draft PR; main is not modified or merged.

Exact corrective source/test/migration files:

```text
server/assistantBooking.js
server/assistantBooking.test.js
server/assistantCorrective.test.js
server/assistantKnowledge.js
server/assistantPipeline.test.js
server/assistantPolicy.js
server/assistantPrompt.test.js
server/assistantRoutes.js
server/assistantService.js
server/bookingValidation.js
server/bookingValidation.test.js
server/groqClient.js
server/groqClient.test.js
server/whatsappOutboxClaim.js
server/whatsappOutboxClaim.test.js
server/whatsappProcessor.js
src/AssistantInbox.jsx
src/NightlineApp.jsx
src/chatWidget.jsx
src/pages/AISettingsPage.jsx
supabase/migrations/202610140007_assistant_recovery_guards.sql
supabase/migrations/202610140008_whatsapp_delivery_guards.sql
supabase/migrations/202610140009_assistant_knowledge_bounds.sql
tests/browser/chat.spec.js
tests/helpers/assistantDatabase.js
```
