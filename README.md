# React + Vite

## Deployment

Deploy the frontend to Vercel and the Express backend to Render (or another Node host).

### Vercel

Set these Vercel environment variables before deploying:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL=https://your-render-api.onrender.com
```

Build command: `npm run build`

### Backend

Set the variables from `.env.example` in the backend host. Keep secret keys there only:

```text
GROQ_API_KEY
GROQ_MODEL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_URL=https://your-vercel-domain.vercel.app
```

After deployment, put the backend URL into Vercel as `VITE_API_URL`, then redeploy the frontend.

Run `supabase/invoices.sql` and `supabase/staff_access.sql` in the Supabase SQL Editor before enabling payment webhooks or staff invitations.

Staff invitations use Supabase Auth email delivery. Keep `SUPABASE_SERVICE_ROLE_KEY` on the server only; never prefix it with `VITE_`. Configure Supabase Auth email delivery and allow the production `APP_URL` as a redirect URL before sending invitations. For the Vercel API route in this project, set `VITE_API_URL` to `https://your-vercel-domain.vercel.app/api` and `APP_URL` to `https://your-vercel-domain.vercel.app`.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
