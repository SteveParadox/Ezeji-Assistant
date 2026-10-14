# Developer setup and architecture: step by step

This guide is derived from the **current `main` source at documentation creation**. It is for developers using a non-production environment. See [Deployment runbook](DEPLOYMENT_RUNBOOK.md) before changing a live instance.

## 1. Prerequisites and system requirements

1. Install **Node.js 22** and npm; verify with `node --version` and `npm --version`. The Render configuration and CI workflow use Node 22.
2. Install Git, an editor, and a working network connection for `npm ci`.
3. Provision a **separate** Supabase development/staging project. You need its project URL, public anon/publishable key and backend service-role key.
4. For AI testing, obtain a development **Groq API key** and configure a permitted model.
5. For checkout integration, obtain **Paystack test-mode** credentials. Use Meta's test/testable WhatsApp setup for integration testing.
6. For isolated native PostgreSQL integration tests, install `psql` and provision a disposable database ending in `_test`. The project also contains PGlite tests.

Do not use production Supabase, Paystack live keys or a real business WhatsApp phone as a shortcut.

## 2. Download the source

```bash
git clone https://github.com/SteveParadox/Ezeji-Assistant.git
cd Ezeji-Assistant
git status
node --version
npm ci
```

If cloning an implementation branch, explicitly check it out and note its commit SHA in your test evidence. `npm ci` installs dependency versions from `package-lock.json` without rewriting it.

## 3. Create the environment file

Copy the committed example into a **gitignored local** `.env`:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Use this **minimal layout** and fill placeholders with credentials from your own development services:

```dotenv
# Browser-visible, publishable configuration
VITE_SUPABASE_URL=https://YOUR_DEV_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_DEV_ANON_KEY
VITE_API_URL=http://localhost:5174

# Server-only configuration. Never prefix any of these with VITE_.
SUPABASE_URL=https://YOUR_DEV_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_DEV_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_DEV_SERVICE_ROLE_KEY
APP_URL=http://localhost:5173
PORT=5174
GROQ_API_KEY=YOUR_DEV_GROQ_KEY
GROQ_MODEL=openai/gpt-oss-20b
PAYSTACK_SECRET_KEY=YOUR_PAYSTACK_TEST_SECRET

# Webhook/worker values only when exercising WhatsApp integration
WHATSAPP_APP_SECRET=YOUR_META_APP_SECRET
WHATSAPP_VERIFY_TOKEN=YOUR_PRIVATE_VERIFY_TOKEN
WHATSAPP_TOKEN_ENCRYPTION_KEY=64_HEX_CHARACTERS
WHATSAPP_GRAPH_VERSION=v23.0
```

`GROQ_MODEL` above follows the example file; verify that the model exists and your provider account can use it. Use a supported model if the example has been retired. You can leave provider features unconfigured while working only on static UI, but readiness and dependent calls will not pass.

**Rules:**
- `VITE_*` values are embedded into the public frontend bundle. Only publishable client configuration belongs there.
- The service-role Supabase key, Paystack secret, Groq key, WhatsApp token encryption key, provider webhook secrets and any database URLs stay on trusted server/worker infrastructure.
- Never commit `.env`, credentials or real customer payloads.
- `VITE_API_URL` must point to the correct deployed or local API base; adding `/api` depends on whether you use the Vercel catch-all route or separate Express host.

## 4. Prepare the database (in an isolated project)

