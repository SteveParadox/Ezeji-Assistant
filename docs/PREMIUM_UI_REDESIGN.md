# Ezeji Assistant premium UI redesign

This change continues draft PR #6 on `codex/ezeji-complete-frontend-overhaul`, from commit `38ef2065ab45bb45818744d5e7fc442f7e313dd5`. Main was inspected at `02a24dc183f10bcecdf129c7e600eaee69f76407`. Earlier auth, checkout, tenant, and assistant corrections on that branch were retained.

## Product changes

- A persistent desktop sidebar, grouped navigation, real business identity, compact workspace header, skip link, and native mobile navigation dialog replace the mixed dashboard layout. Staff navigation uses the existing authorized tab list.
- Overview brings conversation counts, escalations, actual quota consumption/reservations, recent messages, booking requests, and configuration shortcuts together. Failed reads show an unavailable state instead of invented zero metrics. Non-escalation is never presented as proof of resolution.
- Getting Started has a compact saved-data progress summary and numbered required/optional cards. Selected paid plans remain local intent; essential saved configuration and authenticated checkout are still required.
- AI Settings combines configuration and a private, authenticated preview. Preview cannot create operational records and now also cannot read, delete, or write the customer's local chat history.
- Conversations supports search within the latest 50 saved exchanges, escalation filtering, selection by stable ID, readable read-only messages, and the existing complete CSV export.
- Bookings supports customer/service/date search, status filtering, native confirmation dialogs, and server-verified visible status updates. Failed updates preserve pending status. Canceled records remain available.
- Profile fields have identity, public contact, and assistant-context sections. Weekly hours have labeled time inputs, closed/open controls, and a coordinated location/timezone section; missing schedules receive no invented opening times.
- Services, FAQs, staff, integrations, analytics, and billing share the same table, form, card, feedback, and confirmation patterns. FAQs retain unfinished input through deletion dialogs. Charts load all query pages and expose actual values, selected reporting period, and empty/error states.
- Billing separates plan purchase controls from real invoices, distinguishes pending/expired/active access, and explains NGN one-time purchases and no automatic renewal. Missing trial expiry data is not replaced by a fresh trial.
- Landing has a balanced hero and explicitly illustrative product preview, deliberate feature layout, five-step journey, backend-catalog pricing, and accessible mobile navigation. Guest users cannot copy a businessless chat link. No testimonials, operational statuses, or performance guarantees were fabricated.
- Authentication uses consistent cards, labels, autofill hints, and native keyboard form submission, retaining four-field signup, email confirmation, recovery, account provisioning, and exact-reference payment verification.

## Design system and structure

`src/designTokens.css` is the authoritative palette and scale. All ten requested colors are unchanged. Secondary text is used for readable labels instead of the lower-contrast decorative muted token. Amber remains the primary action color; semantic success/error colors remain green/red. Font fallbacks are available without external font services.

| Area | Files/components |
| --- | --- |
| Tokens and shared presentation | `src/designTokens.css`, `src/appStyles.css`, `src/workspace.css`, `src/ui.jsx`, `src/dialogFocus.js`, `src/shared.jsx`, `src/index.css` |
| Navigation and composition | `src/DashboardShell.jsx`, `src/dashboardPages.jsx`, `src/NightlineApp.jsx`, `src/App.jsx`, `src/main.jsx` |
| Lazy workspace modules | `src/pages/OverviewPage.jsx`, `BusinessProfilePage.jsx`, `FAQsPage.jsx`, `ServicesPage.jsx`, `HoursLocationPage.jsx`, `AISettingsPage.jsx`, `StaffPage.jsx`, `BookingsPage.jsx`, `ConversationsPage.jsx`, `AnalyticsPage.jsx`, `IntegrationsPage.jsx`, `BillingPage.jsx` |
| Marketing | `src/NightlineLanding.jsx`, `src/marketing.css`, `src/marketingPolish.css`, `index.html` |
| Auth, setup and chat | `src/authScreens.jsx`, `src/gettingStarted.jsx`, `src/chatWidget.jsx`, `src/signedInUser.js` |
| Query/filter helpers | `src/workspaceApi.js`, `src/workspaceFilters.js` |
| Owner quota read | `server/ownerUsage.js`, `server.js` |
| Tests and reproducible browser runner | `server/ownerUsage.test.js`, `src/workspaceFilters.test.js`, `tests/browser/fixtures.js`, `tests/browser/workspace.spec.js`, `tests/browser/marketing-auth.spec.js`, `playwright.config.js`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml` |

The monolithic workspace page file now contains only lazy module mapping. Each page keeps its own saved-data behavior. Existing routing, role restrictions, pricing catalog, database schema, subscription settlement, reservation RPC, and backend write contracts remain authoritative. Unused starter/utility styles (`src/App.css`, `src/NightlineLanding.css`) were removed. Marketing styles are scoped so returning from the landing page does not change dashboard components.

Shared primitives include native focus-contained confirmations, native navigation drawers, form sections/fields, statuses, skeletons, empty states, stat cards, progress bars, scrollable semantic tables, search/filter controls, and consistent buttons/focus indicators. Reduced-motion preferences disable animation and transitions. Forms use 16px inputs on narrow screens and controls support practical touch targets.

## Narrow backend correction

The previous dashboard estimated AI usage from conversation rows. Private previews also consume allowance, so those counts could understate quota use. `GET /owner/ai-usage` reads the existing `usage_periods` ledger, with a validated Supabase bearer token and a tenant ID taken only from that identity. It exposes consumed/reserved counts for `trial` or the current UTC month. It accepts no caller-selected tenant and performs no writes or entitlement changes. Authentication, staff-without-owner rejection, forged tenant input, trial/UTC periods, and query-error behavior have focused tests.

## Validation

| Command | Actual result |
| --- | --- |
| `npm ci` | Passed; clean install from the final lockfile |
| `npm run lint` | Passed with warnings (existing mixed-export/unused-variable warnings and the shared confirmation-hook export warning); no lint errors |
| `npm test` | 109 tests: 107 passed, 2 database integration tests skipped, 0 failed |
| `npm run build` | Passed; 13 workspace pages load as separate chunks; initial JS 491.08 kB / 141.14 kB gzip, versus 562.74 kB / 155.70 kB gzip before the redesign |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/ezeji-chromium npm run test:browser` | Final complete run: 38 passed, 0 failed, 3.5 minutes |
| `node --check server.js`, `node --check server/ownerUsage.js`, `git diff --check` | Passed |

