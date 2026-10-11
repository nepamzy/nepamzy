# Batch 4 Completion Report — Carried-forward corrections + Phases 7 and 8

_Written by the implementing engineer (Claude) against the owner's Batch 4 **v2 consolidated** prompt (11 Oct 2026). Nothing here has been reviewed by ChatGPT or the owner. All coordinates are synthetic; Paystack was never exercised against the real API._

**Implementation commit:** `1f6c8c1e15a3c1852e048ad57864a98ed203aabe` (branch `claude/afit-market-phase-0-asm8xd`, draft PR #1). Documentation commits follow it. CI results for the implementation commit are in §G.2.

## A. Executive summary

Batch 4 (1) corrected the carried-forward items in Part 0 of the v2 prompt — the pickup-code secret no longer lives in the database, the handover evidence records how it was captured and a gated typed alternative exists (off), and the rider concurrency tests prove which control is the real backstop; (2) implemented Phase 7 — rider application/approval/suspension, placeholder terms acknowledgement, Go Active/Inactive shifts with safe shift end, delivery offers, an atomic five-delivery cap, vendor-to-rider parcel handover with an assignment-bound token, rider issue reports; and (3) implemented Phase 8 on **synthetic** data — location adapters (fake routing, labelled straight-line fallback), validated and rate-limited position updates, privacy-scoped reads, retention purge, server-side geofence arrival, a polling customer tracking card with a labelled sample map, wake-lock guidance and an Android manual test script.

Local result: lint, typecheck, format, build, secret scan, `supabase db lint` clean; **138 unit, 171 database and 142 browser-test executions (71 tests × mobile-360/desktop) pass**. Status: **CONDITIONALLY COMPLETE** (§N). Background GPS tracking is **UNVERIFIED**; the real Paystack API remains unverified; Phase 9 was not started.

## B. Requirements coverage (R1–R23 from the v2 prompt)

Implemented **and** verified by executed tests: R1, R2 (terms text is a placeholder), R3, R4, R5, R6, R7 (with a fake/straight-line estimate), R8, R9, R10, R11, R12, R13, R14, R15 (scheduling is a deployment step), R16, R18, R19, R22, R23.
Partial: R17 (adapter + fake provider; **no real provider**), R20 (no notification feature exists yet, so nothing leaks; there is nothing to verify beyond that).
**Not verified: R21** (background tracking) — manual script supplied.
Part 0: 0.2 done; 0.3 done as a **gated, default-off** typed acknowledgement + owner decision required; 0.4 done; 0.5 unchanged (no real-API verification possible here); 0.6 reported in §G.2; 0.7 untouched; 0.8 carried in `docs/known-issues.md`.
**Not implemented although described in the source policy:** prevention of unsafe/impossible batches beyond the cap (K45); QR images (a short code is used); Realtime (polling used); notifications.

## C. Files changed

72 files, +6,010/−181 relative to `daea95f` (`git diff --stat daea95f 1f6c8c1`). Highlights:

- Migrations: `20261013000001_pickup_secret_and_signature_method.sql`, `20261013000002_riders_assignments.sql`, `20261013000003_location.sql`; `supabase/seed.sql` (synthetic coordinates).
- Server: `src/server/modules/riders/{actions,admin-actions,queries}.ts`, `location/{geo,routing}.ts`, `orders-and-state-machine/{pickup-code,actions,queries,receipt}.ts`, `payments`-adjacent env in `src/lib/env.ts` (`pickupCodeSecret`).
- Routes/UI: `/rider`, `/rider/jobs`, `/rider/profile`, `/rider-apply`, `/admin/riders`, `/admin/rider-issues`, `/vendor/handover` (rider pickups), `/orders/[id]` (tracking), `/api/orders/[id]/tracking`, `/api/jobs/purge-location`; components `rider-controls`, `rider-admin-forms`, `rider-pickup-form`, `order-tracking`, updated `handover-form`.
- Config: `next.config.ts` (Permissions-Policy), `.env.example`, `scripts/make-env-local.sh`.
- Tests: `tests/db/{riders,rider-concurrency,location,rider-helpers}.test|ts`, updated `fulfilment/payments/rls/helpers`, `tests/e2e/riders.spec.ts` and helpers, unit tests for location and pickup codes. The Batch 1 stub test `tests/db/concurrency.test.ts` was removed with the stub it exercised.
- Docs: ADR `0002-riders-and-location.md`, `docs/testing/android-background-location-test.md`, database/security/testing/environment/known-issues/checklist/external-approvals/review-log/README updates, Batch 5 prompt.

## D. Frontend review

Rider home (terms → Go Active → Go Inactive, "Location sharing ON/OFF" always visible), Jobs (offers, 5-slot counter, handover code card, Start route, report a problem, no arrival button), vendor Handover (rider pickup section with the assigned rider's name + customer pickups), customer order page (tracking card with sample map, live/out-of-date label, ETA with its basis stated), admin riders and rider-issues pages, `/rider-apply`. Axe and no-horizontal-overflow checks run on the new pages at 360px and desktop. Gaps: no manual screen-reader review; the drawn signature still has no keyboard path; typed fields clear after a rejected submit (K33); the map is a labelled SVG, not a real map.

## E. Backend, database and architecture review

See `docs/database.md` and ADR 0002. Key points:

- **Pickup secret:** `PICKUP_CODE_SECRET` (server-only) derives `HMAC(order, nonce)`; the database stores the nonce and the code's SHA-256 only (`pickup_code_register`, service role, once). A database dump no longer contains enough to reproduce codes. A missing/short/placeholder secret throws and shows nothing.
- **Capacity (I1):** rider-row lock + `unique(rider_id, slot)` over slots 1–5. **Exclusivity (I2):** order-row lock + partial unique index + conditional update in `step_order`.
- **State flow:** `AWAITING_RIDER → RIDER_ASSIGNED → PICKED_UP_BY_RIDER → EN_ROUTE → ARRIVAL_DETECTED`, all through `step_order`; nothing rider-callable reaches `DELIVERED`/`COMPLETED`.
- **Location:** two tables with no API-role access; scoped functions; validation (range, accuracy, freshness, frequency); arrival only for `EN_ROUTE` orders from a fresh, accurate fix inside the snapshotted geofence.
- **Permissions-Policy** now permits geolocation only under `/rider` (it blocked all location before).
- The Batch 1 capacity stub function/table were replaced by the real rule.

## F. Security review

Controls added: aal2 + role + approved profile + current terms + active shift for rider actions; tokens hashed, expiring, single-use, bound to the assignment, locked after five wrong tries, invalidated on release; wrong-token/-code results are returned (so counters commit) and audited; customer tracking limited to the ordering customer, in transit, rider on shift; staff tracking needs a recorded purpose and is audited; location tables unreadable by API roles; retention purge; server action pre-checks plus database authority for every location rule; route handlers check access themselves.
Residual risks: **location is client-reported** (a rider can spoof coordinates or the observed time within the accepted window; the server cannot verify GPS authenticity), which is why arrival never completes an order and Phase 9 requires recipient proof; secret handling depends on the server environment (no rotation design, K44); staff purpose text is audited, not verified; a rider carrying a parcel cannot self-release (K41); no IP/device binding of the rider session; the synthetic map and fake ETA could be mistaken for real if the labels were removed; background tracking unverified; typed acknowledgement, if the owner enables it, weakens the "drawn signature" evidence (decision recorded as open).

## G. Test report

### G.1 Local, on the implementation commit (exact commands)

| Command                                                 | Result                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm exec prettier --write .` then `pnpm format:check` | pass                                                                                               |
| `pnpm lint` / `pnpm typecheck`                          | pass / pass                                                                                        |
| `pnpm test`                                             | **138 passed** (Batch 3 baseline 118)                                                              |
| `bash scripts/db-reset.sh` then `pnpm test:db`          | **171 passed in 11 files** (baseline 123); passed twice in a row on a dirty database               |
| `pnpm build` / `pnpm check:secrets`                     | pass / pass                                                                                        |
| `pnpm exec supabase db lint --local`                    | No schema errors                                                                                   |
| `pnpm exec playwright test`                             | **142 passed** (71 tests × 2 projects; baseline 134); 0 skipped, 0 flaky retries (retries are off) |

Differences from baseline: +20 unit, +48 database (the removed Batch 1 stub test −3, rider/location/secret/signature tests added), +8 browser executions net.

### G.2 GitHub Actions on the implementation commit

Filled in below after the run completes: see "CI" section at the end of this file.

### G.3 Failures met and fixed during the work (not hidden)

Tests that failed first and were fixed: DB tests that counted rows globally broke on leftover browser-test data (now scoped inside rolled-back transactions); a payments concurrency test reused an event id across runs (append-only table); `Permissions-Policy` blocked geolocation; Chromium restarts/duplicates: `watchPosition` returned code-2 errors before delivering a position and stops after a timeout (client now restarts only after a timeout, or when no reading follows an error); stale-location test raced the rider page's own updates; a signature-canvas test used a position measured before an error message shifted the page; the unfiltered vendor list hides the seeded closed vendor once other tests add shops; `stable` functions that call volatile ones (caught by `supabase db lint`). These were test or configuration defects, except the Permissions-Policy and watch handling, which were product defects.

### G.4 Concurrency evidence (what the tests prove and do not prove)

`tests/db/rider-concurrency.test.ts` (9 tests):

- All controls present: 8 simultaneous accepts of 8 orders by one rider → exactly 5 succeed (slots 1–5, the other 3 orders remain on offer); 6 riders racing for one order → exactly 1 wins and one `RIDER_ASSIGNED` history row; the same rider repeating a request in parallel → one assignment, no errors.
- **Control removal** (barrier makes every racer pass its check before any writes): without the rider lock the slot index still holds the limit; **without lock and slot index the cap breaks (>5)** — proving the test can detect the failure; without the order lock the unique index holds; without lock and index the conditional status update holds; **with all three removed, two riders get one order**. Everything is restored and re-tested afterwards.
- So the real backstops are: for capacity, `unique(rider_id, slot)`; for exclusivity, the unique index and, behind it, `step_order`'s conditional update. The locks are the primary controls that make failures clean (no half-applied work) rather than being the only protection.
- Not proven: behaviour under multi-node/pooled-connection setups beyond Postgres' own guarantees; liveness under heavy contention (with the lock removed only one of eight succeeds); the pre-existing `complete_pickup` concurrency test is still outcome-based.

## H. What worked

Full browser journey on both viewports: apply → admin approves → terms → no geolocation call before Go Active → permission requested right after → offer accepted → wrong then right vendor handover code → route started → GPS issue reported (no arrival, order unchanged) → live synthetic position shown to the customer with a sample map and a labelled estimate → other accounts get 404/401 from the tracking route → stale label after the rider stops sending → arrival detected by the server from a fresh fix inside the geofence (never delivered/completed) → Go Inactive refused while carrying the parcel. Also: sixth delivery refused with a clear message; denied permission handled with nothing stored; Go Inactive returns collected work to the pool; Permissions-Policy asserted; wrong accounts get 403.

## I. What failed or remains incomplete

Unsafe-batch prevention (K45); background tracking unverified (K34); no real map/route provider (K35); synthetic coordinates only (K36); polling instead of Realtime (K37); placeholder rider terms (K38); location purge and order-expiry jobs unscheduled (K18/K39); real Paystack unverified (K19/K30); signature storage/typed-acknowledgement decisions open (K26/K27); pickup-code unlock (K28); form-value clearing (K33); secret rotation (K44); no rider ID/vehicle checks (K46); no QR image.

## J. Technical debt

Large migrations; `step_order` and the test seam are internal hooks that need to stay out of the API surface (a hygiene test checks grants); `ActionForm` pattern clears fields; duplicate fixture-building code between DB and e2e helpers; the tracking route recomputes an estimate on every poll.

## K. Dependencies and cost

No new runtime dependency in Batch 4. No paid service. A mapping/routing provider would add cost and a privacy review (K35). Android real-device tests need devices.

## L. Decisions requiring owner approval

1. Signature: keep database `bytea` or move to private storage (K26); **whether a typed acknowledgement may count as the signature** (K27) — currently off; the answer decides whether delivery can ever be completed for a recipient who cannot draw.
2. Pickup-code re-issue/unlock rules (K28) and `PICKUP_CODE_SECRET` rotation approach (K44).
3. Who schedules the three jobs (expiry, location purge; reconcile reminders) and how (K18/K39).
4. Rider terms wording and eligibility rules (K38/K46); AFIT-approved delivery points, coordinates and zones (K36); whether customers may see live rider location at all.
5. Whether to purchase a routing/map provider (K35) and the privacy basis for sending locations to it.
6. Whether to implement unsafe-batch rules before real zones exist (K45).
7. Open items carried from earlier batches: MFA recovery, backup authenticator for privileged roles, TOTP enforcement point, replay/lockout trade-offs, pilot fees/expiry/caps, one store per vendor, stock reservation and rejected-paid-order handling, anonymous carts, repository rename.

## M. Manual verification still required

Run `docs/testing/android-background-location-test.md` on the target Android phones (the only way to settle R21). Screen reader and 200% zoom review of the rider, handover and tracking pages. Real-phone drawing of the signature. Confirm the production environment sets `PICKUP_CODE_SECRET` and `JOBS_SECRET` and schedules both job routes. Review the placeholder terms text. Paystack real-API checks from the Batch 3 report remain outstanding.

## N. Completion assessment

**CONDITIONALLY COMPLETE.** All Phase 7 and 8 exit criteria that can be tested without real devices, real coordinates or a real provider are met with executed evidence (six simultaneous accepts cannot exceed five; two riders cannot take one order; tracking is off by default; privacy tests pass; stale/inaccurate GPS and client claims cannot establish arrival; no rider action completes an order). Conditions: R21 device evidence, K45, the open owner decisions in §L, and the CI result in §G.2 being green.

## O. Next phase prompt

`docs/reports/batch-5-prompt.md` (Phases 9 + 10; Batch 4 corrections and findings first, then the full Phase 9 and 10 instructions).

---

# INDEPENDENT REVIEW PACKAGE FOR CHATGPT

_No review has taken place. This is evidence for the owner to submit._

1. **Report:** this file. 2. **Changed files:** `git diff --stat daea95f 1f6c8c1` and §C. 3. **Test results and commands:** §G. 4. **Concurrency evidence:** §G.4 and `tests/db/rider-concurrency.test.ts`. 5. **CI for the implementation commit:** the section below. 6. **Unresolved defects and owner decisions:** §I, §L, `docs/known-issues.md` K18–K47. 7. **Next prompt:** `docs/reports/batch-5-prompt.md`.
2. **Security-critical code to inspect:**
   - `20261013000001_*.sql`: `pickup_code_register`, `get_pickup_code`, `complete_pickup` (capture method), `vendor_transition_order` (mark_ready no longer derives the code).
   - `20261013000002_*.sql`: `rider_accept_order`, `rider_go_inactive`, `release_assignment`, `rider_issue_handover_token`, `vendor_confirm_rider_pickup`, `set_rider_status`, `require_rider`, the two partial unique indexes, grants block.
   - `20261013000003_*.sql`: `rider_post_location`, `tracking_payload`, `get_order_tracking`, `staff_get_order_tracking`, `purge_location_data`.
   - App: `src/lib/env.ts` (`pickupCodeSecret`), `orders-and-state-machine/queries.ts` (`getPickupCode`, `registerPickupCode*`), `riders/actions.ts` (`postLocationAction`), `api/orders/[id]/tracking/route.ts`, `next.config.ts` (Permissions-Policy).
3. **RLS summary:** `docs/database.md` Batch 4 section: `rider_applications`/`rider_profiles`/`rider_shifts`/`delivery_assignments`/`rider_issues` readable by the owner row and by platform admin (support for shifts/assignments/issues); `assignment_tokens`, `rider_location_*` have no API-role access; every table has a restrictive aal2 policy.

**Suggested review questions:**
(1) Can a database dump alone still reproduce a pickup code? (2) Is there any path by which a rider-callable function can set `DELIVERED`/`COMPLETED`, or by which a client can assert arrival? (3) Do the control-removal tests really exercise the layers they claim, and is anything left that only a lock protects? (4) Can any account other than the ordering customer (or audited staff) read a rider's position, including via the tracking route, error messages or timing? (5) Is `Permissions-Policy` scoped correctly (nothing outside `/rider` can use geolocation)? (6) Is the assignment token safe against guessing, replay, reassignment and cross-vendor use? (7) Does the retention/purge design delete what it should and only that? (8) Are the stale-location and arrival rules safe against clock skew and spoofed timestamps (the rider supplies `observed_at`)? (9) Is the typed-acknowledgement path safely off and correctly labelled? (10) Could any test pass while its control is broken?
