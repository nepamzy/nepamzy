# AFIT MARKET — IMPLEMENTATION BATCH 5

**Phase 9 (delivery proof, signature, QR/code and completion) + Phase 10 (refunds, returns, disputes and support)**

Version: v1 (draft by the implementing engineer at the end of Batch 4, 12 October 2026). **The owner must review and explicitly approve this complete prompt before implementation begins. Apply the owner's own corrections to Batch 4 first.** Continue from the current branch and latest valid commit; inspect Git status and history before changing anything. Do not begin Phase 11. Do not claim ChatGPT or the owner reviewed anything until evidence is submitted and reviewed.

---

## PART 0 — CORRECTIONS AND CARRIED-FORWARD FINDINGS FROM BATCH 4 (binding; read first)

### 0.1 What Batch 4 delivered (reported by the implementing engineer, not independently reviewed)

Rider applications/approval/suspension; rider terms acknowledgement (placeholder text); Go Active/Inactive shifts; delivery offers; atomic five-delivery cap; vendor-to-rider assignment tokens; rider issue reports (incl. GPS issue as a support flag); synthetic location pipeline with validation, privacy-scoped reads, retention purge and server-side geofence arrival; customer tracking card with a labelled sample map; plus Batch 3 corrections (pickup secret moved to `PICKUP_CODE_SECRET`; signature capture method recorded; typed acknowledgement available but OFF). Exact results are in `docs/reports/batch-4.md`.

### 0.2 Facts Phase 9 must build on (do not re-decide)

- Orders reach **`ARRIVAL_DETECTED`** from rider movement. **Arrival is not delivery.** `DELIVERED`/`COMPLETED` still require recipient proof (this batch). The existing states `AWAITING_RECIPIENT_PROOF`, `DELIVERED`, `COMPLETED` are in the order CHECK; use them through `app_private.step_order` only.
- `delivery_assignments` "active" statuses are `accepted`, `picked_up`, `en_route`, and two partial unique indexes depend on that list (one active assignment per order; one active slot per rider). **Phase 9 must add a terminal assignment status (for example `completed`) and update both indexes and every status list consistently**, then re-run the control-removal concurrency tests in `tests/db/rider-concurrency.test.ts`. Completing a delivery must free the rider's slot.
- Customer pickup (vendor counter) already works end to end (`complete_pickup`: code + recipient + signature, evidence immutable). Delivery completion is new and must reuse the evidence patterns, not copy-paste a weaker rule.
- `rider_post_location` never completes an order; keep it that way. Tracking must **stop** for an order when it completes (location stop behaviour is a Phase 9 requirement).
- Customer pickup codes are derived from `PICKUP_CODE_SECRET` (server-only; fail closed). New proof codes/tokens must not introduce secrets in the database. Random tokens stored as hashes are fine (see assignment tokens).
- Money is integer kobo. Paystack is **test mode only** and was never verified against the real API (K19/K30). Refund **execution** against a provider remains out of scope unless the owner has supplied verification evidence; build the data model, calculation, caps, idempotency and the approval workflow, with a clearly labelled stub/fake provider.

### 0.3 Open owner decisions (do NOT decide; stop only the specific work that needs them)

MFA recovery after losing all authenticators; backup authenticator for privileged roles; TOTP enforcement point; TOTP replay/lockout trade-offs; pilot fees/expiry/caps; multi-store vendors; stock reservation and rejected-paid-order refund/stock behaviour; anonymous carts; **pickup-code re-issue/unlock (K28)**; **signature storage (database vs private object storage, K26) and whether a typed acknowledgement may stand in for a drawn signature (K27) — this decides whether delivery can ever be completed for a recipient who cannot draw**; who schedules the expiry and location-purge jobs (K18/K39); repository rename; AFIT-approved delivery points/coordinates/zones; rider terms wording; whether a mapping provider is purchased; **food/hygiene return policy per category** (needed for Phase 10 and must be configurable, not hard-coded).

