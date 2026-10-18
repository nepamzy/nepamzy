# AFIT Market: Testing Channel 1 of 4 — Baseline, customer and vendor journeys

Independent QA report. Scope: baseline, customer journey, vendor journey. Channels 2–4 were **not** started.
All testing used the local Supabase stack, local test accounts and the fake Paystack adapter. No production credentials, real payments, refunds or transfers were used, and nothing was deployed.

## 1. Executive summary

- Baseline (commit `8f020d2`) was green: format, lint, typecheck, secret scan, production dependency audit, build, 301 unit, 371 database and 196 Playwright tests.
- 18 new end-to-end tests (11 customer, 7 vendor; 36 executions on mobile-360 + desktop) and 9 new database tests on commission arithmetic were added.
- **4 reproducible defects (D1–D4), all the same root cause: order lists silently cut off older orders at a fixed 50-row limit.** Each was reproduced by a failing test first, then fixed, then the test passed. No authentication, authorisation, isolation or financial-calculation defect was found.
- Final state on `ca1ffb6`: unit 301/301, database 380/380 (fresh DB), Playwright 232/232 (fresh DB), 0 failed, 0 skipped, 0 flaky in the final run. Format, lint, typecheck and secret scan pass.
- Two of my own test-design mistakes broke existing `marketplace.spec.ts` search tests (fixture product names matched search terms). They are test-fixture pollution, not product defects; fixed (section 6).
- **Exit verdict: Channel 1 passes**, with the limitations in section 8. GitHub CI for `ca1ffb6` must be checked by the reviewer (section 9); I did not claim it green.

## 2. Exact commits

