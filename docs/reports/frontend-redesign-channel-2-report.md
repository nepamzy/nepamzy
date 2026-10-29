# Frontend redesign, MASTER CHANNEL 2 report: Vendor, Rider, integration, security, verification

Date: 2026-10-28. This is the second and final master channel. No third channel was started.

## 1. Gallery location and completion status (read this first)

**Screenshot gallery:** `artifacts/afit-market-ui-audit/gallery.html` (open it in a browser from the checkout; images are relative links). Index and instructions: `artifacts/afit-market-ui-audit/README.md`. Channel-2-only differences: `artifacts/afit-market-ui-audit/channel2-delta-gallery.html`. Raw images: `artifacts/afit-market-ui-audit/channel2-final/{desktop,mobile,narrow-320}/<role>/...png` (139 + 139 + 12 = 290 real screenshots, 0 capture failures, captured from code commit `106dd3d`).

**Status: PARTIALLY COMPLETE, not "done".** Built, tested and photographed: the vendor and rider areas on the redesigned system with real data, the customer delivery-fee payment screen, the commission-free rider notice, role-separation security tests, and the evidence set. Not done to the standard of the boards: several vendor/rider pages keep their previous form internals (section 8). Remote CI on the very last commit is stated in section 7.

| Item                                                                          | State                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Verify Channel 1 evidence                                                     | Done (section 2)                                                                      |
| Vendor dashboard, catalogue list, orders, earnings, reviews, help, navigation | Redesigned, real data, tested                                                         |
| Vendor product form, shop settings form, handover and returns bodies          | Partial: new page headers/breadcrumbs, forms unchanged                                |
| Rider home, payments, profile, jobs, application                              | Redesigned headers/metrics/notice; job cards and application form internals unchanged |
| Customer "Pay Delivery Fee" screen                                            | Redesigned, tested                                                                    |
| Rider free-of-commission notice                                               | Done, tested (asserts no future-free promise)                                         |
| Bank-detail snapshot policy                                                   | Already implemented in Channel/FIC work; re-verified by tests (section 6)             |
| End-to-end journeys, role separation, forged state                            | Tested (section 6)                                                                    |
| Real integrations (Paystack live, bank, hosted Supabase)                      | NOT tested, by design (section 9)                                                     |

## 2. Verification of Channel 1 before starting

- Branch `feature/frontend-redesign-ch1`, working tree clean, local HEAD equal to the pushed `be887e4`, draft PR #5.
- Channel 1 report: `docs/reports/frontend-redesign-master-channel-1-report.md` (and the earlier shell-only `frontend-redesign-channel-1-report.md`) both exist.
- Gallery and inventory existed and were real: `redesign-m1-after` has 136 desktop + 136 mobile images; `gallery.html`, `page-inventory.md`, `capture-failures.md` present. I opened the admin dashboard and mobile cart images to check they matched the boards' structure.
- CI on `be887e4`: `checks` and `db-and-e2e` both **success** (runs 40680882948, 40680891496).
- Approved references located (owner pack: four boards, master prompt, 23-page PDF) and re-read for the vendor/rider/payment rules.
- Finding: Channel 1's older admin queue pages keep their previous table/form internals (already disclosed).

## 3. Branch, commits, push, PR

Branch `feature/frontend-redesign-ch1`; draft PR #5 (nepamzy/AFIT-MARKET). Start `be887e4`. Final code commit **`106dd3d`** (the tests, CI result and screenshots below apply to this code). The commits after it change only documentation and image files. Late additions in the final round, all in `106dd3d`: vendor product form in numbered sections with a gold save button, an earnings chart built from real settlement rows, rider jobs summary cards, breadcrumbs on both application pages. Everything is pushed. No merge into the default branch.

## 4. Screen inventory (vendor and rider)

