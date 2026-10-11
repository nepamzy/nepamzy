# PROMPT — AFIT Market Implementation Batch 4 (Phases 7 + 8)

> Self-contained. Use ONLY after the owner has reviewed the Batch 3 report and explicitly approved this prompt. The owner has said they will send corrections after reviewing Batch 3: **apply those corrections first**, ahead of everything below. Implement Phases 7 and 8 only, then stop and report with the full A–O report, an INDEPENDENT REVIEW PACKAGE FOR CHATGPT, and the complete Batch 5 prompt (Phases 9 + 10). Do not begin Phase 9. Do not claim any review happened until evidence is submitted.
> Version: v1, written at the end of Batch 3 (2026-10-11).

# PART 0 — CORRECTIONS AND CARRIED-FORWARD FINDINGS (binding; read first)

## 0.1 Corrections from Batch 3

1. **Paystack was never exercised against the real API** (paystack.com unreachable from the build sandbox); everything ran against `scripts/fake-paystack.mjs`. Facts used (HMAC-SHA512 `x-paystack-signature` over the raw body, `charge.success`, `/transaction/initialize`, `/transaction/verify/:reference`, refund fields) came from third-party summaries (K30). If network access exists, re-verify against official docs and, with an owner-supplied `sk_test_` key, run the manual check list in `docs/reports/batch-3.md` §M. Do not build refunds execution until verified.
2. CI job `db-and-e2e` was written but not yet run on GitHub (K23): check its result on the PR and fix it.
3. Handover signature lives in a database `bytea` (K26), has no keyboard alternative (K27); pickup code cannot be re-issued/unlocked (K28). Decide with the owner; build a support unlock/re-issue tool only if approved.
4. Concurrency tests prove outcomes, not lock presence (K31): where a lock is the control, add a test that fails without it (e.g. interleave using `pg_sleep`/advisory locks) or state clearly that a constraint is the backstop.
5. After a rejected form submission React clears typed fields (K33); keep this in mind for rider forms (use `defaultValue` or preserve state).
6. Test hygiene reminders: provider/event ids must be unique per run; assert the `/cart` URL after "Add to cart"; scope alerts to `main`; wait for server-action POST + form reset; never `pkill -f` a pattern that matches your own shell; `mockPaymentsAllowed`/`paystackConfig` fail closed.

## 0.2 Owner decisions still open (do not decide)

MFA recovery after losing all authenticators; backup authenticator required for privileged roles?; forced TOTP at sign-up; default `customer` role for all accounts; TOTP replay/lockout trade-offs; real pilot values (delivery fee, platform fee %, expiry, caps — placeholders in `platform_settings`); one store per vendor; stock reserved at order creation; anonymous carts; stock/ledger policies for vendor-rejected paid orders; repository rename (owner action); AFIT-approved delivery points and real coordinates (none exist; use fictional/fake only).

## 0.3 Engineering rules (unchanged, approved)

Next.js App Router + TS strict + Tailwind PWA; Supabase Postgres/Auth/RLS; modular monolith; atomic/security rules in hardened SECURITY DEFINER functions (fixed `search_path=''`, EXECUTE revoked from PUBLIC/anon, identity+role+aal inside, allowed/denied/concurrency tests, catalog hygiene test); browser never talks to Supabase; no `NEXT_PUBLIC_`; every protected prefix in `ROUTE_POLICIES` with `enforceRoutePolicy` in its layout (route handlers check access themselves); no `loading.tsx` above guards; privileged roles need aal2; money is integer kobo; Paystack test mode only, no settlement/payout; local-first; secrets never committed (`check:secrets` must pass); `APP_ENV` fails closed. Local stack: `pnpm db:start`, `pnpm db:reset`, `bash scripts/make-env-local.sh`, `pnpm dev:paystack`. Verification set: `pnpm lint`, `typecheck`, `format:check`, `test`, `test:db`, `build`, `check:secrets`, `pnpm exec supabase db lint --local`, `pnpm exec playwright test` (mobile-360 + desktop).

# PART 1 — SCOPE (from `docs/handoff/PHASED_ROADMAP.md`)

## Phase 7 — Rider onboarding, active shift, capacity-five assignment

- Rider application/approval (admin), profile; **Go Active / Go Inactive** (replaces the labelled preview); active shift record.
- Eligible order offers: delivery orders in `AWAITING_RIDER` (set by Batch 3) offered only to active, approved riders; offers visible via RLS to eligible riders only.
- **Atomic maximum of five accepted active deliveries per rider**, enforced in one hardened function; the capacity count must not be bypassable by concurrent accepts or by two riders accepting one order.
- Assignment-bound QR/code tokens (hashed at rest, single use, bound to order + rider); vendor-to-rider handover of the parcel (rider shows the assignment token to the vendor; vendor confirms) reusing the Batch 3 evidence patterns; route/order sequence; rider issue reporting.
- Orders move `AWAITING_RIDER → RIDER_ASSIGNED → PICKED_UP_BY_RIDER → EN_ROUTE` through the transition function; **riders have no action that marks an order delivered** (Phase 9).
- **Exit:** concurrency tests prove six simultaneous accepts cannot exceed five active jobs; two riders accepting one order yields exactly one assignment.