1. In Supabase, open the **staging** project and inspect whether the required baseline tables/policies already exist.
2. Back up existing staging data/schema before migration. Read the [Deployment runbook](DEPLOYMENT_RUNBOOK.md#3-apply-the-database-migrations-in-order) for the exact ordered SQL file list.
3. Apply un-applied migrations **sequentially**. Do not execute all files in an arbitrary order.
4. Inspect the RLS and function grants. Business data must be accessible only by the authenticated tenant/authorized staff; server-only settlement, AI reservations and administrative functions must not be callable by anonymous clients.
5. Test the authenticated routes and RPCs with your dev credentials. Never use production records as fixture data.

The SQL directory contains the initial 2026-10-13 bootstrap and hardening migrations followed by the 2026-10-14 assistant migration series. Read historical audit files before applying those to a database already containing legacy schema.

## 5. Configure Supabase Auth callbacks

In the **Supabase Dashboard > Authentication > URL Configuration**:

1. Set the development Site URL to the correct frontend origin, normally `http://localhost:5173`.
2. Add allowed redirect URLs for `http://localhost:5173/?auth_callback=confirm` and `http://localhost:5173/?auth_callback=recovery`.
3. Keep email confirmation enabled if you are validating the production-equivalent signup flow.
4. Configure a working development SMTP/test inbox and email templates.
5. Test signup with no immediate session, confirmation link handling, orphaned-profile recovery, forgot password and password update.
6. For deployed environments repeat with the **exact** HTTPS frontend origin, not localhost.

See [docs/business-auth-repair.md](business-auth-repair.md) for the auth callback implementation and regression background.

## 6. Start the API and frontend

Use separate terminals from the repository root:

```bash
# Terminal A
node server.js
```

```bash
# Terminal B
npm run dev
```

Vite prints the frontend address (typically `http://localhost:5173`). The Express server uses `PORT` or defaults to port **5174**.

In a third terminal:

```bash
curl http://localhost:5174/health
curl http://localhost:5174/health/ready
```

A liveness response `{"status":"alive"}` proves only that the HTTP process responds. Readiness additionally checks database, billing/assistant schema and Groq configuration; a 503 response should be investigated rather than ignored.

## 7. Start optional background services

These run **independently** of the API. Only start them against your isolated development database and configured provider test accounts.

```bash
node scripts/whatsapp-worker.js
```

This is a long-running worker for claimed WhatsApp events. It needs shared Supabase credentials, a WhatsApp encryption key and Groq configuration. Stop it with Ctrl+C.

```bash
node scripts/billing-maintenance.js
node scripts/assistant-maintenance.js
```

These are **single-run** maintenance commands. For production, schedules are defined in `render.yaml`: billing every 15 minutes, assistant maintenance every minute. Do not run an uncontrolled loop or duplicate cron deployments.

## 8. Understand the request flow

```text
Browser React UI
  |-- Supabase Auth + RLS-scoped direct tables (owner profile, services, FAQs, invoices)
  |-- Express API (authenticated workspace, Paystack, assistant, staff, WhatsApp)
         |-- Supabase service-role database/RPC (server-only)
         |-- Groq (server-side text generation)
         |-- Paystack transaction verification and webhooks
         |-- Meta WhatsApp webhook -> durable event -> worker -> outbound delivery
```

Key source files:

| Source | Read it when |
| --- | --- |
| `src/NightlineApp.jsx` | Debugging auth events, routing, payment callbacks, account switching |
| `src/authScreens.jsx`, `src/authLifecycle.js` | Signup, confirm email, recovery, business setup and secure checkout |
| `src/DashboardShell.jsx`, `src/pages/` | Building or debugging workspace pages |
| `src/ChatWidgetDemo.jsx` / `src/chatWidget.jsx` | Use **`src/chatWidget.jsx`** for the current customer/owner-preview component; the first name is not a file |
| `src/AssistantInbox.jsx` | Handoff inbox, thread detail and status changes |
| `src/shared.jsx`, `src/workspaceApi.js` | Public/shared helpers, authenticated backend calls |
| `server.js` | Express mount points, Paystack handlers, health, webhook |
| `server/assistantRoutes.js` | Assistant endpoints and authorization |
| `server/assistantService.js` | Idempotent processing, sessions, reply checkpoints and history |
| `server/assistantKnowledge.js`, `assistantPolicy.js`, `assistantFacts.js` | Saved business facts, deterministic policy, truthful pricing/hours |
| `server/assistantBooking.js`, `bookingValidation.js` | Booking dialogue, time and service validation |
| `server/groqClient.js` | AI provider request limits and failures |
| `server/whatsappConnections.js`, `whatsappProcessor.js` | Credential handling and WhatsApp processing |
| `supabase/migrations/` | Schema changes and RLS/function permissions |
| `shared/planCatalog.js` | Server/client NGN pricing parity |

If changing UI code, preserve tenant identity, authentication state, saved-data write acknowledgments, secure checkout, server-read assistant facts, and booking status transitions. A frontend change is not permission to weaken a backend gate.

## 9. API route reference for debugging

These paths exist in the current API. Their presence does **not** mean unauthenticated callers have permission:

| Request | Purpose |
| --- | --- |
| `GET /health`, `GET /health/ready` | Liveness and dependency readiness |
| `GET /public-business/:businessId` | Public business facts used by a customer link |
| `POST /business/profile/ensure` | Authenticated owner provisioning |
| `POST /create-checkout-session` | Authenticated Paystack checkout attempt |
| `POST /webhooks/paystack` | Provider webhook; signature/reconciliation required |
| `GET /verify-paystack/:reference` | Owner-authorized verification of one reference |
| `POST /subscriptions/cancel-at-period-end` | Paid-term preference |
| `POST /assistant-reply` | Customer chat |
| `POST /assistant-preview` | Authenticated private preview |
| `POST /assistant-booking-request` | Confirmed customer booking request submission |
| `GET/DELETE /assistant-session/:businessId` | Customer session history/deletion via session token |
| `GET/DELETE /assistant-preview/session/:businessId` | Owner preview session history/deletion |
| `GET/PATCH /assistant-settings/:businessId` | Owner assistant policies/activation |
| `GET /assistant-metrics/:businessId` | Authorized assistant metrics |
| `GET /assistant-inbox/:businessId` | Authorized conversation inbox |
| `GET/PATCH /assistant-inbox/:businessId/:threadId` | Thread history and handoff status |
| `GET /staff/me`, `GET /staff/memberships`, `GET /staff` | Membership and staff management |
| `POST /staff/invite`, `POST /staff/accept`, `DELETE /staff/:id` | Staff lifecycle |
| `GET/PUT/DELETE /integrations/whatsapp` | Authorized WhatsApp connection configuration |
| `GET/POST /webhook/whatsapp` | Meta verification and signed inbound events |

**Never bypass authentication, signature validation, session-token requirements or server-derived business identity** to “make a test pass.” Refer to the handler for exact body fields and status responses.

## 10. Run checks after each change

```bash
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Browser tests use fixture/intercepted providers in `tests/browser/`. Passing fixture tests **does not** prove Supabase deployed RLS, real Paystack settlement, live Groq behavior or WhatsApp delivery. Detailed test scenarios are in [Testing and release](TESTING_AND_RELEASE.md).

## 11. Safe contribution workflow

1. Create a branch from the **current `main`**.
2. Make one focused change with a regression test for each corrected bug.
3. Run static, unit, build and relevant browser checks.
4. Document any environment you could not execute, rather than claiming success.
5. Update docs if an API, page, setting, plan or deployment step changes.
6. Open a PR; attach test evidence, migration impact and explicit secrets/tenant/billing risks.
7. Do not merge with failing checks or unresolved high-severity authorization/payment problems.