| Role     | Route                                                                                      | Tabs / states shown                                                                                                                                                                                           | Evidence                           |
| -------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Vendor   | `/vendor`                                                                                  | metrics (orders today, waiting for you, 7-day sales, amount due), 14-day chart, shop status + pause/resume, work queues, recent orders (approved shop; the suspended-shop banner exists but was not captured) | `vendor__dashboard`                |
| Vendor   | `/vendor/orders`                                                                           | needs attention list, finished orders (paged), empty state                                                                                                                                                    | `vendor-orders__incoming-orders`   |
| Vendor   | `/vendor/catalogue`, `/new`, `/[id]`                                                       | list with metrics, photo-unavailable notice, create/edit forms                                                                                                                                                | `vendor-catalogue*`                |
| Vendor   | `/vendor/earnings`                                                                         | summary metrics, commission explanation, final/estimate, settlement history                                                                                                                                   | `vendor-earnings__earnings`        |
| Vendor   | `/vendor/reviews` (new)                                                                    | average, published reviews, empty state                                                                                                                                                                       | `vendor-reviews__reviews`          |
| Vendor   | `/vendor/help` (new)                                                                       | order flow, commission, pausing, support                                                                                                                                                                      | `vendor-help__help`                |
| Vendor   | `/vendor/profile`, `/handover`, `/returns`, `/menu`, `/account/security`, `/notifications` | shared shell; headers/breadcrumbs updated                                                                                                                                                                     | `vendor-*`                         |
| Vendor   | forbidden for non-vendor                                                                   | permission-denied state                                                                                                                                                                                       | `vendor__forbidden-for-non-vendor` |
| Rider    | `/rider`                                                                                   | availability, active deliveries, location sharing, free-of-commission notice, terms, Go Active/Inactive                                                                                                       | `rider__dashboard-*`               |
| Rider    | `/rider/jobs`                                                                              | inactive, offers, active deliveries, arrival                                                                                                                                                                  | `rider-jobs__*`                    |
| Rider    | `/rider/payments`                                                                          | no bank details, saved, awaiting confirmation, confirmed with receipt, disputed                                                                                                                               | `rider-payments__*`                |
| Rider    | `/rider/profile`, `/rider-apply`, `/notifications`                                         | profile, application, notice                                                                                                                                                                                  | `rider-profile__profile`           |
| Customer | `/orders/[id]/delivery-fee`                                                                | open, awaiting transfer, reported (Awaiting Rider Confirmation), confirmed, disputed, receipt                                                                                                                 | `orders-ID-delivery-fee__*`        |

Narrow (320 px, 12 captures): vendor dashboard/orders/catalogue/earnings, rider home/jobs/payments, customer cart/checkout/pay-delivery-fee, admin dashboard/users. Full page and state table: `artifacts/afit-market-ui-audit/page-inventory.md`.

## 5. What changed (Channel 2)

- **Vendor:** new dashboard; catalogue list with metrics and an honest "photos are not available" notice; orders page with metrics; earnings with settlement history; new Reviews and Help pages; grouped navigation (Sell / Money / Shop).
- **Rider:** shared `RiderFreeNotice` on home, payments, profile and application ("Rider earnings: Free of charge." and "Delivery commission features: Coming Soon", worded "under the current arrangement", no future promise); metrics; breadcrumbs.
- **Payment screen:** rider, fee from the order, bank details, copy-account-number, three numbered steps, gold "I Have Made the Transfer" button; states "Awaiting transfer", "Awaiting Rider Confirmation", "Confirmed", "Disputed". The button only records the customer's report; it never marks paid.
- **No new database migration in Channel 2.** The existing delivery-fee payment backend (encrypted bank details, snapshot at open, report/confirm/dispute, receipts) was reused.

## 6. Tests and security evidence (exact commands and results)

