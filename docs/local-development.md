# Local development guide

Everything runs locally. **Nothing here contacts a real payment provider, sends a real message or deploys anything.**

## Start

1. `pnpm install` (uses the lockfile).
2. `pnpm db:start` starts the local Supabase stack (Docker) and the local mail sink. If the Docker daemon is dead between sessions: `(pkill containerd; rm -f /var/run/docker.sock); pnpm db:start`.
3. `pnpm db:reset` applies every migration and the **development seed** (`supabase/seed.sql`: fictional vendors and delivery points with synthetic coordinates; clearly not real data and not part of the migrations).
4. Copy `.env.example` to `.env.local` and fill in the values printed by `pnpm exec supabase status -o env`.
5. `pnpm dev` (or `pnpm build && pnpm start`).

## Environment variables

| Variable                                                                                                                                                                                                                                 | Needed for                | Notes                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`                                                                                                                                                      | **Basic startup**         | Local stack values. The service-role key is server only and never reaches the browser.                                                                |
| `DATABASE_URL`                                                                                                                                                                                                                           | Database tests only       | Local Postgres URL.                                                                                                                                   |
| `MAIL_SINK_URL`                                                                                                                                                                                                                          | End-to-end tests          | Local mail sink that receives sign-up emails.                                                                                                         |
| `APP_ENV`                                                                                                                                                                                                                                | **Basic startup**         | `local` enables simulations (mock pay button, fake refund provider, fake routing). Anything else, or unset, behaves like production and fails closed. |
| `PICKUP_CODE_SECRET`                                                                                                                                                                                                                     | Pickup codes              | 32+ random characters; without it pickup codes are unavailable. Never commit a real value.                                                            |
| `JOBS_SECRET`                                                                                                                                                                                                                            | Job routes and monitoring | Bearer secret for `/api/jobs/*`.                                                                                                                      |
| `PAYSTACK_SECRET_KEY`                                                                                                                                                                                                                    | Online payment (optional) | Test keys (`sk_test_...`) only; live keys are rejected. Leave unset to disable online payment.                                                        |
| `PAYSTACK_BASE_URL`                                                                                                                                                                                                                      | Local payment simulation  | Honoured only when `APP_ENV=local`; points at `scripts/fake-paystack.mjs`.                                                                            |
| `JOBS_BASE_URL`, `JOBS_ALLOW_REMOTE`                                                                                                                                                                                                     | Local job runner          | The runner refuses non-local targets.                                                                                                                 |
| `PLAYWRIGHT_CHROMIUM_PATH`                                                                                                                                                                                                               | Browser tests (optional)  |                                                                                                                                                       |
| No variable uses the `NEXT_PUBLIC_` prefix. No production value belongs in `.env.example`. Production-only needs (hosting, domain, real provider credentials, scheduler secrets) are **not configured and not documented as available**. |

## What is simulated

| Area             | Local behaviour                                                                                | Real behaviour                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Payments         | Mock pay button (`APP_ENV=local` and database flag) or the fake Paystack (`pnpm dev:paystack`) | Test-mode Paystack needs your test key and approval; live is out of scope |
| Refund execution | FAKE provider only, labelled "no money moved"                                                  | Not implemented                                                           |
| Payouts          | Not enabled; the vendor page shows calculated amounts only                                     | Needs decisions and approvals                                             |
| Notifications    | In-app rows, plus an optional copy written to a local test sink                                | No real email, SMS or push is sent                                        |
| Routing and map  | Fake routing provider, synthetic coordinates                                                   | Mapping provider undecided                                                |
| GPS              | Browser geolocation in the rider area, synthetic delivery points                               | Real-device Android behaviour unverified                                  |
| Scheduling       | `pnpm jobs:once` / `node scripts/run-jobs.mjs loop` (local only)                               | No production scheduler exists                                            |

## Jobs

`pnpm jobs:once` runs expiry, notification processing and the location purge once against the local app; `pnpm jobs:check` reads job health. `/admin/jobs` shows health, never-run/stale/failed jobs and **dead notifications with the controlled requeue** (administrators only, reason required, limits and audit).

## Checks

`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit), `pnpm test:db` (after `pnpm db:reset`), `pnpm build`, `pnpm check:secrets`, `pnpm audit --prod`, `pnpm test:e2e` (about 13 minutes).
