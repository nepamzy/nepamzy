# Testing

Status vocabulary: **Tested** = automated or recorded manual evidence exists. Anything else is **Unverified**.

## Prerequisites

Node 22, pnpm 10, Docker (daemon running), local Supabase stack (`pnpm db:start`), `.env.local` with LOCAL values (see `docs/environment.md`). Browser tests use the pre-installed Chromium (`/opt/pw-browsers`) or Playwright's own.

## Commands

| Command              | What it covers                                                                                                                                                                                                                                                                                                                                          | Needs stack        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `pnpm lint`          | ESLint (Next core-web-vitals + TypeScript rules)                                                                                                                                                                                                                                                                                                        | no                 |
| `pnpm typecheck`     | `tsc --noEmit`, strict + `noUncheckedIndexedAccess`                                                                                                                                                                                                                                                                                                     | no                 |
| `pnpm test`          | Unit tests: access-policy matrix, route-guard coverage, money, logger redaction, env validation                                                                                                                                                                                                                                                         | no                 |
| `pnpm test:db`       | SQL tests against the local Postgres: RLS (allowed and denied) per role and aal level, SECURITY DEFINER hygiene read from the catalog, append-only audit, parallel-connection atomicity harness                                                                                                                                                         | yes                |
| `pnpm test:e2e`      | Playwright in a real browser (Pixel-5 360px viewport and desktop) against a production build and the local stack: sign-up with real confirmation email, TOTP enrol/challenge/backup, route guards and HTTP 403, rate limits, server-action replay, accessibility (axe) and no-horizontal-scroll for every shell, PWA offline fallback, security headers | yes (+ mail sink)  |
| `pnpm check:secrets` | Secret patterns in tracked files and in the client bundle (`.next/static`)                                                                                                                                                                                                                                                                              | after `pnpm build` |
| `pnpm db:lint`       | Supabase/Postgres schema linter                                                                                                                                                                                                                                                                                                                         | yes                |

## Local stack helpers

`pnpm db:start` (starts Docker daemon if needed, the local stack without optional services, the mail sink and the SMTP forwarder), `pnpm db:reset` (reset DB and restore the forwarder). See comments in `scripts/` for why the workarounds exist (image registry rate limit, no catcher image, SMTP AUTH loopback rule).

## What each risk is tested by

| Risk                                              | Test                                                 |
| ------------------------------------------------- | ---------------------------------------------------- |
| Customer reads another customer's data            | `rls.test.ts` profiles                               |
| Role self-assignment / direct writes              | `rls.test.ts` roles; `schema-hygiene.test.ts` grants |
| Non-admin / aal1-admin grants roles; self-grant   | `rls.test.ts` grant/revoke; e2e admin-roles          |
| Audit tampering                                   | `rls.test.ts` append-only                            |
| Vendor A reads vendor B; rider reads other riders | `rls.test.ts` isolation                              |
| Registered customer acts without MFA              | `rls.test.ts` stub order placement; e2e journey      |
| Privileged role without MFA                       | `rls.test.ts`; e2e MFA enforcement; unit matrix      |
| Wrong-role page access returns 403                | e2e `auth-guards` matrix                             |
| New protected folder shipped without a guard      | `guard-coverage.test.ts`                             |
| Atomic capacity under 12 parallel claims          | `concurrency.test.ts` (stub)                         |
| Brute force on login / TOTP                       | e2e rate-limit tests + audit assertions              |
| Server action called directly by a non-admin      | e2e replay test                                      |
| Supabase MFA behavior changes in an upgrade       | e2e `mfa-api-behavior`                               |
| Secrets in client bundle                          | `pnpm check:secrets`                                 |

## Not tested / manual

Real Android devices and screen readers; actual email deliverability (local sink only); production hosting; load; DB tests and e2e are not yet in CI. See `docs/reports/batch-1.md` §M.

## Batch 2 coverage

- DB (`pnpm test:db`, 97 tests): vendor lifecycle, RLS, public read model, order creation/cancel/expiry/mock-pay, concurrency (last unit, idempotency, double cancel/pay), catalogue hygiene incl. anon allowlist.
- Unit (`pnpm test`, 107 tests): env/APP_ENV, db-error mapping, form parsing, money input, guard coverage.
- e2e (`pnpm exec playwright test`, 126 tests over mobile-360 and desktop): `marketplace.spec.ts` (apply→approve→catalogue→browse→cart→MFA→checkout→test pay→vendor sees order→suspension; blocked checkout; double-tap; production-mode server has no test-pay button), axe + no-horizontal-scroll on new pages.
- Reset the DB (`pnpm db:reset`) before DB tests if earlier e2e runs left data; the vendor-application test is tolerant of leftovers.
