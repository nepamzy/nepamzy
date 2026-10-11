# Environment variables

All values below are LOCAL development values for the local Supabase stack. Never commit real values. The browser never talks to Supabase: no `NEXT_PUBLIC_` variables are used (a unit test enforces this).

| Variable                    | Used by                                     | Secret?    | Notes                                                                                                |
| --------------------------- | ------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `SITE_URL`                  | server                                      | no         | Origin for auth redirect links                                                                       |
| `SUPABASE_URL`              | server, proxy                               | no         | Local: `http://127.0.0.1:54321`                                                                      |
| `SUPABASE_PUBLISHABLE_KEY`  | server, proxy                               | low        | Publishable key (acts as anon). Server-side only here                                                |
| `SUPABASE_SERVICE_ROLE_KEY` | server only (`src/lib/supabase/service.ts`) | **yes**    | Bypasses RLS. Used for rate limiting and security events only. Checked absent from the client bundle |
| `DATABASE_URL`              | DB tests                                    | local only | Direct Postgres URL of the local stack                                                               |
| `MAIL_SINK_URL`             | e2e                                         | no         | Local mail sink HTTP endpoint                                                                        |

Get local values: `./node_modules/.bin/supabase status -o env` (map `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`, `DB_URL`). `src/lib/env.ts` validates with zod, fails fast and reports variable names only.

Dev-script env: `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` (set by `scripts/*.sh`), `PLAYWRIGHT_CHROMIUM_PATH` (optional).

## `APP_ENV` (Batch 2)

`APP_ENV` = `local` | `staging` | `production`. Anything else, or unset, is treated as `production` (fail closed). The test-payment action exists only when `APP_ENV=local` **and** the database setting `mock_payments_enabled` is true (set only by `supabase/seed.sql`, i.e. local resets). `.env.example` documents it.