### 0.4 Known issues carried forward (keep in `docs/known-issues.md` until demonstrably resolved)

K18/K39 unscheduled jobs; K19/K30 Paystack unverified; K26/K27 signature storage and keyboard path; K28 pickup-code unlock; K29 refund execution; K33 form values clear after a rejected submit; K34 background location **UNVERIFIED** (manual Android script exists); K35/K36 no real map provider, synthetic coordinates; K37 polling not Realtime; K38 placeholder rider terms; K41 a rider carrying a parcel cannot self-release (Phase 10 operations tooling should provide a supervised path); K42 delivery points without coordinates never yield arrival; K44 pickup-secret rotation not designed.

### 0.5 Test and engineering lessons (follow them)

- Wait for the server-action POST and the form reset before the next step; scope alert locators to `main`; remeasure element positions after an error message appears (the signature canvas moves); React clears uncontrolled fields after every action, and a success message vanishes when the page re-renders into another state — assert the resulting state.
- Chromium delivers an emulated geolocation only when the position **changes**; nudge it. A `Permissions-Policy` header can silently block a browser feature — test headers.
- DB tests that count rows globally must clear or scope their data inside a rolled-back transaction (`isoTx`); append-only tables (payment events, handover evidence) need unique ids per run.
- Concurrency tests must prove the invariant **and** their own power: remove controls one layer at a time with the `app_private.test_seam` barrier, restore afterwards, and say which layer is the real backstop. Do not claim a lock is essential if a constraint is.
- Run `pnpm exec supabase db lint --local`; do not mark a read-only-looking function `stable` if it calls anything volatile.
- Never `pkill -f` a pattern that matches your own shell. Docker may need `pkill containerd` + restart; `pnpm db:start` handles dockerd.
- Report CI honestly: give the exact commit SHA and each workflow/job result; never report a skipped check as passed.

### 0.6 Engineering rules (unchanged and mandatory)

Next.js App Router, React, TypeScript strict, Tailwind PWA; Supabase Postgres/Auth/RLS; modular monolith; the browser never talks to Supabase; no `NEXT_PUBLIC_` secrets; all sensitive mutations server-side; critical rules in hardened `SECURITY DEFINER` functions (fixed `search_path`, EXECUTE revoked from PUBLIC/anon, identity + role + aal checks inside) or constraints; RLS and tested policies on every new table; every protected prefix in `ROUTE_POLICIES` with `enforceRoutePolicy` in its layout; route handlers check authorization themselves; privileged roles need aal2; integer kobo; Paystack test mode; no production deployment, real customers, real coordinates, paid services or committed secrets; `check:secrets` and `APP_ENV` fail-closed rules stand. Verification set: `pnpm lint`, `typecheck`, `format:check`, `test`, `test:db`, `build`, `check:secrets`, `pnpm exec supabase db lint --local`, `pnpm exec playwright test` (mobile-360 + desktop); local stack via `pnpm db:start`, `bash scripts/db-reset.sh`, `bash scripts/make-env-local.sh`.

---

## PART 1 — PHASE 9: DELIVERY PROOF, SIGNATURE, QR/CODE AND COMPLETION

Source of truth: `docs/handoff/DELIVERY_PROOF_AND_DISPUTES.md` §1–§6 and `PHASED_ROADMAP.md` Phase 9. Re-read both before coding.

### 1.1 Policy

**A signature is mandatory** for a successful pickup or delivery. An optional order-bound QR or in-app code may be added by the recipient but **never replaces the signature in V1**. No single signal is trusted alone (GPS shows approximate location only; a signature proves a signature action; a code can be shared or coerced). The server is the source of truth for transitions and proof validation. **The rider has no action that marks an order delivered or completed.**

### 1.2 Recipient handover (delivery)

