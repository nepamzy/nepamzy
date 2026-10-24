# Batch 5 report: Phase 9 (delivery proof and completion) and Phase 10 (refunds, returns, disputes, support)

Engineer's own report. **Not reviewed by ChatGPT. Not approved by the owner.** Prepared against the owner's master Batch 5 prompt (`docs/reports/batch-5-prompt.md`, v2, approved by the owner in chat before implementation).

## A. Executive summary

- **Corrected K48 first.** The database now refuses placeholder rider terms: `rider_ack_terms`, `rider_go_active` and `rider_accept_order` raise `terms_not_approved` while the current terms version is a placeholder, unknown or missing. Verified defect before the fix (read from the Batch 4 migration), proven fixed by tests.
- **Phase 9.** After the server detects arrival, only the customer (the recipient) can start and complete the delivery, with a drawn signature, a one-time hashed proof token bound to the current assignment, in one transaction that writes the evidence, moves the order to DELIVERED then COMPLETED, completes the assignment (frees the rider's slot) and removes the stored position. The rider has no completion action anywhere. Typed acknowledgement stays OFF and is refused for deliveries. A supervised support path handles recipients who do not show up (never marks delivered). The vendor counter can find the one pending order for a code (rate limited), but completing still needs code + signature.
- **Phase 10.** Refund request, approval and execution are separate steps with separate roles; cumulative refunds cannot exceed the ledger, item quantities cannot exceed what was bought, requests are idempotent, and execution exists only as a clearly labelled FAKE provider that fails closed outside `local`. Returns are a separate record (customer brings the item; no restock). Support cases (disputes) have party-scoped statements, a neutral evidence bundle for staff, human-only decisions with a reason, and never edit the original delivery proof.
- **Not done / unverified:** real Paystack refunds, rider return tasks, QR image, evidence uploads, notifications, policy values (all placeholders), real devices. See sections K-M.
- **Final status: CONDITIONALLY COMPLETE** (section O).

## B. Repository and commit information

- Branch `claude/afit-market-phase-0-asm8xd`, draft PR #1. Prompt commit before implementation: `6b849c4`.
- Implementation commits (in order): `a43def3` (K48 + Phase 9), then Phase 10 database and application layers, `29fce1b`, `896b62e` (docs formatted), `52340e5` (e2e fixture names). The commit used for the final local verification is recorded in section G; the final documentation commit SHA is recorded in section J.
- Working tree clean at each verification.

## C. Requirements traceability

See `docs/requirements-checklist.md` "Batch 5 additions" (every row names the migration/function, the tests and the limitation). Summary of prompt Part A items: A5 pickup secret (unchanged, re-verified by the existing suites), A6 payments (fake provider only, unchanged Paystack tests), A7 stock (nothing restocked; rejected paid orders keep the flag -> request -> approval -> execution distinction), A8 done, A9/A10 K45/K46 left open, A11 typed OFF (refused for deliveries), A12 storage unchanged (database `bytea`; read policy narrowed), A13 rider invariants re-run, A15 no new jobs were added.

## D. Database changes

Migrations `20261014000001` (terms), `000002` (delivery proof), `000003` (refunds, returns, cases). Full list in `docs/database.md` "Batch 5 additions", the access rules in `docs/access-matrix.md`, the transitions in `docs/state-machines.md`.

Security and financial invariants and how they are enforced (each tested; the layers are listed in `docs/database.md`):

- placeholder terms never authorise riders: helper functions called by all three rider functions;
- one completion per order: order lock, assignment lock, proof-session lock, evidence primary key, conditional update in `step_order`;
- refund cap: function lock, balance check, trigger with its own order lock and ledger re-check; item quantities by trigger; state machine by trigger; core fields immutable;
- provider boundary: `refund_begin_execution` accepts only `fake`; a success needs a unique provider reference and writes one ledger entry per refund;
- evidence: append-only table; narrowed read policy; staff access only through an audited function that needs a purpose.

## E. Delivery completion

State machine in `docs/state-machines.md`. Flow: EN_ROUTE -> (server geofence) ARRIVAL_DETECTED -> (customer starts) AWAITING_RECIPIENT_PROOF -> (customer signs) DELIVERED -> COMPLETED. The proof token is 12 hex characters from 6 random bytes, stored only as a SHA-256 hash, bound to order and assignment, 20 minutes (placeholder `delivery_proof_ttl_minutes`), one live per assignment, locked after 5 wrong tries, invalidated by restart/release. The audit trail has `delivery_proof.started`, `delivery_proof.wrong_token`, `delivery.completed`, `delivery.exception_handled`, `delivery_proof.viewed_by_staff`. The receipt shows the delivery proof and the arrival time (no rider name) and is rendered on demand from immutable data (K53).

## F. Refunds, returns and disputes

Permission model and workflows: `docs/access-matrix.md`. A customer can ask for everything still refundable or for chosen items; the amount is computed on the server from immutable order lines (price x quantity, less the line's share of any discount, plus a service-fee share only if the owner turns that policy on). Finance/support/admin review; approval is finance's call (support only up to a configured limit, default 0); the requester can never decide or run their own request; execution is a separate finance step against the FAKE provider; the outcome is recorded as succeeded, failed or unknown (reconciliation); a contradictory late report raises a flag and changes nothing. Cases: the customer reports, each side adds statements and sees only its own plus support's public ones, support sees a neutral bundle (no coordinates, no signature image), decides with a reason, and a refund/return decision only creates a request that still needs its own approval.

## G. Security review (what was tested; nothing here was reviewed independently)

- Role/assurance matrix tests for every new function (anonymous, customer owner, other customer, shop, rider, support, finance, admin, aal1) in `delivery.test.ts`, `refunds.test.ts`, `cases-returns.test.ts`; catalog test of which functions can reach the proof/completed states.
- Replay/forgery: wrong, expired, consumed, other-order, other-secret (pickup code, rider handover token) and old-assignment tokens all refused; five wrong tries lock.
- Concurrency with control removal for completion (5 layers) and for the refund cap (3 layers), each ending with an "all layers removed" test that proves the invariant really breaks (so the tests can fail).
- Privacy: bundle contains no raw coordinates, token hashes, code hashes or signature image (asserted on the serialised JSON); vendor and rider statements are not readable by the customer, not even through the table (a leak found by my own test during development and fixed).
- Secrets: nothing new; `pnpm check:secrets` passes; the fake provider and fixtures contain no keys.
- Limitations: see K49-K55 and the unchanged K19/K30, K34, K45, K46.

## H. Test results (exact commands, this sandbox)

Final verification on commit `52340e585d5da670ab883dd941dbb77d9b79a70d` (after `bash scripts/db-reset.sh`; DB suite first, then the browser suite, as CI does):

| Command                                              | Result                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                          | pass                                                                                                                                                                      |
| `pnpm typecheck`                                     | pass                                                                                                                                                                      |
| `pnpm format:check`                                  | pass                                                                                                                                                                      |
| `pnpm test` (unit)                                   | **161 passed** (13 files; Batch 4 baseline 138)                                                                                                                           |
| `pnpm test:db`                                       | **242 passed** (16 files; Batch 4 baseline 171). New: `delivery` 19, `delivery-concurrency` 8, `refunds` 19, `refund-concurrency` 7, `cases-returns` 13, rider A8 block 5 |
| `pnpm build`                                         | pass                                                                                                                                                                      |
| `pnpm check:secrets`                                 | pass                                                                                                                                                                      |
| `pnpm exec supabase db lint --local --level warning` | no schema errors, no warnings                                                                                                                                             |
| `pnpm exec playwright test`                          | **152 executions passed, 0 failed** (76 tests x 2 projects; Batch 4 baseline 142 = 71 x 2)                                                                                |

Why counts changed: unit +23 (signature validation, fake provider boundary, route-policy coverage for the 3 new admin prefixes, others); DB +71 (list above); e2e +5 tests per viewport (`delivery.spec.ts` 3, `support.spec.ts` 2) plus extended existing tests. No test was deleted or skipped. Two existing assertions were adjusted with reasons: `orders.test.ts` accepts the foreign-key message when `order_items` is truncated (refund/return tables now reference it; protection is stronger, not weaker); the "functions reaching proof states" list was extended with the reviewed Phase 10 functions.

Two failures met on the way and fixed: (1) a full run failed `marketplace.spec.ts` because my fixture products were named "Rice ..." and crowded the search results on a dirty database (renamed to "Fixture dish"); (2) an over-broad rider-page button locator also matched other riders' "Accept delivery" offers (scoped to "My deliveries"). The earlier full run with these two defects was not counted.

## I. Accessibility and usability

Automated: axe (wcag2a/aa/21a/21aa, serious+critical) and a horizontal-overflow check run on every new page at mobile-360 and desktop: order help, order with the confirmation panel, signing step, case pages (customer and staff), admin refunds/returns, vendor returns, rider issues. Keyboard/labels: every field has a visible label, the quantity inputs have accessible names, groups are named. **No manual screen-reader or keyboard-only session was performed**; the drawn signature still has no keyboard alternative (K27/K52).

## J. CI

GitHub Actions on `896b62e` (all Phase 9/10 code and docs, before the e2e fixture rename): CI #23 (push) and #24 (pull_request) both **success** (jobs `checks` and `db-and-e2e`; job logs not opened). The CI result for the later commits (`52340e5` and the documentation commit that adds this report) is recorded in `docs/review-log.md` once it has been checked; at the time of writing it was not yet known, so it is **not claimed here**.

## K. Unresolved owner decisions

All items in prompt A16 remain open, plus the new ones: refund policy values (fee share, support approval limit, partial refunds), return policy per shop category, whether a visible/QR confirmation code is wanted, procedure for recipients who cannot draw or are not the account holder, evidence upload and storage (K26), and who may see signature images.

## L. Known issues

Carried forward unchanged: K18/K39, K19/K30, K26-K28, K33-K38, K40, K42-K47. Resolved: K48. Updated: K29, K41. New: K49 (no return logistics), K50 (placeholder policy values), K51 (no evidence upload/signature viewer UI), K52 (recipient is the account holder; cannot-draw path is support), K53 (points without coordinates; receipt on demand), K54 (no notifications), K55 (proof token is internal; no QR).

## M. External approvals and operational blockers

`docs/external-approvals.md` items 1-19. New this batch: 17 (refund/return policy), 18 (cannot-draw/not-account-holder procedure), 19 (independent verification of real Paystack refunds). Still blocking any pilot: AFIT authorisation, approved delivery points and zones (K36/K45), approved rider terms (K38/K48), rider identity/vehicle verification (K46), Android background GPS (K34), job scheduling (K18/K39), legal/privacy review, MFA recovery decisions.

## N. Deployment and pilot status

**Nothing is deployed. The system is not ready for a pilot or real users or real money.** Local only; Paystack test mode only and never verified against the real API; refunds execute only against a fake provider; coordinates are synthetic.

## O. Final recommendation

**CONDITIONALLY COMPLETE.** Every Phase 9 and Phase 10 exit criterion that can be tested locally is met with executed evidence. Conditions: owner review; the open decisions in K; real-world verification (Paystack refunds, devices) that this sandbox cannot do; the policy values and the missing pieces listed in L.

---

# INDEPENDENT REVIEW PACKAGE FOR CHATGPT

1. **Commits.** Prompt `6b849c4`; implementation range `6b849c4..<final>`; final SHAs and CI in sections B, H and J. Changed files: `git diff --stat 6b849c4..HEAD` (65+ files; code in `src/`, `supabase/migrations/20261014*`, `tests/`).
2. **Migrations.** `supabase/migrations/20261014000001_rider_terms_enforcement.sql`, `20261014000002_delivery_proof.sql`, `20261014000003_refunds_returns_disputes.sql`.
3. **Security-critical functions (read these first).** `app_private.require_approved_terms`, `rider_go_active`, `rider_accept_order`; `delivery_proof_begin`, `complete_delivery`, `staff_get_delivery_proof`, `ops_handle_delivery_exception`, `vendor_find_pickup_by_code`; `app_private.create_refund`, `refunds_cap_guard`, `refunds_state_guard`, `refund_items_cap_guard`, `refund_outcome_core`, `refund_decide`, `refund_begin_execution`; `open_support_case`, `case_decide`, `get_case`, `staff_case_bundle`, `case_party`; `app_private.create_return`, `return_items_cap_guard`.
4. **RLS and grants.** End of each migration ("Privileges and RLS"); matrix in `docs/access-matrix.md`; catalog tests in `tests/db/schema-hygiene.test.ts` (every table has RLS and a restrictive aal2 policy; API roles have SELECT only; no PUBLIC/anon execute except the read allowlist).
5. **Delivery completion tests.** `tests/db/delivery.test.ts`, `delivery-concurrency.test.ts`, `tests/e2e/delivery.spec.ts`.
6. **Refund cap and concurrency.** `tests/db/refunds.test.ts`, `refund-concurrency.test.ts`; method: `app_private.test_seam` barrier + removal of lock/trigger/index layers.
7. **Returns and disputes authorisation.** `tests/db/cases-returns.test.ts`, `tests/e2e/support.spec.ts`.
8. **CI evidence.** Section J.
9. **Reproduce locally.** `pnpm install`, `pnpm db:start`, `bash scripts/make-env-local.sh`, `bash scripts/db-reset.sh`, then `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm test:db && pnpm build && pnpm check:secrets && pnpm exec supabase db lint --local --level warning && pnpm exec playwright test`.
10. **Failed, skipped or unverified.** Unverified: real Paystack refunds (K19/K29/K30), Android background GPS (K34), manual accessibility, GitHub job logs not opened. Failed during development and fixed: listed in section H. No test was skipped.
11. **Questions I would like challenged.** (a) Is the recipient-only completion (K47/K52) acceptable for deliveries to someone else? (b) Should support be able to approve small refunds by default (currently limit 0)? (c) Is "customer brings the item" the right first return method? (d) Should the proof token also be shown to the rider as a code?

Nothing in this package has been independently reviewed by ChatGPT or the owner.

---

# Batch 6 prompt

The complete Batch 6 prompt (Phases 11 and 12) is `docs/reports/batch-6-prompt.md`, updated with this batch's outcome (corrections first). It is also appended to `docs/reports/batch-5-prompt.md`.