| Purpose                       | Commit                                            |
| ----------------------------- | ------------------------------------------------- |
| Baseline tested               | `8f020d2`                                         |
| Tests + defect fixes          | `ae2fddd`                                         |
| Fixture-pollution fix (final) | `ca1ffb6`                                         |
| Branch                        | `claude/afit-market-phase-0-asm8xd` (draft PR #1) |

## 3. Phase 1 — baseline (commit `8f020d2`)

| Command                                      | Result                                             |
| -------------------------------------------- | -------------------------------------------------- |
| `pnpm format:check`                          | pass                                               |
| `pnpm lint`                                  | pass                                               |
| `pnpm typecheck`                             | pass                                               |
| `pnpm check:secrets`                         | pass (1101 tracked files, 5 secret values checked) |
| `pnpm audit --prod`                          | no known vulnerabilities                           |
| `pnpm build`                                 | pass                                               |
| `pnpm vitest run --project unit`             | 301 passed                                         |
| `pnpm vitest run --project db` (fresh reset) | 371 passed                                         |
| `npx playwright test` (fresh reset)          | 196 passed (15.1 min)                              |

The earlier recorded totals were treated as history; every number above was re-measured in this session. Per-command logs: `/tmp/c1/*.log` (not committed).

## 4. Commands for the final run (commit `ca1ffb6`)

```
bash scripts/db-reset.sh            # before every DB or e2e run (e2e leaves rows)
pnpm format:check && pnpm lint && pnpm typecheck && pnpm check:secrets
pnpm vitest run --project unit      # 18 files, 301 tests
pnpm vitest run --project db        # 32 files, 380 tests
npx playwright test                 # 232 tests = 116 x (mobile-360, desktop)
UI_AUDIT_PHASE=channel1 UI_AUDIT_ROOT=artifacts/channel-1-screenshots \
  npx playwright test -c playwright.ui-audit.config.ts
```

## 5. Totals

| Suite            | Baseline | Final                     | Failed | Skipped | Blocked | Flaky |
| ---------------- | -------- | ------------------------- | ------ | ------- | ------- | ----- |
| Unit             | 301      | 301                       | 0      | 0       | 0       | 0     |
| Database         | 371      | 380 (+9)                  | 0      | 0       | 0       | 0     |
| Playwright       | 196      | 232 (+36)                 | 0      | 0       | 0       | 0     |
| Screenshot audit | n/a      | 2 passed (both viewports) | 0      | 0       | 0       | 0     |

Intermediate runs that failed (kept for honesty): the full run on `ae2fddd` had 2 failures (the `marketplace.spec.ts` `q=_` search, mobile+desktop, 6 not run); the next had 1 failure (desktop, "Rice" fixtures pushed the seeded Jollof item off the first search page, 3 not run). Both were caused by my new tests and are fixed; the third full run is the clean 232/232.

Infrastructure note: the Docker daemon died between sessions several times; this caused blocked/ECONNREFUSED runs, which were rerun after restarting the stack and are not counted as results.

## 6. Reproducible defects and fixes

**D1–D4 — Order lists silently dropped orders beyond a fixed limit (severity: medium, functional).**
Reproduction: create a shop with more than 50 orders (helper `bulkOrders`), open the page.

- D1 `/orders` (customer history): orders older than the newest 50 were unreachable.
- D2 `/vendor/orders`: an old _paid_ order waiting for action vanished behind newer finished orders, so the vendor could never see or act on it.
- D3 `/vendor/handover`: an old order awaiting handover was missing.
- D4 `/vendor` dashboard counters (paid / waiting) under-counted past the limit.

Fix (`ae2fddd`): `listOrdersPage`/`listOrders` in `src/server/modules/orders-and-state-machine/queries.ts` (status filters, oldest-first, one-extra-row paging); customer history is paged 25 per page; the vendor orders page has a "Needs your attention" section (all unfinished orders, oldest first) plus a paged "Finished and unpaid" section; handover and dashboard use status filters. Tests `order history reaches every order…`, `a busy shop never loses an unfinished order…` and `the same holds for the handover list…` fail before and pass after.

**Test-fixture corrections (not product defects):**

- XSS test payload contained `__xss`, which matched the literal-underscore search in `marketplace.spec.ts`; payload renamed to `window.pwned`.
- Customer-spec fixture product names `Rice …` pushed seeded "Jollof rice" off the first search page; renamed `Meal …`.
- Expectation errors fixed in my new tests (not weakened): RLS update returns a permission error rather than a silent no-op; `₦1,500` formatting; disabled "Add to cart" + "Sold out"; refund double submit uses two `requestSubmit()` calls.

## 7. Requirement to test mapping

### Customer (`tests/e2e/channel1-customer.spec.ts`, plus existing `customer-journey.spec.ts`, `payments-fulfilment.spec.ts`)

| Requirement                                                               | Evidence                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Registration, 18+ (missing / non-boolean / false rejected, clear message) | `registration: API sign-up rules…`; existing age tests                               |
| Email confirmation required before sign-in                                | same test (Auth API + admin confirm); UI flow in existing `customer-journey.spec.ts` |
| Login, logout in every tab, back button reveals nothing                   | `logout ends the session…`                                                           |
| Session persistence and expiry/revocation                                 | `session: persists across reload and tabs…`                                          |
| Unauthorised API calls (job routes, health, headers)                      | `machine endpoints and response headers…`                                            |
| Cross-customer access (pages, receipt, tracking, direct API)              | `another customer cannot read, cancel, refund or download…`                          |
| Price tampering, forged totals/ownership                                  | `a customer cannot forge prices…`                                                    |
| Stale prices                                                              | `stale prices…`                                                                      |
| Unavailable/archived products                                             | `unavailable and archived products…`                                                 |
| Checkout idempotency, failed payment, duplicate/forged webhooks           | existing `payments-fulfilment.spec.ts` (still passing) + DB tests                    |
| Refund idempotency                                                        | `refund request submitted twice…`                                                    |
| Receipts                                                                  | covered inside cross-customer and existing payment specs                             |
| Account erasure keeps financial records                                   | `a customer asks for deletion…`                                                      |
| Order history completeness                                                | `order history reaches every order…` (found D1)                                      |

### Vendor (`tests/e2e/channel1-vendor.spec.ts`, `tests/db/channel1-commission.test.ts`)

| Requirement                                                                                                          | Evidence                                           |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Product create / validate / edit / off sale / archive via UI                                                         | `vendor product management through the UI…`        |
| Isolation between shops (pages and direct API)                                                                       | `vendor isolation…`                                |
| Order actions: wrong state, repeats, unpaid, wrong role refused                                                      | `vendor order actions…`                            |
| Commission 4.5% of product subtotal, delivery excluded, ₦4,000 → ₦180, payable ₦3,820, once per order, no other shop | `earnings page shows the 4.5% commission exactly…` |
| Rounding (half-up), stored discount, refund adjustment, duplicate-settlement prevention, immutability                | `channel1-commission.test.ts` (9 tests)            |
| Hostile text in vendor fields shown as text                                                                          | `hostile text in vendor-controlled fields…`        |
| Busy shop (old orders still reachable)                                                                               | two busy-shop tests (found D2–D4)                  |

## 8. Unresolved issues and limitations

1. Checkout has no product-discount feature (`discount_kobo` is always 0 through the UI); settlement arithmetic with a stored discount is verified at database level only.
2. The mock "test pay" button records no ledger entry (the fake-Paystack path does). Behaviour is by design but means the mock path cannot exercise refund ledger maths; the fake Paystack path was used for money tests.
3. A payment _initiation_ failure against an unavailable provider is covered only by existing failure-injection tests, not by a new UI test.
4. Fixed row limits remain outside Channel 1 and should be reviewed in later channels: `admin/vendors` (100), `admin/applications` (50), `admin/audit` (100), rider queries (50/100).
5. Rate limiting uses `X-Forwarded-For`; it is only trustworthy behind a proxy that overwrites the header (deployment concern, unchanged).
6. The age check remains a self-declaration; it is not independent age verification and nothing here claims otherwise.
7. CI status of `ca1ffb6` was not confirmed by me at the time of writing.

## 9. CI

The GitHub run on `ae2fddd` failed (`db-and-e2e`, the two `marketplace.spec.ts` failures described above). The fix is in `ca1ffb6`, pushed to the PR branch. The reviewer should confirm the new run on `ca1ffb6` before accepting; I will not state it is green until verified.

## 10. Screenshots

Synthetic data only, desktop 1440 and mobile 390, under `artifacts/channel-1-screenshots/channel1/{desktop,mobile}/`:

| Role     | Files |
| -------- | ----- |
| public   | 44    |
| customer | 76    |
| vendor   | 26    |

(Admin and rider captures from the shared audit tool were removed from this set; they belong to later channels.) Any route that was not reachable during capture is recorded by the audit tool's own output in its run log.

## 11. Exit criteria

| Criterion                                                                       | Status                      |
| ------------------------------------------------------------------------------- | --------------------------- |
| Baseline recorded from the actual commit                                        | met                         |
| Customer journeys tested end to end, including negative and cross-account cases | met                         |
| Vendor journeys tested, including isolation and 4.5% commission                 | met                         |
| Defects reproduced, fixed, affected tests rerun, full suites rerun              | met                         |
| No test weakened, skipped or hidden                                             | met                         |
| Screenshots captured                                                            | met                         |
| Local CI-equivalent checks pass on final commit                                 | met                         |
| GitHub CI green on final commit                                                 | to be confirmed by reviewer |

**Channel 1 passes the exit criteria. Stopping here; Channel 2 has not been started.**
