# Frontend UI/UX corrective audit (13 October 2026)

Repository: `SteveParadox/Ezeji-Assistant`  
PR: https://github.com/SteveParadox/Ezeji-Assistant/pull/6  
Branch: `codex/ezeji-complete-frontend-overhaul`  
Release recommendation: **keep draft / do not merge**

## Confirmed post-redesign defects and corrections

| Priority | Issue | Correction | Regression evidence |
|---|---|---|---|
| P1 | Business Profile exposed an editable `Hours` summary that contradicted the validated weekly schedule and could silently fail to persist | `buildBusinessProfileUpdate` preserves `current.hours`; profile renders saved hours read-only and links to Hours & Location | `src/businessProfileFields.test.js`, browser navigation test |
| P1 | Fresh businesses with `hours_json=[]` had zero rows in the Hours & Location editor, so no day could be configured | `buildWeeklySchedule` now fills all seven days with **blank, closed** missing days and keeps existing saved times on partial weeks | `src/workingHours.test.js`, browser empty-schedule test |
| P1 | A connection verification and WhatsApp disconnect could run concurrently, leaving the UI showing a false connection state | In-flight operation ref prevents overlap and both controls disable until the request resolves; connection status does not imply live webhook delivery | New browser delayed-PUT test |
| P1 | A booking update could return HTTP success but unchanged/mismatched row; the UI had no error despite a status not actually changing | Require matching saved booking ID and exact requested status before acknowledging an update | New browser stale-success response test |
| P2 | Lazy-loaded page failures rendered a global crash message exposing internal exception details and offered no recovery action | Application error screen now shows generic failure text, Reload and Homepage actions in preserved brand colors | Source inspected; browser failure-injection still required |

Earlier PR corrections covering checkout verification, auth isolation, private AI preview, factual fallback, and shared catalog prices remain in place.

## Source verification performed

- Executed **7/7 targeted JavaScript function assertions** against source fetched from this branch, including the empty-week onboarding case, partial-week preservation, times validation, and preventing unvalidated profile edits from overwriting saved hours.
- Inspected relative import targets across twelve relevant React entrypoints/pages; **no missing local module paths** were found.
- The browser tests added here exercise real components against explicit simulated Supabase/API responses but **were not executed in this audit runtime**.
- No production credentials were used or changed. No database migrations were applied.
- Palette colors were not changed.

## Release blockers

GitHub Actions still reports failed application/browser runs on the latest checked commits; fetched job results have `steps: null` and no usable log URL. Do not assert that application code or tests were proven to fail from this alone, and do not call CI green.

Before merging, run:
```bash
npm ci
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser
```

Verify the new browser regressions against a real Chrome/Chromium installation, then complete the documented Supabase RLS, Paystack, AI provider, Meta WhatsApp and mobile-device release gates. Keep PR #6 open as a draft until all critical checks are satisfied.
