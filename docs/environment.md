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

## Payments and jobs (Batch 3)

| Variable              | Purpose                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PAYSTACK_SECRET_KEY` | Paystack **test** secret (`sk_test_...`). Unset or any other value disables online payment. Also signs/verifies webhooks. |
| `PAYSTACK_BASE_URL`   | Local fake provider (`http://127.0.0.1:3002`). Ignored unless `APP_ENV=local`.                                            |
| `JOBS_SECRET`         | Bearer secret for `POST /api/jobs/expire-orders` (16+ characters).                                                        |

`pnpm dev:paystack` starts the fake provider (`scripts/fake-paystack.mjs`); `bash scripts/make-env-local.sh` writes `.env.local` from the running local stack.

## Pickup secret (Batch 4)

| Variable             | Purpose                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PICKUP_CODE_SECRET` | Server-only HMAC secret for customer pickup codes. 32+ random characters. Missing/short/placeholder values make pickup codes unavailable (no fallback). `scripts/make-env-local.sh` generates a random local value; never commit a real one and never paste one into chat. |

The scheduler routes are `POST /api/jobs/expire-orders` and `POST /api/jobs/purge-location` (both `Authorization: Bearer $JOBS_SECRET`).

## Batch 6

No new variable was introduced. `JOBS_SECRET` now guards all three job routes (`expire-orders`, `purge-location`, `process-notifications`); `/api/health` needs no secret. Nothing in the repository sends mail, SMS or push: the notification "copy" channel is a local sink. `.env.example` is unchanged.

## Operator alert e-mails

Optional. When all three variables are set, the server e-mails the owner a short plain-text alert for each of: new sign-up (e-mail masked), vendor application, rider application, new order, payment result (paid, late, mismatch, duplicate, failed), refund request, return request and support report. Nothing is sent, and nothing breaks, when any variable is missing.

| Variable                | Purpose                                                                                                       | Secret? |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------- |
| `BREVO_API_KEY`         | Brevo API key (Brevo, SMTP & API, API Keys; starts `xkeysib-`). Used only server-side as the `api-key` header | **yes** |
| `ADMIN_ALERT_TO`        | Where alerts are delivered (the owner's admin mailbox)                                                        | no      |
| `ADMIN_ALERT_FROM`      | Sender address. Must be a verified sender in the Brevo account                                                | no      |
| `ADMIN_ALERT_FROM_NAME` | Optional display name (default `AFIT Market`)                                                                 | no      |

Limits and behaviour: best effort (no retry; a provider failure is logged without the key and dropped); at most 200 alerts per rolling day across all instances (Brevo free plan allows 300 e-mails a day in total, shared with sign-in e-mails sent through Supabase SMTP); subjects are fixed text; no names, phones, addresses or order contents are included. Code: `src/server/modules/engagement/admin-alerts.ts`.