- After arrival is detected (`ARRIVAL_DETECTED`) the order moves to **`AWAITING_RECIPIENT_PROOF`** through an authorised server path (not by a rider-claimed arrival and not by GPS alone).
- The recipient opens their own authenticated order screen, sees the **order summary before signing**, may choose the optional code, then signs. The recipient must **independently confirm receipt in their own app where possible**; avoid making the rider the only holder of the verification secret.
- The server checks: the assigned rider and active assignment, correct order and status, recipient authorisation, signature presence and validity, any selected code, and reasonable location/timestamp evidence. Then it records proof, completes the order (`DELIVERED` then `COMPLETED` as the existing state machine defines), writes an immutable audit event, **stops location sharing for that order**, frees the rider's slot, and generates the receipt (extend the existing PDF receipt: add delivery proof and rider/time/arrival evidence).
- Signature rules: reuse the validated PNG/size rules and the `capture_method` column; a typed acknowledgement may be used only if the owner has enabled `typed_signature_enabled` **and** decided it satisfies the rule (default off). Never present typed text as a drawn signature. Evidence stays protected by RLS/server checks; do not migrate storage without the owner decision (0.3).

### 1.3 QR / in-app code

- Cryptographically random, short-lived, one-time per order/handover; **store only a hash**; expire and invalidate after use, reassignment, cancellation or completion.
- Bind to order id, fulfilment type, assigned rider (delivery), intended recipient/session where feasible, and expiry. Never a static vendor QR as proof of a delivery. A rider QR/code identifies the rider/order assignment but **scanning it must not itself complete the order**.
- Validate server-side; rate-limit attempts; reject replay, expiry, wrong rider, wrong order, wrong fulfilment mode. No personal data, access tokens or location in QR payloads. If a QR image is generated use a pure-JS library after a dependency review (record it in the report); a short code remains the fallback. No SMS OTP (cost): in-app codes only.
- Reconcile with the existing customer pickup code and the Batch 4 assignment token: three different secrets with three different purposes; document each and test that none can be substituted for another.

### 1.4 Vendor counter pickup

Keep the current flow working and add the universal **Confirm handover** experience from the policy document: scan or type a code; the app resolves exactly one eligible order and shows number, items and status; vendor confirms; recipient signs; server validates token, order state, vendor permission and signature; order completes; receipt is created; code expires. A code must never select or complete an arbitrary order without full server validation.

### 1.5 Operations

Provide a supervised path (support/admin, aal2, audited, reason required) for the cases Batch 4 deliberately left manual: recipient unavailable, rider cannot complete, parcel in hand when a rider is suspended. These actions **must not mark an order delivered**; they move it to a safe state or open a dispute/return case (Phase 10). Do not penalise anyone automatically.

### 1.6 Phase 9 exit criteria

No order completes without **all** mandatory conditions. Tests prove: replay, forgery, wrong rider, wrong order, wrong fulfilment mode, expired code, stale/inaccurate arrival, missing signature, rider-only completion attempts, double completion races (exactly one wins; evidence written once), slot freed exactly once, location stops, receipt created once. Include control-removal tests for any lock-based control.

---

## PART 2 — PHASE 10: REFUNDS, RETURNS, DISPUTES AND SUPPORT

Source of truth: `DELIVERY_PROOF_AND_DISPUTES.md` §7–§10 and `PHASED_ROADMAP.md` Phase 10.

### 2.1 Principles

No automatic guilt decisions. Do not assume either side is truthful; do not punish anyone on GPS alone. The original delivery proof stays immutable; add linked events instead of rewriting history. A "pending settlement" label is **not** legal escrow: keep payment states so settlement policy can change without corrupting orders; settlement/payout stays DISABLED.

### 2.2 Dispute workflow

1. Customer reports an issue and chooses a category (missing item, wrong item, damaged, not received, quality, other).
2. The order/payment is flagged and relevant evidence is preserved (a neutral evidence bundle: order contents and amounts, payment transaction/webhook status, vendor accept/prepare/ready timestamps, vendor-to-rider handover event, assignment history, minimised location points with timestamp/accuracy, arrival result and geofence, code validation outcomes (never plaintext secrets), signature asset/metadata (private), recipient report, in-app messages, voluntary photos, related prior disputes only where lawful and necessary).
3. Vendor and rider may each submit separate statements/evidence; support reviews the timeline **without changing original events**.
4. Support applies the published policy: full refund, item-level partial refund, fee adjustment, replacement, return, or reject **with a reason**.
5. Record decision maker, reason, amount, evidence references and timestamp; notify affected parties (in-app only this batch); allow escalation. Admin review and audit history are required.