| Command                                                                                                                                                                                                               | Result                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check .`                                                                                                                                                                                              | clean                                                                                                                                                                                                                                                                              |
| `pnpm lint`, `pnpm typecheck`                                                                                                                                                                                         | clean                                                                                                                                                                                                                                                                              |
| `pnpm test` (unit)                                                                                                                                                                                                    | 358 passed, 0 failed, 0 skipped (20 files)                                                                                                                                                                                                                                         |
| `bash scripts/db-reset.sh` then `pnpm test:db`                                                                                                                                                                        | 394 passed, 0 failed, 0 skipped (35 files); re-run on `106dd3d`                                                                                                                                                                                                                    |
| `pnpm build`                                                                                                                                                                                                          | succeeded (same point)                                                                                                                                                                                                                                                             |
| `pnpm exec playwright test` (full, local)                                                                                                                                                                             | first run **231 passed, 6 failed**: my change to put the vendor order list and catalogue on `DataTable` duplicated action forms (found, reverted, logged as K93); second run on `eda54d0`: 250 passed; final full run on **`106dd3d`: 250 passed, 0 failed, 0 skipped (19.5 min)** |
| Playwright subset on `93bd991` (delivery-fee, delivery-fee-checkout, channel2-vendor-rider, accessibility-keyboard)                                                                                                   | 24 passed                                                                                                                                                                                                                                                                          |
| Test-isolation bug found and fixed in my own new spec (it left the approved-rider-terms test fixture installed and broke the rider journey test when run after it); riders and channel 2 specs together after the fix | 16 passed                                                                                                                                                                                                                                                                          |
| `pnpm audit --prod`                                                                                                                                                                                                   | no known vulnerabilities                                                                                                                                                                                                                                                           |
| Secret scan of the diff since `be887e4` (patterns for live keys, tokens, private keys)                                                                                                                                | nothing found; test bank numbers are the obvious fixture `0123456789` with "Fixture Bank (synthetic)"                                                                                                                                                                              |

New tests: `tests/e2e/channel2-vendor-rider.spec.ts` (4 tests x desktop and 360 px = 8):

1. every vendor page renders for the owner with real figures, no serious accessibility issues, no horizontal scroll, honest notices;
2. customers, riders and vendors cannot open each other's areas (403), forged `afit_mode` cookies (`vendor`, `admin`) grant nothing, an expired session is sent to sign-in;
3. an administrator in Customer mode gets no vendor/rider access, and staff pages are closed behind the mode page;
4. the commission-free notice appears on every rider page and promises nothing about the future.

Existing suites re-run and relied on for the other security properties: bank-detail snapshot ("opens with a snapshot of the rider details, is idempotent, and later edits never redirect it"), encrypted bank data and masking, "customer cannot complete a payment alone", dispute and receipt integrity, receipt-check rate limit, concurrency suites (orders, deliveries, refunds, jobs, riders, notifications), account erasure, route-guard coverage, endpoint authorisation. These are in the 394 database tests and 250 e2e tests.

**Reviewed but not fully verified:** log redaction beyond the audit-content test; race behaviour under real production load; keyboard/screen-reader use beyond automated axe checks and the keyboard-order spec.

## 7. CI

| Commit                     | CI                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `be887e4` (start)          | success                                                                                                      |
| `9e5a4e6`                  | **failed** (the vendor table regression above; I did not read these logs, I reproduced and fixed it locally) |
| `eda54d0`                  | success (pull-request run 40756167445)                                                                       |
| `93bd991`                  | success (push run 40760716807, pull-request run 40760726617)                                                 |
| `9af39ac`                  | success (runs 40762087656 and 40762096654)                                                                   |
| **`106dd3d` (final code)** | **success**: push run 40765202347 and pull-request run 40765213639, `checks` and `db-and-e2e` both passed    |
| later commits              | documentation and screenshots only; their runs are on the PR                                                 |

## 8. Known defects and gaps (not hidden)

- Vendor product/shop forms, handover and returns bodies, rider job cards and the rider/vendor application forms keep their previous internals; only headers, breadcrumbs, metrics and notices were redone (partial match to the boards).
- Boards show an earnings analytics chart, rider map on the dashboard and item photos: not built (no data/storage for photos; no rider earnings totals because fees are paid directly and confirmed manually). K94.
- No delivery history page for riders (not in the agreed data model).
- `DataTable` duplicates row markup (K93); still used by some Channel 1 admin tables that contain actions.
- Vendor notifications and settings use the shared notifications and account-security pages, not vendor-specific ones.
- Real device/browser matrix beyond Chromium at 1440, 390/360 and 320 px was not run.

## 9. Real versus mocked

Verified locally against the real local database and auth: pages, authorisation, database functions, state machine, receipts. **Not verified:** hosted Supabase; real Paystack (test mode is faked locally; no live credentials used); e-mail delivery (local sink only); real Web Push delivery; any real bank transfer or bank verification (none exists and none is claimed).

## 10. Owner actions needed

1. Review and approve this channel and Channel 1 (PR #5).
2. Approve applying the three Channel 1 migrations (`20261030000001` to `0003`) to the hosted database. Channel 2 added none.
3. Decide on item photo storage (needed before photo upload can exist).
4. Legal wording of the policy pages remains draft; direct rider payments remain OFF by default and must be switched on only by an administrator with a reason.

## 11. Confirmation

No production deployment was made (the branch preview builds from the PR; production was not promoted). No real payment, real transfer or live credential was used. No hosted Supabase migration was applied. No third channel was started.