The final browser run includes all eight required widths, all 13 workspace pages, landing/signup, auth and recovery, onboarding, CRUD/error preservation, bookings, staff restrictions, preview isolation, payment states, browser navigation, explicit dialog focus loops, stale-confirmation cancellation, palette preservation and automated WCAG A/AA checks. Automated accessibility checks found no violations in the tested landing, signup and workspace states; this is not a certification or a replacement for assistive-technology/device testing.

Representative screenshots were reviewed and stored with lossless, pixel-identical encoding:

- [Desktop dashboard](screenshots/dashboard-desktop.webp)
- [Mobile dashboard](screenshots/dashboard-mobile.webp)
- [Desktop landing](screenshots/landing-desktop.webp)
- [Mobile landing](screenshots/landing-mobile.webp)

These screenshots contain explicitly controlled test data, not real customer records.

The corrective pass fixed an implicit-submit password-recovery button, native drawer Tab boundaries, private preview touching customer local history, stale confirmation requests after leaving a page, misleading zero/"resolved" states, and missing trial expiry fallback. Supabase transient-error tests wait for its bounded retries; logout is verified against the application's existing return-to-landing behavior and cleared session storage.

Browser tests use the actual React app with explicit intercepted Supabase/provider fixtures. This verifies presentation and client interactions, not live provider settlement, deployed RLS, or delivery to customers. No test fixture is imported by production application code.

The browser suite covers all 13 workspace pages at 320, 375, 390, 430, 768, 1024, 1440, and 1920px; landing and signup at the same widths; keyboard/mobile drawers and focus; auth submission/recovery; setup readiness; services/FAQ writes and failed deletion; operating hours; pending/settled payment reference handling; staff restrictions; inbox filtering; booking confirmation and rejected saves; private-preview persistence isolation; back/refresh/logout; palette preservation; and automated WCAG A/AA checks of landing, signup and all workspace pages.

The normal `npx playwright install chromium` download returned invalid archives in this environment. Browser verification uses a locally extracted Chromium 153 executable via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The repository does not depend on that temporary executable; CI installs standard Playwright Chromium and runs `npm run test:browser`, then uploads traces, screenshots and reports.

## Release and deployment gate

Keep PR #6 in draft and do not merge yet. Local fixture-based checks do not replace:

1. Disposable real PostgreSQL migration/settlement tests (the existing two integration tests require `psql` and an isolated database ending `_test`).
2. Supabase email confirmation/recovery redirect configuration, deployed RLS and real multi-tenant checks.
3. Paystack test-mode charge, webhook/reconciliation and concurrency verification against the deployed settlement RPC.
4. Live Groq preview/quota accounting and Meta WhatsApp credential/webhook/delivery verification.
5. Successful GitHub Actions application and browser jobs for the resulting commit.
6. Manual native iOS/Android keyboard and assistive-technology verification. The local browser run used Chromium, not physical mobile devices.

Deploy backend and frontend together for the owner quota read endpoint. Apply the previously required quota/subscription migrations; this redesign adds no migration. Continue using the existing configured `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, auth redirect URLs, and HTTPS webhook configuration. Run `npm run build` for deployment; generated `dist` output is not the reviewed source.