### 2.3 Refunds

- Full refund; partial refund for selected missing/damaged/wrong items; proportional delivery/service-fee adjustment where policy says so; replacement/re-delivery where operationally possible.
- Calculation is **server-side** from immutable `order_items` prices, quantities, discounts and the fee policy; refund amounts can never exceed the refundable balance (received minus already requested/processed); item-level caps; idempotency keys prevent duplicates; reconcile with `ledger_entries` and `reconciliation_flags` (extend, do not bypass). Example to test: items ₦1,000 + ₦1,500 + ₦500 with the ₦1,500 item missing starts at ₦1,500, then applies discounts/fees consistently.
- The existing `refund_request` primitive (finance/admin, capped) is the starting point. Execution against Paystack remains **not implemented** unless the owner provides verification evidence; use a fake/stub provider adapter clearly labelled, with a state machine (`requested → approved → pending → processed|failed`) and reconciliation. Never claim real refunds work.

### 2.4 Returns

Policy depends on category; **food/hygiene rules are configurable settings, not code**. Workflow: support decides required/optional/unsafe; if required create a `RETURN_REQUESTED` case with the approved method; create a **separate return task** linked to the original order (never mixed with delivery proof); assign a rider only after vendor agreement and approved handling; return-specific code/QR and handover record; vendor confirms receipt and records condition; support finalises refund/replacement; a no-return refund is possible when logistics cost exceeds item value. Never dispatch a rider to collect food or goods without explicit return authorisation and handling instructions. States `RETURN_REQUESTED`, `RETURN_IN_PROGRESS`, `RETURNED_TO_VENDOR`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED` already exist in the order CHECK — use the central transition function; add return-task and dispute tables with RLS.

### 2.5 Roles and screens

Customer: report, view timeline, statements, decision. Vendor and rider: view the case they are party to and submit a statement (no access to the other side's private data beyond the neutral timeline). Support/finance/admin: queue, evidence bundle, decision form with reason, audit history. Separate permissions: support decides cases, finance approves money movement above thresholds or executes refunds (configurable), platform admin configures policy. All aal2 for privileged roles.

### 2.6 Phase 10 exit criteria

Refund caps and idempotency tests pass; return-state tests pass; food/hygiene policy is configurable; no automatic guilt decisions exist anywhere in the code; every decision records maker, reason, amount, evidence, timestamp; original proof unchanged (immutability tests); concurrency test for double-refund races with control-removal analysis.

---

## PART 3 — REQUIREMENT TRACEABILITY (all must be traceable to code, tests and docs)

| ID    | Requirement                                                                                               | Verification              |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| P9-1  | Signature mandatory for delivery and pickup; typed acknowledgement only if enabled by owner               | DB + browser tests        |
| P9-2  | Code/QR optional, never a replacement for the signature                                                   | DB tests                  |
| P9-3  | Hashed, expiring, one-time, bound tokens; rate limits; replay/wrong-rider/wrong-order/wrong-mode rejected | DB tests                  |
| P9-4  | Server-controlled completion; rider has no delivered/completed action                                     | catalog + behaviour tests |
| P9-5  | Recipient sees summary before signing and confirms in their own app                                       | browser tests             |
| P9-6  | Location stops for the order on completion; slot freed once                                               | lifecycle tests           |
| P9-7  | Immutable audit event and receipt created once                                                            | DB tests                  |
| P9-8  | Terminal assignment status added; both unique indexes updated; rider concurrency tests re-run             | concurrency tests         |
| P10-1 | Item-level and full refunds calculated server-side from immutable lines                                   | unit + DB tests           |
| P10-2 | Caps, idempotency, reconciliation with ledger/flags                                                       | DB + concurrency tests    |
| P10-3 | Dispute workflow with neutral evidence bundle and separate statements                                     | DB + browser tests        |
| P10-4 | Return tasks separate from delivery proof; configurable food/hygiene policy                               | DB tests                  |
| P10-5 | Reasoned decisions with maker/amount/evidence/time; no automatic guilt                                    | DB tests, code review     |
| P10-6 | Original proof immutable; linked events only                                                              | immutability tests        |
| X-1   | All earlier requirements, secrets handling, privacy rules and test suites remain green                    | full regression           |

Do not mark a requirement complete because a screen exists.

---

## PART 4 — TESTS AND ACCEPTANCE

### 4.1 Database

RLS allow/deny for every new table and role (customer, vendor, rider, support, finance, admin, anonymous, aal1); proof completion success and every rejection listed in 1.6; double-completion and double-refund races with layered-control analysis and control-removal tests; token hash-only storage; refund arithmetic including rounding, discounts, fee adjustment and caps; idempotent replays; dispute and return state transitions; evidence immutability; catalog hygiene (fixed `search_path`, no PUBLIC/anon EXECUTE, anon allowlist unchanged); no function reachable by a rider sets `DELIVERED`/`COMPLETED`.

### 4.2 Unit

Refund calculator; token generation/hash/expiry; policy configuration parsing; evidence-bundle assembly (no plaintext secrets, no unnecessary location).

### 4.3 Browser (mobile-360 and desktop, axe + no horizontal overflow on every new page)

Delivery completion journey (arrival → summary → optional code → signature → receipt; rider cannot complete); wrong code/rider/order refused; vendor counter confirm; dispute reported → statements → decision → partial refund recorded; return task path; keyboard operability and clear labels; rejected submissions keep entered values where appropriate; synthetic coordinates only.

### 4.4 Regression and CI

Run the full verification set and report actual counts and failures (baseline from Batch 4 is in its report). Ensure GitHub Actions runs on the **implementation** commit; report the SHA and each job's result.

### 4.5 Acceptance criteria

1. No delivery or pickup completes without a valid signature and every mandatory check. 2. No rider action completes an order. 3. Tokens are hashed, expiring, one-time and bound. 4. Completion frees capacity exactly once and stops tracking. 5. Refund amounts never exceed the refundable balance and cannot be duplicated. 6. Decisions are reasoned and audited; there are no automatic guilt decisions. 7. Original proof is immutable. 8. Earlier suites remain green or blockers are reported. 9. Docs, checklist, known issues updated; physical approvals kept visible in `docs/external-approvals.md`. 10. No real coordinates, live credentials, paid services or deployments.

---

## PART 5 — REPORTING AND STOP CONDITIONS

Finish with the full A–O report (A summary; B requirements coverage; C exact files changed; D frontend; E backend/database/architecture; F security; G exact commands and actual results; H what worked; I what failed or is incomplete; J technical debt; K dependencies/cost; L decisions needing owner approval; M manual verification required; N completion assessment COMPLETE / CONDITIONALLY COMPLETE / INCOMPLETE / BLOCKED; O the complete **Batch 6 prompt** for Phases 11 and 12 with all Batch 5 corrections at its beginning) and a separate **INDEPENDENT REVIEW PACKAGE FOR CHATGPT** (report, diffs and code excerpts, migration and RLS summaries, critical functions, test results, concurrency evidence, CI status for the implementation commit, unresolved defects and owner decisions, the Batch 6 prompt). Update README, known issues, review log, requirements checklist, security/privacy, external approvals, ADRs and phase reports.

Stop and report if: the local stack cannot run; a security-critical requirement cannot be met; an owner decision is needed to proceed safely (especially the signature/typed-acknowledgement decision for delivery); a step needs real coordinates, a paid service, production deployment, live credentials, or verified Paystack refund behaviour that is not available. Do not begin Phase 11. Do not claim the project is ready for public launch.
