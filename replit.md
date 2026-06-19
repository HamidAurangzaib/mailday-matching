# MailDay Matching

Internal admin web app for managing pen pal matching in a children's subscription box business.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/mailday run dev` — run the React frontend (port 21780)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `RECHARGE_API_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`
- Optional env: `SLACK_WEBHOOK` — Slack notifications (daily digest, Friday reminder, weekly summary, monthly pack delivery auto-create)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`) — port 8080, path prefix `/api`
- Frontend: React + Vite + Wouter + TanStack Query + Tailwind v4 (`artifacts/mailday`) — port 21780, path prefix `/`
- DB: Supabase (PostgreSQL via supabase-js client) — NOT Replit's managed postgres
- Validation: Zod (`zod/v4`), drizzle-zod
- API codegen: Orval (from OpenAPI spec in `lib/api-spec`)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/routes/` — all Express route handlers (one file per feature)
- `artifacts/api-server/src/routes/index.ts` — router registry (mount all routes here)
- `artifacts/api-server/src/routes/slack.ts` — Slack notifications + cron scheduler
- `artifacts/mailday/src/pages/` — React page components (one per route)
- `artifacts/mailday/src/App.tsx` — client-side routing (Wouter)
- `artifacts/mailday/src/components/layout.tsx` — sidebar nav + layout shell
- `lib/api-spec/` — OpenAPI spec (source of truth for API contracts)
- `scripts/src/` — utility scripts
- `supabase-migration.sql` — **SQL migration to run in Supabase SQL editor** for Feature 1 + 2 tables

## Architecture decisions

- All data lives in Supabase (not the Replit-managed postgres). `DATABASE_URL` / `PGHOST` etc. point to an empty Replit DB and are unused.
- Supabase is accessed via the `@supabase/supabase-js` client using `SUPABASE_SERVICE_ROLE_KEY` on the server.
- The shared reverse proxy routes `/api/*` to the API server and `/` to the Vite frontend — no cross-origin issues.
- Auth is session-based (express-session + bcrypt) with roles: `admin`, `va`.
- Commission owed = `conversions × revenue_per_conversion × (commission_rate / 100)` — recalculated on every influencer save.

## Product

- **Dashboard** — overview of matching queue, action items, health, revenue, subscribers, and growth (influencer stats)
- **Matching** — pen pal queue, match sessions, guarantee tracking (admin only)
- **Members** — child and parent profiles, health status, onboarding, cancellations
- **Give a Key** — scholarship program (applications, tasks, GAK fund, receipts, donations)
- **Influencer Tracker** — affiliate partner management with outreach status, conversions, commissions (admin only)
- **Pack Delivery Tracker** — monthly delivery log with failure tracking and resolution (admin + VA)
- **Action Items** — inbox of pending tasks surfaced from all features
- **Slack scheduler** — daily digest 7am, Friday reminder 8am, weekly summary 8am Sun, monthly pack delivery auto-create 6am on the 1st (all Mountain Time)

## User preferences

- Never use `console.log` in server code — use `req.log` in route handlers, `logger` singleton elsewhere.
- VA role can see Pack Delivery Tracker but NOT Cancellation Tracker or Influencer Tracker.
- Commission owed formula: `conversions × revenue_per_conversion × (commission_rate / 100)`.
- `revenue_per_conversion` defaults to 14.00 per influencer record.

## Gotchas

- **DATABASE_URL points to empty Replit postgres** — all app queries must use the supabase-js client, not Drizzle ORM.
- New Supabase tables require running `supabase-migration.sql` manually in the Supabase SQL editor — the server has no migration tool that can reach Supabase.
- `SLACK_WEBHOOK` env var (not `SLACK_WEBHOOK_URL`) — the scheduler silently skips if missing.
- Pack delivery `UNIQUE(month_number, year)` constraint prevents duplicate auto-creates.
- Influencer stats endpoint (`GET /api/influencers/stats`) is used on the dashboard — if the Supabase tables don't exist yet, it will 500 silently (dashboard query has `retry: false`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Supabase project: `https://wqepgxxsipztfzkldiix.supabase.co`
- Supabase SQL editor: `https://supabase.com/dashboard/project/wqepgxxsipztfzkldiix/sql/new`
