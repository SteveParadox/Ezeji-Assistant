# Ezeji Assistant PR #6 - corrective implementation audit

Date: 2026-10-13  
Repository: `SteveParadox/Ezeji-Assistant`  
PR: https://github.com/SteveParadox/Ezeji-Assistant/pull/6  
Base: `main` (`02a24dc183f10bcecdf129c7e600eaee69f76407`)  
Working branch: `codex/ezeji-complete-frontend-overhaul`  
Decision: **DRAFT / DO NOT MERGE YET**

## Audit goal

Review the first implementation of the frontend overhaul for regressions, data leaks, misleading states, tenant-boundary failures, inconsistent AI preview/live behavior, incorrect checkout handling and security-sensitive gaps. Apply verified source corrections to the actual PR branch. This does not claim completion of the 23-phase original master assignment.

## Defects found and source corrections

| Severity | Discovery | Corrective implementation |
| --- | --- | --- |
| P0 | Paystack callback could be cleared merely because a prior same-plan subscription was active, without proving the returned reference settled | `src/NightlineApp.jsx` now always opens pending verification on `checkout=success`. `src/paymentConfirmation.js` requires an exact backend response of `verified: true, status: paid` before tracking is removed. |
| P0 | Leaving the pending-payment screen cleared the checkout reference and plan selection before settlement | Navigating to Billing preserves unresolved checkout state. Missing references produce a recovery error rather than fake success. |
| P1 | If browser plan-selection storage was lost, a correctly verified checkout could remain pending forever | Accept a server-verified receipt followed by an active paid entitlement, even with no local plan choice. |
| P1 | Missing/invalid public customer chat links could display the authenticated owner's business | Require a matching, fetched public business record; otherwise show an error and **no widget**. |
| P1 | AI requests included the newest customer message twice, once as history and again as current message | `src/chatRequest.js` builds history exclusively from prior turns. |
| P1 | An in-flight AI response could append to the wrong business after account switching, or reappear after chat clearing | The widget invalidates request generations on scope changes and clear actions, and prevents concurrent sends. Dashboard pages remount on tenant/tab changes. |
| P1 | Owner preview used saved personality settings that the live customer endpoint ignored | `server/assistantPrompt.js` is now used by both authenticated preview and live customer requests with saved business facts and common instructions. |
| P1 | Trial/Starter preview could consume saved premium personality settings | Shared server prompt applies Professional/Business-only personality gating. The existing quota RPC separately checks actual subscription entitlement. |
| P1 | Live AI instructions could suggest an automatic staff handoff that is not yet implemented | Prompt now asks customers to contact staff directly and explicitly forbids promising automatic handoff. |
| P1 | Independent pricing literals could cause landing/display prices to diverge from Paystack checkout amounts | `shared/planCatalog.js` supplies immutable integer-kobo amounts to both server checkout and frontend pricing. A parity test covers monthly and yearly values. |
| P1 | FAQ/service deletion showed success despite database deleting no row under RLS | Deletion now requests the affected row ID from the DB and removes the UI row only after confirming it matches. |
| P1 | New accounts could receive invented opening times, and an all-closed schedule could count as ready | New days begin closed with blank times; opening times must be configured. The setup progress now requires an open day. |
| P1 | Selected paid plans could send a new account straight into checkout before real services/hours were configured | Pending paid choices resume in the database-driven getting-started checklist, and checkout is offered after required saved setup information is present. |
| P2 | Browser Back/Forward changed URL without reliably changing dashboard view | Added URL-mode handling for dashboard, landing and public chat navigation. |
| P2 | Offline fallback could advertise made-up prices and hours | Responses now state when business facts are unavailable, without numeric guesses. |
| P2 | Landing demo claimed AI was online and guaranteed always-on answers or automatic staff involvement | Marketing and demo copy now distinguishes illustration and supported product behavior. |
| P2 | Password show/hide button was unlabeled for assistive technology | Accessible name and pressed-state attributes added. |

## Test additions and execution

Tests added or updated:
- `src/chatRequest.test.js`: prior-only history and business ID isolation
- `src/chatSafety.test.js`: no invented offline opening hours or prices
- `src/onboardingState.test.js`: incomplete setup, staff exclusion and all-closed hours
- `src/workingHours.test.js`: missing time normalization, invalid time rejection
- `src/paymentConfirmation.test.js`: do not treat redirects, pending status or historical entitlements as payment proof
- `src/planCatalogParity.test.js`: every backend price matches frontend Naira display
- `server/assistantPrompt.test.js`: common factual prompt, premium configuration restrictions and no fictional facts
- Existing signup, navigation, preview, payment and backend tests remain present.

**What was executed:** 19/19 focused assertions against the actual fetched pure JavaScript source functions passed in a V8 evaluation environment. Additional `new Function` syntax checks passed for changed pure JavaScript modules and `server.js` after removing import/export syntax for inspection. These are **not** equivalent to running `npm test`, `npm run lint`, `npm run build` or browser E2E.

**CI situation:** GitHub Actions run [38437031376](https://github.com/SteveParadox/Ezeji-Assistant/actions/runs/38437031376), checked during this audit, was marked `failure` and returned an application job with **zero available steps** and no useful job logs through the connected GitHub interface. Re-run checks and investigate Actions runner/start failures before claiming code validation. Later branch pushes may create more runs.

## Security and correctness boundaries retained

- Paystack server reference and atomic settlement remain authoritative.
- No frontend control may activate a subscription by changing local plan storage.
- Owner preview requires Supabase authentication, matches the logged-in owner to the business, and uses the existing tenant/global AI usage reservation RPC.
- Preview does not persist customer conversations or bookings.
- The customer widget must not use another account's private business data as fallback.
- Staff tab filtering is not authorization: backend endpoint permissions and RLS remain mandatory.

## Unverified and remaining work

1. Real isolated Supabase migrations, RLS and multi-tenant tests, including account switching and failure injection.
2. Real Paystack test-mode checkout: new payment, same-plan renewal, callback refresh, missed webhook, pending status, settlement concurrency, amount mismatch and failed invoice persistence.
3. Groq preview/live parity using actual saved FAQs, services, hours and premium settings, plus quota accounting and failure recovery.
4. Playwright user journeys at desktop and mobile widths, keyboard accessibility and focus-trap verification.
5. Actual WhatsApp Meta setup and webhook testing, workers, replay/order recovery and connection health.
6. Full eight-step, resumable onboarding persistence (current branch provides a checklist and separated settings screens, **not** the complete wizard).
7. Server-authoritative operational assistant activation and verified connection health, rather than a frontend-only toggle.
8. Full booking/rescheduling, conversation inbox and multi-business staff testing.
9. Performance, bundle-size, visual screenshot, and deployment checks.

## Release gate

Do not mark the PR ready, or merge into `main`, until the complete checks run successfully with evidence, high-severity regressions are addressed, production migrations are verified against a safe environment, and the scope of unfinished master-prompt requirements is explicitly decided.
