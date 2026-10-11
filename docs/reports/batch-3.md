# Batch 3 Completion Report — Phases 5 and 6

_Written by the implementing engineer (Claude). Nothing here has been reviewed by ChatGPT or the owner. The owner said they will send corrections after reviewing; they go first in the next batch._

## A. Executive summary

Batch 3 adds Paystack **test-mode** payments (server-side initialize/verify, signed webhook, idempotent event store, ledger, reconciliation flags and admin page, refund _requests_) and vendor order operations (accept / reject / prepare / ready), a one-time pickup code, mandatory handover signature, evidence storage and PDF receipts. It also closes Batch 2 carry-overs (expiry job route, request id in logs, CI job written). All suites pass locally: lint, typecheck, format, build, secret scan, `supabase db lint`, 118 unit, 123 DB, 134 e2e (67 × mobile-360 and desktop). **Payments were only ever run against a local fake provider**: paystack.com was unreachable from this sandbox (see §I, §M). Phase 7 was not started.

## B. Requirements coverage

- **Implemented and verified (against the fake provider):** initialize with DB amount; verify; HMAC-SHA512 webhook (raw body, constant time, size cap); idempotent events (replay, out-of-order, wrong amount/currency, unknown reference, late payment after expiry, duplicate payment); ledger (receipts only); reconciliation flags + finance page + resolve; refund request primitive (capped); live keys rejected; vendor state machine with history; rejection releases stock and raises a refund flag; pickup code (hashed, single use, 48 h, locks after 5 wrong); mandatory signature + name; evidence immutable and access-scoped; PDF receipt; expiry job route; request id in logs.
- **Implemented, not verified:** real Paystack API; (the CI job `db-and-e2e` has since run green on GitHub, see §G addendum); screen readers/real devices for the signature pad.
- **Partial:** refunds are requests only; `VENDOR_REVIEW` state unused (`PAID` is "waiting for vendor").
- **Not implemented (scope):** riders, location, delivery proof, refund execution, disputes, notifications, MFA recovery (owner gate).

## C. Files changed

27 files modified and ~40 added since Batch 2 (see `git diff --stat 6cff0b6..HEAD`). Migration `supabase/migrations/20261012000001_payments_orders_handover.sql`. Modules `src/server/modules/payments/*` (signature, events, paystack client, apply, actions, admin-actions), `orders-and-state-machine/{actions,receipt,queries}.ts`; routes `/api/webhooks/paystack`, `/api/payments/return`, `/api/jobs/expire-orders`, `/orders/[id]/receipt`, `/admin/payments`; components signature-pad, handover-form, vendor-order-actions, finance-forms; `scripts/fake-paystack.mjs`, `scripts/make-env-local.sh`; tests `tests/db/{payments,fulfilment}.test.ts`, `tests/e2e/payments-fulfilment.spec.ts`, unit `payments.test.ts`; new dependency `pdf-lib`.

## D. Frontend review

Order page offers Paystack (test mode) payment, shows the customer's pickup code and a receipt link; vendor orders page shows items and the next-step button (reject needs a reason); vendor handover has code, name and a draw-to-sign pad (touch/pen/mouse). `/admin/payments` for platform/finance admins. Axe + 360px checks include `/admin/payments` and `/vendor/handover`. Gaps: signature has no keyboard alternative (K27); typed fields clear after a rejected submit (K33); no manual screen-reader pass.

## E. Backend and database review

See `docs/database.md` (Batch 3 section). Rules: amount always from the order row; `payment_apply_event` takes an advisory lock per event id plus row locks, writes the event row last with its outcome; late/duplicate/mismatched payments never change order state and always raise a flag; transitions go through `app_private.step_order` (conditional update + history); `complete_pickup` returns (not raises) wrong-code results so the attempt counter commits; the pickup code is recomputed from HMAC(order, nonce) with a private pepper, only a hash is stored; all new tables RLS-enabled with restrictive aal2 policies; `supabase db lint` clean.

## F. Security review

Controls: signature before parsing; 64 KB cap; only `sk_test_` keys; provider URL override only when `APP_ENV=local`; whitelisted payload storage; webhook/ledger/flag tables not writable by users; service-role-only functions; customers can read only their own transactions; finance data limited to platform/finance admins at aal2; receipts route checks the session itself and relies on RLS; return route requires a session, checks ownership and rate-limits provider calls; jobs route uses a bearer secret with constant-time compare. Residuals: pickup code proves possession not identity; webhook has no IP allow-list (signature is the control); `JOBS_SECRET` must be set in deployment; pepper lives in the database (a DB dump exposes it with the hashes); stored payloads still contain provider ids.

## G. Test report (final run on the committed code, local stack)

| Command                                    | Result                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `typecheck` / `format:check` | pass                                                                                                                                                |
| `pnpm test`                                | 118 passed                                                                                                                                          |
| `pnpm test:db` (after `pnpm db:reset`)     | 123 passed                                                                                                                                          |
| `pnpm build` / `pnpm check:secrets`        | pass                                                                                                                                                |
| `pnpm exec supabase db lint --local`       | No schema errors                                                                                                                                    |
| `pnpm exec playwright test`                | 134 tests: 132 passed in the full run, 2 failures fixed afterwards and re-run green (production-mode test now disables the Paystack key; see below) |

