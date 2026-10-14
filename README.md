# Ezeji Assistant

Ezeji Assistant is a React/Vite business workspace with a Node.js/Express API, Supabase Auth/PostgreSQL, server-grounded AI assistance via Groq, Paystack NGN checkout, customer web chat, booking-request handling, staff access, and optional Meta WhatsApp integration.

**Implementation is not proof of production readiness.** Before taking real payments or handling customer data, follow the staging, security and provider-verification gates in the [deployment runbook](docs/DEPLOYMENT_RUNBOOK.md). The `/health` endpoint is a liveness response, not a deployment sign-off.

## Documentation: choose your path

| What you need | Step-by-step guide |
| --- | --- |
| Register a business and use every workspace page | [Business owner and staff guide](docs/USER_GUIDE.md) |
| Install the repo, configure development env, and understand the code | [Developer setup and architecture](docs/DEVELOPER_SETUP.md) |
| Prepare Supabase migrations, set up Auth/Paystack/Groq/WhatsApp, deploy Vercel + Render | [Staging and deployment runbook](docs/DEPLOYMENT_RUNBOOK.md) |
| Operate jobs, investigate payments, recover assistant requests, rotate secrets, handle incidents | [Operations and troubleshooting](docs/OPERATIONS_TROUBLESHOOTING.md) |
| Run unit, browser, database, and provider acceptance tests | [Testing and release checklist](docs/TESTING_AND_RELEASE.md) |

For architecture/history and historical audit findings, see [assistant implementation report](docs/ASSISTANT_IMPLEMENTATION_REPORT.md), [UI redesign](docs/PREMIUM_UI_REDESIGN.md), and [post-implementation corrective audit](docs/ASSISTANT_CORRECTIVE_AUDIT_20261014.md). Those reports describe specific points in time; **current source code and migrations take precedence**.

## Local quick start (development only)

**Prerequisites:** Node.js 22, npm, and configured Supabase project. Running just the frontend will not make checkout, web chat, or assistant features work.

```bash
git clone https://github.com/SteveParadox/Ezeji-Assistant.git
cd Ezeji-Assistant
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Edit `.env`: set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL=http://localhost:5174` and the backend `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; configure Groq and Paystack test credentials for their features. These are **placeholders** until you supply real development secrets. Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY` under a `VITE_` name.

Start two terminals:

```bash
# Terminal 1: API
node server.js

# Terminal 2: web app
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). From another terminal:

```bash
curl http://localhost:5174/health
curl http://localhost:5174/health/ready
npm run lint
npm test
npm run build
```

`/health/ready` returns non-200 while required database/assistant dependencies are missing. That is expected until the development schema and credentials are configured. Full DB setup and the isolated tests are documented separately; **do not point test database variables at production**.

## Important system behavior

- Business email confirmation and account provisioning must complete before authenticated checkout.
- Trial/paid entitlements and AI usage are determined server-side, not by changing browser-visible plan values.
- Paystack browser return URLs **do not prove payment**. Only verified provider transaction reconciliation and committed database settlement activate a paid term.
- AI preview is owner-authenticated and separate from customer conversations; successful generated preview replies can consume quota.
- Customer booking requests are not automatically guaranteed appointments. Confirm/decline them according to the saved status and business availability.
- WhatsApp credential storage is not proof of webhook delivery. A deployed HTTPS callback, Meta verification, event subscriptions and running worker are additionally required.
- Sensitive provider keys live on the API/worker/cron hosts only; `VITE_*` is compiled into the public frontend.

## Repository map

| Location | Responsibility |
| --- | --- |
| `src/NightlineApp.jsx`, `src/authScreens.jsx`, `src/authLifecycle.js` | Auth, onboarding, routing and checkout return |
| `src/DashboardShell.jsx`, `src/pages/`, `src/ui.jsx` | Workspace, settings and visual components |
| `src/chatWidget.jsx`, `src/AssistantInbox.jsx` | Customer chat/preview and owner conversation handoff UI |
| `server.js`, `server/` | API, payment reconciliation, business facts, AI processing, staff and WhatsApp |
| `shared/planCatalog.js` | NGN/kobo pricing catalog shared with checkout |
| `supabase/migrations/` | Ordered SQL schema, security and assistant changes |
| `scripts/` | Billing cron, assistant maintenance and WhatsApp worker |
| `tests/browser/` | Playwright browser journeys |
| `render.yaml`, `api/[...path].js` | Render services and optional Vercel API routing |

## Support and contribution

First check the [troubleshooting guide](docs/OPERATIONS_TROUBLESHOOTING.md). When reporting a reproducible bug, provide the screen or API path, reproduction steps, expected versus actual behavior, browser/version, sanitized request ID, and relevant redacted logs. **Never post tokens, credentials, private customer messages, or full authorization headers in an issue.**