## Phase 8 — Live location, map, ETA, automatic arrival

- Location adapter interface with a **fake provider first**; real coordinates only after AFIT approval (none available: use fictional coordinates and label them).
- **Tracking is off-duty by default**: location is collected only while the rider is Active and has an assigned delivery; permission requested only on Go Active with a plain-language explanation; revoked/denied permission handled; no tracking history kept beyond the retention placeholder.
- GPS update service: freshness and accuracy checks (reject stale/inaccurate fixes), rate limit per rider, privacy access tests (customers see only their own rider's position for their active order; nobody else; vendors never).
- Live map updates (Supabase Realtime or polling — choose after verifying Realtime RLS behaviour locally; if Realtime cannot run in this sandbox use polling and say so), route distance/ETA via a provider adapter (fake), arrival geofence around approved delivery points; **arrival is never based on stale or inaccurate GPS** and never completes an order.
- Stale-location UX for customers; screen-wake-lock "keep this screen open" guidance for riders. **Do not claim background tracking works**: the owner must test on real Android devices; produce a manual test script and record the result as UNVERIFIED until evidence is supplied. If the PWA cannot work, stop and report; do not build a native app without approval.
- **Exit:** tracking off-duty by default; privacy access tests pass; arrival not based on stale/inaccurate GPS.

## Requirement traceability (every original AFIT requirement that touches Phases 7–8; source in brackets)

| #   | Requirement                                                                                                                                                                                                                                             | Source                             | Where enforced / tested                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| R1  | Rider is an approved role; onboarding is reviewed before activation; vendor/rider accounts need MFA (aal2)                                                                                                                                              | PRODUCT_REQUIREMENTS §1, §Security | RLS + function checks; route policy; denied tests                         |
| R2  | Signed rider terms / conduct / privacy acknowledgement recorded before first activation (placeholder text; counsel supplies final)                                                                                                                      | PHYSICAL_ACTION_CHECKLIST §D       | acknowledgement table; Go Active refuses without it                       |
| R3  | Tables `rider_profiles`, `rider_shifts`, `rider_location_current` (ephemeral), `rider_location_history` (limited retention)                                                                                                                             | ARCHITECTURE §Data                 | migration + RLS tests                                                     |
| R4  | **Go Active** is explicit; UI shows "Location sharing ON" and a one-tap Go Inactive; no location collected before Go Active or off duty                                                                                                                 | PRODUCT §5, RULES                  | e2e + DB test (location write refused when inactive)                      |
| R5  | Ending a shift with active deliveries requires safe handover/reassignment or a controlled pause; never silently drops orders                                                                                                                            | PRODUCT §5                         | function test for each case                                               |
| R6  | Server hard maximum of **5** accepted active deliveries per rider, atomic                                                                                                                                                                               | PRODUCT §5, DECISIONS #12          | parallel test: 6 accepts -> 5 succeed; two riders on one order -> 1       |
| R7  | Rider sees assigned orders, vendor pickup point, approved delivery point, route sequence, distance, ETA                                                                                                                                                 | PRODUCT §5                         | e2e                                                                       |
| R8  | GPS is automatic; **no manual coordinates and no manual "I have arrived"** as source of truth                                                                                                                                                           | PRODUCT §5                         | no such endpoint exists; test that the API rejects client-claimed arrival |
| R9  | Arrival inferred server-side from geofence + accuracy + freshness; "GPS issue" fallback creates a **support flag, not an arrival**                                                                                                                      | PRODUCT §5                         | DB tests with stale/inaccurate/outside-fence fixes                        |
| R10 | Rider problem reports with reason: vendor not ready, recipient unavailable, blocked route, safety/security restriction                                                                                                                                  | PRODUCT §5                         | table + tests                                                             |
| R11 | **Rider cannot complete or mark delivered**; completion only via valid handover evidence in Phase 9                                                                                                                                                     | RULES, DECISIONS #11               | test: no rider-callable function reaches DELIVERED/COMPLETED              |
| R12 | Assignment-bound QR/code token: one order + the currently assigned rider/vendor, one-time, expiring, hashed at rest; vendor cannot hand a package to an unrelated rider                                                                                 | RULES, DECISIONS #10, PRODUCT §4   | replay / wrong-rider / wrong-order / expired tests                        |
| R13 | Location shared only with the order's recipient and authorised operations staff; not with other customers, vendors or riders; not after the order ends                                                                                                  | PRODUCT §6, RULES                  | RLS tests per role                                                        |
| R14 | Tracking starts only after Go Active **and** an accepted delivery; stops when inactive or no active work remains                                                                                                                                        | ARCHITECTURE §6                    | lifecycle tests                                                           |
| R15 | Do not retain every GPS ping: current position separate; history limited by a configurable retention setting; purge job designed (and scheduled via the Batch 3 jobs route pattern)                                                                     | RULES, ARCHITECTURE §5             | purge function test                                                       |
| R16 | Use accuracy + timestamp on every fix; mark location stale when updates stop; reject stale/inaccurate fixes for arrival                                                                                                                                 | PRODUCT §6                         | tests                                                                     |
| R17 | Route distance (not straight-line) when a routing provider exists; adapter interface with a **fake provider**; straight-line fallback clearly labelled                                                                                                  | PRODUCT §6                         | adapter unit tests                                                        |
| R18 | Synthetic locations only; approved delivery points from AFIT are not yet known; example points in documents are not real                                                                                                                                | RULES, DECISIONS                   | seed/labels                                                               |
| R19 | Never auto-refund or penalise a rider/customer solely because a location point is missing                                                                                                                                                               | RULES                              | no such code path; documented                                             |
| R20 | Notifications must not reveal sensitive military or location details                                                                                                                                                                                    | PRODUCT §Notifications             | copy review; no coordinates in any message                                |
| R21 | PWA background-location reliability is **unverified** until tested on target Android devices; if inadequate, stop and report evidence; no native app without owner approval                                                                             | DECISIONS #7, ARCHITECTURE §6      | manual test script; status UNVERIFIED                                     |
| R22 | Founder-facing physical-action items that block real use (AFIT permission, delivery points, rider rules, map detail) stay listed in `docs/external-approvals.md`                                                                                        | PHYSICAL_ACTION_CHECKLIST          | doc check                                                                 |
| R23 | Carry forward all earlier requirements unchanged: server-side authority, hardened DB functions, RLS everywhere, 2FA mandatory, handover signature mandatory, rider capacity 5, location opt-in, refunds/returns/disputes later, Paystack test mode only | master brief                       | existing suites stay green                                                |

# PART 2 — TESTS AND ACCEPTANCE CRITERIA

## 2.1 Database tests (must exist and pass)

- RLS allowed/denied for every new table and role (customer, vendor, rider, support, finance, admin, anon, aal1).
- Capacity: six parallel accepts by one rider -> exactly five succeed; two riders accepting one order -> exactly one; accept while inactive refused; accept of an unpaid/unready order refused. Where a lock is the control, include a test that fails without it.
- Shift end with active deliveries: each branch (reassign, controlled pause, refuse) tested.
- Token tests: replay, wrong order, wrong rider (after reassignment the old token dies), expired, locked after repeated failures, hash-only storage.
- Location: write refused when inactive/off duty/no active delivery; stale and inaccurate fixes stored but never used for arrival; geofence boundary cases; rate limit; customer sees only their own order's rider and only while active; vendors/other riders/other customers see nothing; nothing visible after the order ends; retention purge removes only aged history.
- No rider-callable function can reach DELIVERED/COMPLETED; manual arrival claims rejected.
- Catalog hygiene test still passes (fixed `search_path`, no PUBLIC/anon EXECUTE, anon allowlist unchanged).

## 2.2 Unit tests

Geofence maths, ETA/route adapter (fake and fallback), freshness/accuracy rules, token generation/hash, retention calculation.

## 2.3 Browser tests (mobile-360 and desktop, axe + no horizontal scroll on every new page)

Rider application -> admin approval -> terms acknowledgement -> Go Active (location permission granted via Playwright geolocation with fake coordinates) -> accept offers -> vendor handover to the assigned rider with token -> rider shares fake location -> customer sees map/ETA and stale state when updates stop -> Go Inactive stops collection. Plus: sixth accept shows a clear message; wrong rider token refused; denied permission handled; no location requests before Go Active (assert no geolocation call).

## 2.4 Acceptance criteria

1. Six simultaneous accepts cannot exceed five active jobs. 2. Tracking is off by default and only on during an active shift with active work. 3. Privacy access tests pass for every role. 4. Arrival is never derived from stale/inaccurate GPS or client claims. 5. No rider action completes an order. 6. All earlier suites remain green (118+ unit, 123+ DB, 134+ e2e) and `check:secrets`, lint, typecheck, format, build, `supabase db lint` pass. 7. Docs, checklist, known issues, manual-verification list (including the Android background-location script) updated. 8. No real coordinates, secrets, paid services or deployments.

# PART 2b — OTHER NON-NEGOTIABLE CHECKS

RLS + denied-access tests for every new table; concurrency tests for capacity and assignment; migration lint clean; a11y (axe) and 360px checks for new pages; docs, requirements checklist, known issues updated; no secrets; no real coordinates.

# PART 3 — REPORT AND STOP

Finish with the A–O report, the independent review package, exact commands/results, and the complete Batch 5 prompt (Phases 9 + 10; corrections first). Stop and wait for explicit owner approval. Stop and report if: the local stack cannot run; a security-critical requirement cannot be met; Realtime/location cannot be tested locally; any step needs real coordinates, a paid service, deployment or a live credential.
