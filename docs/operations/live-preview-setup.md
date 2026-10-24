# Putting AFIT Market online for a live preview

Status: written from reading the repository (`.env.example`, `docs/environment.md`, `supabase/config.toml`, `scripts/`). **None of these hosted steps has been run or tested by me.** Nothing in this repository deploys itself. Use test-mode keys only. Do not paste real secrets into chat, issues or commits.

## 1. What you need

| Piece                              | Suggested                                    | Why                                                                                                             |
| ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Hosted Postgres + Auth             | A Supabase project (any region near Nigeria) | The app expects Supabase Auth, Postgres, row-level security and the 25 SQL migrations in `supabase/migrations/` |
| Web host for Next.js 16 (Node 22+) | Vercel, Render, or any Node host             | `pnpm build` then `pnpm start` (or the host's Next.js runtime)                                                  |
| Payments (optional)                | Paystack **test** account                    | Without a test key the Pay button is disabled; there is no mock button outside `APP_ENV=local`                  |
| Email                              | SMTP provider set in Supabase Auth           | Sign-up needs email confirmation                                                                                |
| Scheduler (optional)               | Host cron or an external cron                | Expires unpaid orders, purges old location data, processes notifications                                        |

## 2. Environment variables (set on the web host, never in the repo)

No `NEXT_PUBLIC_` variables are used; everything is server-side.

| Variable                    | Value                                                                                                                                  | Secret?              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `SITE_URL`                  | Your public origin, e.g. `https://your-preview.example.com` (no trailing slash)                                                        | no                   |
| `SUPABASE_URL`              | Supabase dashboard, Project Settings, API, Project URL                                                                                 | no                   |
| `SUPABASE_PUBLISHABLE_KEY`  | Same page: publishable (anon) key                                                                                                      | low                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page: service-role / secret key                                                                                                   | **yes, server only** |
| `APP_ENV`                   | `staging` (anything other than `local`; unset is treated as production)                                                                | no                   |
| `PAYSTACK_SECRET_KEY`       | `sk_test_...` from the Paystack dashboard. Live keys (`sk_live_`) are rejected by the app. Leave unset to disable online payment       | **yes**              |
| `JOBS_SECRET`               | 16+ random characters: `openssl rand -base64 32`                                                                                       | **yes**              |
| `PICKUP_CODE_SECRET`        | 32+ random characters: `openssl rand -base64 48`. Missing or short means pickup codes are unavailable                                  | **yes**              |
| `BANK_DATA_KEY_ID`          | A short id you choose, e.g. `k1`                                                                                                       | no                   |
| `BANK_DATA_KEYS`            | `k1:<output of openssl rand -base64 32>` (id must match above). Needed only for rider bank details; without it those saves fail closed | **yes**              |

Do **not** set `DATABASE_URL`, `MAIL_SINK_URL` or `PAYSTACK_BASE_URL` on the host; they are for local tests and the fake provider only.
Keep a private copy of `BANK_DATA_KEYS`. If it is lost, saved bank numbers cannot be decrypted (see `docs/operations/bank-data-encryption.md`).

## 3. Supabase project setup

1. Create the project, then link and push the schema from your own machine:
   `pnpm exec supabase login`, `pnpm exec supabase link --project-ref <ref>`, `pnpm exec supabase db push`.
   This applies all migrations. Do **not** run `supabase/seed.sql` on the hosted project; it is local demo data and switches the mock payment flag on.
2. Authentication, URL configuration: Site URL = your `SITE_URL`; add the same origin to the redirect allow-list.
3. Authentication, Providers, Email: keep sign-ups on and **Confirm email on**.
4. Authentication, Multi-Factor: **TOTP enrol and verify enabled** (the app requires it for sign-in).
5. Authentication, SMTP: configure your own SMTP. The built-in Supabase mailer is heavily rate-limited, so confirmation emails will not be reliable without it.
6. Do not enable anonymous sign-ins or phone sign-in (the local config has both off).

## 4. First accounts

`scripts/seed-local-users.mjs` refuses to run against anything but a local URL. On the hosted project:

1. Sign up normally on your site and confirm the email.
2. In the Supabase SQL editor, give that user a role, for example:
   `insert into public.role_assignments (user_id, role) select id, 'platform_admin' from auth.users where email = 'you@example.com';`
   Other roles used by the app: `vendor_owner`, `rider`, `support_agent`, `finance_admin`.
3. Sign in; you must enrol an authenticator app to reach protected areas.
4. Vendors apply through `/apply` and an admin approves them. Marketplace pages stay empty until at least one vendor is approved and has products.

## 5. Scheduled jobs (optional for a preview)

Call each with `Authorization: Bearer <JOBS_SECRET>` using POST:
`/api/jobs/expire-orders`, `/api/jobs/purge-location`, `/api/jobs/process-notifications`. `GET /api/health` needs no secret. Without a scheduler, unpaid orders never expire and the notification outbox is never processed. `scripts/run-jobs.mjs` is local-only.

## 6. Paystack test mode

Add the Paystack **test** secret key, then in the Paystack dashboard set the webhook URL to `https://<your-origin>/api/webhooks/paystack`. Use Paystack's test cards only. No real money moves.

## 7. What a preview will and will not show

- Works: browsing, search, cart, checkout, orders, vendor and admin areas, riders (once terms are approved), the screenshots' pages.
- Rider terms are placeholders, so the database refuses rider sign-up and go-active until you approve a terms version.
- Direct-to-rider delivery fee collection is **off by default**; leave it off for a preview.
- The 18+ prompt is a self-declaration, not age verification.
- The app is not production-ready: see `docs/reports/final-platform-completion-report.md` sections 17 and 18.

## 8. Checklist

1. Supabase project created, migrations pushed, auth settings done (section 3).
2. Env vars set on the host (section 2), secrets generated locally and stored privately.
3. Deploy; open `/api/health`.
4. Sign up, confirm email, grant yourself `platform_admin`, enrol authenticator.
5. Approve a vendor, add a product, place a test order.