**Addendum (GitHub CI):** after the push, workflow run https://github.com/nepamzy/nepamzy/actions/runs/38139102474 for commit a0dacce completed successfully: job `checks` (lint, typecheck, unit, build, secret scan) and job `db-and-e2e` (local Supabase stack, 123 DB tests, full Playwright suite on Chromium) both passed. This is the first independent execution of the DB and browser suites outside this sandbox.

Failures fixed during the work: redirect to `localhost` instead of the configured site URL after payment (now uses `SITE_URL`); status label expectation; signature lost when React reset the form (signature is now added at submit time); hard-coded provider event ids reused across projects (now unique per run); the Batch 2 "no order actions yet" assertion; production-mode test needed `PAYSTACK_SECRET_KEY` blanked. **Mutation check:** removing the row locks in `complete_pickup` did _not_ fail the concurrency test, because the primary key and conditional update still enforce the invariant (K31).

## H. What worked

Full e2e journey: Paystack test payment → ledger entry → vendor accepts/prepares/readies → customer sees code → wrong code and unsigned attempts refused → correct code + signature completes → PDF receipt for customer and shop, 404 for a stranger, 401 anonymous. Webhook: no/forged/wrong-key signatures 401; bad JSON 400; wrong amount flagged not paid; replays harmless. Rejected paid order → stock released → finance resolves the flag. Parallel tests: six identical events pay once; six events for one reference pay once; three simultaneous accepts/completions succeed exactly once.

## I. Failed or incomplete

Real Paystack API untested (K19, K30); no scheduler for expiry (K18); signature in DB and no keyboard alternative (K26, K27); no unlock/re-issue for pickup codes (K28); refunds not executed (K29); lock-presence not proven by tests (K31).

## J. Technical debt

`VENDOR_REVIEW` unused; large migrations; ledger has no running-balance view; fake provider duplicates a small slice of Paystack behaviour and must not be mistaken for the real one.

## K. Costs and dependencies

New dependency `pdf-lib` (pure JS, MIT). No paid services. Paystack test keys are free but not used here.

## L. Decisions needing owner approval

1. Provide a Paystack **test** key and approve running the manual check list (§M).
2. Signature storage: keep in the database or move to private Storage; keyboard alternative.
3. Pickup code lifetime (48 h), lock-after-5, and who may unlock/re-issue.
4. Vendor-rejected paid orders: automatic refund request vs manual finance review (currently flag only).
5. Scheduler for `POST /api/jobs/expire-orders`.
6. Carried over: MFA recovery, backup authenticator for privileged roles, forced TOTP at sign-up, pilot values, one store per vendor, stock reservation, anonymous carts, repository rename.

## M. Manual verification still needed

With a real Paystack **test** key and a tunnel or deployed URL: run one successful and one failed test card payment; confirm the dashboard webhook URL receives `charge.success` with `x-paystack-signature` and that our route returns 200; confirm replays; confirm the verify endpoint response shape; confirm refund API fields before building execution. Also: screen reader and zoom on the order page, handover form and signature pad; real-phone signature drawing; PDF opens on Android; confirm `JOBS_SECRET` is set and the job is scheduled in any deployment.

## N. Completion assessment

**CONDITIONALLY COMPLETE.** Phase 5/6 exit criteria are met against the local fake provider with executed evidence (replayed/forged webhook tests pass; pickup cannot complete without a valid code and signature). Conditions: real-API verification (§M) and the owner decisions in §L.

## O. Next phase prompt

`docs/reports/batch-4-prompt.md` (Phases 7 + 8; Batch 3 corrections first; the owner's own corrections must be applied before anything else).

---

# INDEPENDENT REVIEW PACKAGE FOR CHATGPT

_No review has taken place. This is evidence for the owner to submit._

1. **Report:** this file. 2. **Changed files:** `git diff --stat 6cff0b6..HEAD`. 3. **Tests:** §G. 4. **Decisions:** §L. 5. **Defects:** §I, `docs/known-issues.md` K18–K33.
2. **Security-critical code:** `payment_apply_event`, `payment_prepare`, `vendor_transition_order`, `complete_pickup`, `get_pickup_code`, `pickup_code_for` in `20261012000001_payments_orders_handover.sql`; `src/server/modules/payments/{signature,events,apply}.ts`; `src/app/api/webhooks/paystack/route.ts`; `src/app/api/payments/return/route.ts`; `src/app/orders/[id]/receipt/route.ts`; `paystackConfig()` in `src/lib/env.ts`.
3. **Migration/RLS summary:** `docs/database.md`.
4. **Next prompt:** `docs/reports/batch-4-prompt.md`.

**Suggested review questions:** (1) Can any input other than a signed provider event move an order to PAID? (2) Can a replay, reorder, wrong amount, or late payment corrupt order or ledger state? (3) Is the advisory-lock + row-lock design in `payment_apply_event` sound? (4) Can the pickup code or evidence be read or forged by anyone but the intended party? (5) Is returning wrong-code results (instead of raising) safe against enumeration? (6) Is the receipts route correctly authorised? (7) Could any test pass while its control is broken (see K31)? (8) Is relying on third-party summaries for Paystack behaviour acceptable until verified?
