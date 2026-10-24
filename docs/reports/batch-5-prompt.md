# AFIT MARKET — MASTER BATCH 5 PROMPT

**All previous corrections + Phase 9 (delivery proof, signature, QR/code and completion) + Phase 10 (refunds, returns, disputes and support)**

Version: **v2 — consolidated** (supersedes the v1 draft; one complete prompt, no separate corrections prompt). Prepared 11 October 2026 from the owner's consolidation instruction. Project: AFIT Market. Batch 5 of 6.

**Execution mode: IMPLEMENTATION IS NOT AUTHORISED BY THIS FILE.** The owner must review this complete prompt and explicitly approve implementation separately. Until then nothing in Phases 9 or 10 may be implemented. Do not claim the owner or ChatGPT reviewed or approved anything without actual evidence.

---

## PART 0 — ABSOLUTE INSTRUCTIONS (read first)

You are continuing an existing project. Before changing anything, inspect: Git status and uncommitted changes; the current branch and latest commit; recent history; `docs/reports/batch-1.md` … `batch-4.md`; handoff and architecture docs; `docs/known-issues.md` and `docs/external-approvals.md`; all earlier prompts and reports; the current schema, migrations, policies, functions, triggers and grants; existing unit, database, integration and browser tests; the GitHub Actions workflow; the Batch 6 prompt (`docs/reports/batch-6-prompt.md`). **Do not assume earlier reports are accurate; verify important claims against the repository.**

Do not overwrite user changes. Do not rename the repository, reset branches, force-push, delete data, replace the architecture or perform unrelated refactoring. Do not assume the repository was renamed to `afit-market`. Continue from the actual current repository and branch.

Stop boundaries for the whole batch: no deployment; no live payments or production credentials; no purchased services; no real AFIT coordinates; no real customer or financial transactions; no Phase 11 or Phase 12 work; never ask the owner to paste a secret; never claim ChatGPT or the owner approved anything without evidence. If the repository, local services or GitHub permissions prevent verification, report the limitation honestly and stop the work that depends on it.

Order of work after the owner approves: (1) verify Part A and the Batch 4 evidence in A17; (2) apply the corrections in A8 (rider-terms) first, with tests; (3) Phase 9; (4) Phase 10; (5) full regression; (6) documentation, report, review package and Batch 6 prompt update; (7) stop.

---

## PART A — CARRIED-FORWARD CORRECTIONS FROM ALL PREVIOUS BATCHES (binding unless the owner explicitly changes them)

### A1. Scope and architecture

AFIT Market is a campus marketplace for authorised students, lecturers, military personnel and other permitted users to buy food, drinks, souvenirs and other permitted goods from campus vendors. Customers browse, cart, choose pickup or delivery, pay through the approved provider, follow delivery, confirm receipt with mandatory delivery evidence, request support/refunds/returns where permitted, and review completed transactions. Vendors manage approved shops, catalogues and orders. Riders accept eligible assignments between approved points. Administrators and authorised support staff manage approvals, disputes and operations within their permissions.

Approved architecture (unchanged): Next.js App Router, React, TypeScript strict, Tailwind PWA; Supabase Postgres, Auth, RLS, Realtime and private storage where appropriate; modular monolith; server-side enforcement of critical rules; Paystack preferred with real operations restricted to approved environments. **Do not** introduce Nango, Composio, Pipedream, Make or Zapier; do not replace Supabase (e.g. with Neon); do not rebuild in another framework.

### A2. Local-first and fail-closed

Never deploy, enable live payments, expose secrets, send real customer messages, buy paid services or use real campus coordinates without explicit approval. Use synthetic data, test accounts and fake providers. If local Supabase/Docker fails: record the exact failure, state what could not be tested, report the blocker and stop dependent work; never silently switch to remote databases, paid infrastructure, production services or weaker tests. `APP_ENV` fails closed. No secrets in `NEXT_PUBLIC_` variables. Never paste credentials into reports, source control, screenshots or conversation.

### A3. Database security

Critical rules are enforced by the database and trusted server code, not frontend controls. Preserve RLS, restricted table access, correct grants/revocations, hardened functions (fixed `search_path`, restricted EXECUTE, server-side identity/role/aal checks), transactional consistency, idempotency, concurrency protection and auditable financial/delivery transitions. For critical operations test both permitted and denied access across anonymous, customer, vendor, rider, support, finance and administrator roles, at insufficient and sufficient authentication assurance. A user must never gain permission by editing browser requests. Never trust client-supplied prices, balances, roles, assignment ids, refund amounts, recipient identity or completion status. Money is integer kobo.

### A4. Authentication and MFA

Unresolved unless the owner records a decision: MFA recovery policy; backup authenticator; whether customers enrol TOTP at signup or before protected operations; default customer-role assignment; TOTP replay protection and lockout; aal2 requirements for privileged actions. Do not introduce a weaker custom recovery mechanism or an insecure recovery-code table; do not disable MFA enforcement to pass tests; do not assume an authenticated session has aal2.

### A5. Pickup-code secret

Batch 4 reportedly moved the pickup secret to server-only `PICKUP_CODE_SECRET` (fails closed), storing only a nonce and a hash in the database. **Verify in the code before relying on it**, then preserve it. Never return pickup codes, signing secrets, private tokens or sensitive evidence through unauthorised responses; never place secrets in bundles, URLs, logs or reports. Preserve expiry, single use, assignment binding, replay protection and brute-force protection. **Pickup-code reissue/unlock (K28) and secret rotation (K44) are owner decisions**: do not silently add a reissue or unlock function; if a safe workflow needs one, document options and ask.

### A6. Payment safety (Batch 3)

Real Paystack behaviour is unverified (K19/K30). Existing: test-mode integration, fake-provider tests, server-side amount verification, raw-body signature verification, idempotent events, ledger, reconciliation flags, refund-request primitives (no completed real refunds). Do not describe fake-provider tests as proof of real Paystack behaviour; do not enable live payments, execute real refunds, implement settlement/payout or claim escrow. Phase 10 uses a fake/stub provider unless the owner separately authorises a controlled provider-verification exercise with official documentation and owner-controlled test credentials. Never ask the owner to paste a secret key.

### A7. Financial and stock consistency

Preserve integer kobo, server-authoritative prices, immutable order snapshots, payment-to-order amount matching, idempotent payment events, duplicate-event protection, audit records, stock consistency, refund caps (no over-refunds) and reconciliation for ambiguous states. A refund does not automatically mean restock; a rejected paid order does not automatically mean stock can be released. Stock reservation and rejected-paid-order handling are **unresolved**: inspect current behaviour before extending it, preserve safe behaviour, and report rather than invent a business rule.

### A8. Rider terms placeholder defect — REQUIRED DATABASE CORRECTION (K48)

**Verified in the repository during preparation of this prompt:** migration `20261013000002_riders_assignments.sql` inserts terms version `dev-placeholder-1` with `is_placeholder = true`; `rider_go_active()` and `rider_accept_order()` only check that the rider has an acknowledgement row for the current version (`terms_not_acknowledged`) and **never reject a placeholder version**. The only use of `is_placeholder` is the informational `terms_is_placeholder` field returned by `my_rider` for the UI. Therefore a rider can currently go active and accept deliveries on placeholder terms.

Required correction (database level, not just a disabled button):

- A placeholder rider-terms version must never authorise real rider operations: `rider_go_active`, `rider_accept_order` (and any other function that gates on terms) must reject while the current terms version is flagged placeholder (or missing/unknown), with a distinct error such as `terms_not_approved` mapped in `src/lib/db-errors.ts`.
- Decide and document how isolated tests obtain an approved fixture version (for example a clearly synthetic test-only version inserted inside a rolled-back test transaction, flagged as a development fixture); the seed and `rider_terms_current_version` default must remain the placeholder so nothing is represented as AFIT-approved.
- Tests prove: placeholder rejected for go-active and accept; non-placeholder approved fixture accepted; switching back to placeholder blocks again; direct RPC calls cannot bypass; an active shift on a version that later becomes placeholder cannot accept new work.
- Existing rider tests and e2e seeds that relied on the placeholder must be updated through the approved-fixture mechanism, not weakened. Update the rider UI wording so a rider sees why they cannot go active (terms awaiting approval).
- Do not invent final rider terms or claim AFIT authorisation. Record the finding as K48 in `docs/known-issues.md` and `docs/external-approvals.md` until AFIT-approved wording exists.
  If, at implementation time, the code already enforces this, document the evidence and test results instead of changing it.

### A9. K45 — unsafe or impossible delivery batches

Preserve K45. The cap of five is necessary, not sufficient. Do not invent AFIT-approved zones, restricted areas, route rules, delivery-time rules, security requirements, maximum distances, vehicle restrictions or handling of military/sensitive destinations. These must be defined with the appropriate authority and reflected in code and tests before a real campus pilot. Batch 5 continues with synthetic orders and existing safe constraints, provided no implementation bypasses the unresolved policy.

### A10. K46 — rider identity and vehicle verification

Preserve K46. Software approval of a rider application is not proof of physical identity; a profile photo or entered vehicle details are not verification; do not claim identity, background, vehicle or institutional checks without evidence; do not invent AFIT security policies. The owner must arrange and approve the verification process before a real pilot.

### A11. Signature and delivery evidence

Drawn signature stays mandatory. Typed acknowledgement stays **disabled** (`typed_signature_enabled=false`) and is not approved as a substitute: do not enable it through a default, migration or frontend change. Never label typed text as a drawn signature; preserve the real capture method in the evidence record, receipts and audit views. Improve accessibility without weakening proof: if a recipient cannot use the supported process, provide a documented support/escalation path — never silently mark the order delivered. Any change to what qualifies as an acceptable signature needs explicit owner approval (and legal/operational guidance).

### A12. Signature storage and evidence integrity

Whether signatures stay in database `bytea` or move to private object storage is an **owner decision (K26)**. Inspect the current design; do not perform an unrequested storage migration. Preserve private access, server-side authorisation, integrity checks, size/content validation, immutability once accepted, audit of access and relevant administrative actions, retention/deletion handling. If object storage is used: private storage with short-lived authorised access, never public URLs. If the database is used: verify the evidence cannot leak through broad table reads or API responses. Document the storage decision and implications.

### A13. Rider capacity, assignment and location privacy

Preserve: ≤5 active deliveries per rider; one active rider per order; atomic acceptance; server-side assignment validation; assignment-bound, one-time, expiring, replay-protected handover tokens; no rider-controlled completion; location only when explicitly enabled, during an active shift with an active delivery; customers see only their own eligible order; vendors get no unrestricted rider location; staff location access requires a recorded purpose and audit; old location data purgeable under the approved retention policy; no manual coordinates or manual arrival as a source of truth. GPS does not prove delivery. PWA background tracking on a locked phone is unverified until tested on target devices (K34). Real AFIT points/coordinates remain prohibited without approval.

### A14. Batch 4 infrastructure and CI facts to keep accurate

Expiry and location-purge jobs exist but are unscheduled; rider terms are placeholders; Android background GPS unverified; no real map/routing provider; tracking uses polling not Realtime; real Paystack unverified; no QR image; no notifications; K45/K46 unresolved. Do not implement notifications or Realtime to disguise missing infrastructure; do not add a paid map provider; do not add a QR image unless it is within approved Phase 9 scope and can be done safely (a short code is not a QR image). Report CI for the **actual** commits (see A17).

### A15. Jobs and retention

Who schedules expiry and location-purge jobs is an owner decision. Do not claim jobs run because endpoints exist; no paid scheduler or production schedule without approval. Any new scheduled processing in Phase 10 must be idempotent, safe to retry, observable, auditable where appropriate, protected against unauthorised invocation (bearer `JOBS_SECRET`) and tested locally. Document what is needed to schedule and monitor jobs before a real pilot.

### A16. Open owner decisions (keep in documentation until recorded)

MFA recovery and backup authenticator; TOTP enrolment policy; default customer role; TOTP replay/lockout; pickup-code reissue/unlock; typed acknowledgement; signature storage; expiry-job and location-purge scheduling; AFIT-approved delivery points/coordinates; approved rider terms; rider identity and vehicle verification; delivery-zone and route-safety constraints; mapping-provider purchase; stock reservation; anonymous carts; one vs multiple shops per vendor; stock and ledger handling for rejected paid orders; repository rename; pilot pricing, usage limits and caps; partial-refund policy; food/hygiene return policy per category. Do not repeatedly ask about unrelated decisions that do not block current work, and do not silently decide any of them to finish a phase.

### A17. Batch 4 evidence verified while preparing this prompt (re-verify at implementation time)

- Branch `claude/afit-market-phase-0-asm8xd`, draft PR #1. Latest commit at preparation: `402c95a`.
- GitHub Actions (workflow "CI", checks job + db-and-e2e job): implementation commit `1f6c8c1e15a3c1852e048ad57864a98ed203aabe` — runs #15 (push) and #16 (pull_request) **success**; documentation commit `eecc4d26f0a6be3d651b1b1bcdda0c1954f87405` — runs #17 and #18 **success**; final documentation commit `402c95afa2fb7fa9340461747662d9cdde01a16d` — runs #19 (push) and #20 (pull_request) **success**. (Checked through the GitHub API on 11 Oct 2026; per-job logs were not opened.) The documentation commit that adds this prompt will have its own runs, which must be checked separately.
- Baselines reported in `docs/reports/batch-4.md` (not guaranteed current): 138 unit, 171 DB, 142 e2e executions (71 tests × 2 projects).
- Rider-terms defect: confirmed by reading the migration (A8). Not yet fixed; no application code was changed while preparing this prompt.
- Before relying on A5, A11, A12 and A13 claims, re-read `pickup-code.ts`, `complete_pickup`, the handover evidence table/constraints and the rider/location functions.

---

## PART A2 — BATCH 4 FACTS AND ENGINEERING RULES (from the v1 draft; unchanged)

### A2.1 What Batch 4 delivered (reported by the implementing engineer, not independently reviewed)

Rider applications/approval/suspension; rider terms acknowledgement (placeholder text); Go Active/Inactive shifts; delivery offers; atomic five-delivery cap; vendor-to-rider assignment tokens; rider issue reports (incl. GPS issue as a support flag); synthetic location pipeline with validation, privacy-scoped reads, retention purge and server-side geofence arrival; customer tracking card with a labelled sample map; plus Batch 3 corrections (pickup secret moved to `PICKUP_CODE_SECRET`; signature capture method recorded; typed acknowledgement available but OFF). Exact results are in `docs/reports/batch-4.md`.

### A2.2 Facts Phase 9 must build on (do not re-decide)

- Orders reach **`ARRIVAL_DETECTED`** from rider movement. **Arrival is not delivery.** `DELIVERED`/`COMPLETED` still require recipient proof (this batch). The existing states `AWAITING_RECIPIENT_PROOF`, `DELIVERED`, `COMPLETED` are in the order CHECK; use them through `app_private.step_order` only.
- `delivery_assignments` "active" statuses are `accepted`, `picked_up`, `en_route`, and two partial unique indexes depend on that list (one active assignment per order; one active slot per rider). **Phase 9 must add a terminal assignment status (for example `completed`) and update both indexes and every status list consistently**, then re-run the control-removal concurrency tests in `tests/db/rider-concurrency.test.ts`. Completing a delivery must free the rider's slot.
- Customer pickup (vendor counter) already works end to end (`complete_pickup`: code + recipient + signature, evidence immutable). Delivery completion is new and must reuse the evidence patterns, not copy-paste a weaker rule.
- `rider_post_location` never completes an order; keep it that way. Tracking must **stop** for an order when it completes (location stop behaviour is a Phase 9 requirement).
- Customer pickup codes are derived from `PICKUP_CODE_SECRET` (server-only; fail closed). New proof codes/tokens must not introduce secrets in the database. Random tokens stored as hashes are fine (see assignment tokens).
- Money is integer kobo. Paystack is **test mode only** and was never verified against the real API (K19/K30). Refund **execution** against a provider remains out of scope unless the owner has supplied verification evidence; build the data model, calculation, caps, idempotency and the approval workflow, with a clearly labelled stub/fake provider.

### A2.3 Open owner decisions (do NOT decide; stop only the specific work that needs them)

MFA recovery after losing all authenticators; backup authenticator for privileged roles; TOTP enforcement point; TOTP replay/lockout trade-offs; pilot fees/expiry/caps; multi-store vendors; stock reservation and rejected-paid-order refund/stock behaviour; anonymous carts; **pickup-code re-issue/unlock (K28)**; **signature storage (database vs private object storage, K26) and whether a typed acknowledgement may stand in for a drawn signature (K27) — this decides whether delivery can ever be completed for a recipient who cannot draw**; who schedules the expiry and location-purge jobs (K18/K39); repository rename; AFIT-approved delivery points/coordinates/zones; rider terms wording; whether a mapping provider is purchased; **food/hygiene return policy per category** (needed for Phase 10 and must be configurable, not hard-coded).

### A2.4 Known issues carried forward (keep in `docs/known-issues.md` until demonstrably resolved)

K18/K39 unscheduled jobs; K19/K30 Paystack unverified; K26/K27 signature storage and keyboard path; K28 pickup-code unlock; K29 refund execution; K33 form values clear after a rejected submit; K34 background location **UNVERIFIED** (manual Android script exists); K35/K36 no real map provider, synthetic coordinates; K37 polling not Realtime; K38 placeholder rider terms; K41 a rider carrying a parcel cannot self-release (Phase 10 operations tooling should provide a supervised path); K42 delivery points without coordinates never yield arrival; K44 pickup-secret rotation not designed.

### A2.5 Test and engineering lessons (follow them)

- Wait for the server-action POST and the form reset before the next step; scope alert locators to `main`; remeasure element positions after an error message appears (the signature canvas moves); React clears uncontrolled fields after every action, and a success message vanishes when the page re-renders into another state — assert the resulting state.
- Chromium delivers an emulated geolocation only when the position **changes**; nudge it. A `Permissions-Policy` header can silently block a browser feature — test headers.
- DB tests that count rows globally must clear or scope their data inside a rolled-back transaction (`isoTx`); append-only tables (payment events, handover evidence) need unique ids per run.
- Concurrency tests must prove the invariant **and** their own power: remove controls one layer at a time with the `app_private.test_seam` barrier, restore afterwards, and say which layer is the real backstop. Do not claim a lock is essential if a constraint is.
- Run `pnpm exec supabase db lint --local`; do not mark a read-only-looking function `stable` if it calls anything volatile.
- Never `pkill -f` a pattern that matches your own shell. Docker may need `pkill containerd` + restart; `pnpm db:start` handles dockerd.
- Report CI honestly: give the exact commit SHA and each workflow/job result; never report a skipped check as passed.

### A2.6 Engineering rules (unchanged and mandatory)

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

### 1.7 Additional binding requirements (from the owner's consolidated instruction)

**Server-authoritative completion (B1).** Completion is one transactional server operation; a rider can never mark delivered via a browser request, table update or ordinary API call. It verifies: order exists and is in an eligible delivery state; the assignment is current and not superseded; the actor is authorised for this specific operation; the order is not already completed; the required evidence is valid and belongs to this order, recipient and current assignment; required handover/arrival conditions are met; the proof is not a replay of a consumed one. Use the existing state machine (`app_private.step_order`) and database protections; add no parallel statuses. Use row locks, conditional updates and unique constraints; tests prove exactly one concurrent completion succeeds.

**Mandatory recipient signature and signing UI (B2).** Accessible, mobile-friendly: clear statement of what is being confirmed; correct order identification and summary; works on touchscreens and desktop input; rejects empty or meaningless drawings; payload-size limits; safe handling of malformed data; explicit recipient confirmation; secure submission; server-side authorisation and association with the correct order and assignment; evidence integrity and audit metadata; clear success/failure states; no accidental double submission. Do not claim a drawn signature is legally sufficient in every jurisdiction. Typed acknowledgement stays disabled. A recipient who cannot sign is directed to the documented support/escalation path; the order is never completed automatically.

**Delivery proof record (B3).** Create or extend an immutable evidence record following the existing schema (no duplicate tables). Where appropriate record: order id; current assignment id; recipient identity/reference; capture method; signature evidence reference or protected payload; timestamps; authenticated actor or recipient confirmation reference; handover/proof-token reference; integrity metadata; completion transaction id or idempotency key; audit metadata. Store no unnecessary personal data; no signature payloads in logs or public storage/URLs; once accepted, evidence is not editable through ordinary customer/vendor/rider interfaces — corrections only through an explicit audited administrative process.

**Code and QR proof (B4).** Inspect the existing pickup and handover token primitives before adding a new one. Any recipient confirmation code is generated server-side: unpredictable, sufficient entropy, hash-only or otherwise protected storage, bound to order + current assignment, expiring, single use, atomically consumed, replay-protected, rate-limited and brute-force-protected, invalidated when the assignment changes, never logged in plaintext, never disclosed to unauthorised actors; a code for one order must not work for another; an old-assignment token must fail after reassignment; expired or consumed tokens must fail. If a QR image is implemented it encodes only a safe opaque token (no personal data, secrets or order details) and is justified in the report; otherwise keep the short-code flow and document QR as a future enhancement. Never describe the absence of a QR image as completed QR functionality.

**Completion transaction (B5).** One transaction: validate order and assignment; validate recipient proof; validate any one-time code; consume the token atomically; persist the evidence; move the order to the correct completed state; write the audit event; record the completion timestamp; free the rider slot; make repetition impossible. Any failure leaves no partially completed order. A database function performing it is hardened (fixed `search_path`, grants, actor validation, role and aal checks). The browser is never trusted to decide proof validity.

**Payments boundary (B6).** Delivery completion triggers no real financial transfer; no vendor/rider payouts; no settlement or escrow claims; keep any existing separation between payment receipt and fulfilment.

**Failure handling (B7).** Handle and test: wrong order, wrong assignment, wrong recipient, invalid/missing signature, expired/replayed token, already completed order, reassigned order, unauthorised actor, insufficient assurance, duplicate submission, concurrent completion, storage failure, database transaction failure, network interruption, completion attempted by a rider, recipient unable to sign, invalid or excessive payload, expired/inactive order. Failures must not let attackers enumerate valid tokens or orders; user messages are actionable without internal detail or stack traces.

**Phase 9 test checklist (B8).** Database/security: valid completion; missing signature; typed acknowledgement rejected while disabled; wrong order/assignment/recipient; old-assignment token; expired token; consumed token; replay; concurrent attempts → exactly one completion; rider cannot complete; vendor cannot fabricate recipient proof; customer cannot complete another customer's order; anonymous cannot submit; insufficient MFA rejected where required; evidence immutable through ordinary interfaces; unauthorised signature reads fail; failed completion leaves no partial state; duplicates create no duplicate completion. Unit/integration: payload validation, token generation/verification, expiry, assignment binding, integrity, idempotency, error mapping, safe retry, rollback. Browser (mobile-360 and desktop): recipient reviews the right order; signs on mobile and desktop; empty signature rejected; clear feedback; order completes only after server validation; duplicate clicks do nothing extra; rider cannot shortcut; wrong/expired code rejected; labels, focus management and keyboard navigation; no horizontal overflow; no serious axe violations.

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

### 2.7 Additional binding requirements (from the owner's consolidated instruction)

Use the existing order, payment, stock and ledger model; inspect the schema first; create no duplicate refund system or conflicting order states.

**Core financial rules (C1).** No over-refunds; no duplicate application; no refund above the eligible amount; integer kobo; every decision auditable; statuses distinguish requested, approved, rejected, processing, succeeded, failed and reconciled where appropriate; never claim money was returned unless the provider confirms; a request or approval is not a transaction; no real refunds, payouts, settlement or escrow; no client-supplied amounts; transactional and concurrency-safe; reuse the ledger and reconciliation model.

**Refund request (C2).** Verify the customer owns the order; confirm order/payment state permits a request; record the reason; validate the amount server-side; reject nonexistent, unpaid or ineligible transactions; prevent duplicates where required; show the customer a clear status; keep an audit trail; never imply money has been returned before provider confirmation. If partial refunds are supported, enforce the approved policy and cumulative caps; if the partial-refund policy is unresolved, implement only the safe approved scope and document the open decision.

**Approval and execution boundary (C3).** Review workflow with appropriate permissions and MFA assurance; distinct states: submitted, under review, approved/rejected, provider execution not yet performed, pending, outcome confirmed, reconciliation required. No real Paystack refund execution this batch; fake provider adapter for tests; any adapter interface is inert in real environments and fails closed when misconfigured; a fake success never proves real Paystack behaviour; the report separates the implemented local workflow from unimplemented real execution.

**Limits and concurrency (C4).** Database constraints, transactional functions and locking prevent concurrent requests/approvals exceeding the eligible amount. Tests: simultaneous requests; simultaneous approvals; duplicate client requests; duplicate provider events; duplicate idempotency keys; repeated processing; partial totals; full refund then another request; ineligible payment; failed or ambiguous provider outcome; reconciliation after an uncertain result. Prove the invariant, not the happy path; document and test any constraint relied on as the final backstop (with control-removal analysis).

**Returns (C5).** Distinct from refunds; record order, customer, item(s), quantity, reason, request time, status, vendor/support review, decision and audit metadata. Do not assume every item is returnable or invent a campus-wide policy: use configuration already approved in the repository, otherwise record the open decision and never silently approve. Prevent returns against unrelated orders, duplicates where prohibited, quantities above the purchased quantity, invalid items and unauthorised decision edits; a return is never proof a refund occurred; no automatic restock without an approved stock policy.

**Disputes and support cases (C6).** Auditable: case id, order id, customer or authorised reporter, type, description, evidence references, status, assigned support role, decision, reason, timestamps, audit history. Customers see only their own cases; vendors not unrelated customers' cases; riders no unrelated cases or unrestricted recipient data; support and finance get only what their responsibilities require; privileged access is audited; do not grant blanket access to administrators where finer permissions are possible.

**Evidence and disputes (C7).** Phase 9 proof may be referenced but the dispute system never alters the original evidence; additional evidence attaches to the correct case/order and is protected (no public URLs); no automatic approval/rejection from GPS, a missing location update or unverified background tracking; no automatic rider penalties from missing location data; no final legal or disciplinary decisions on behalf of AFIT; record operational flags for human review.

**Vendor-rejected paid orders (C8).** Inspect current behaviour and tests. Do not assume rejection means stock can be released, a refund was executed, a payment was reversed, money reached the customer or the vendor is liable. Keep the distinction flag → request → approval → provider execution; no automatic real refunds; document the unresolved policy.

**Audit and observability (C9).** Record actor, action, entity, timestamp, previous/new status, reason, idempotency/correlation reference, provider reference only when one exists, and failure/reconciliation state. No secret keys, payment credentials, signature payloads or unnecessary personal data in logs; use request ids; actionable errors without leakage.

**Phase 10 test checklist (C10).** Database/security: customer requests only for own eligible order; cannot approve own privileged decision; vendor cannot approve outside permissions; rider cannot reach unrelated financial/dispute records; anonymous denied; support/finance limited as intended; privileged actions need the right aal; amount ≤ eligible; cumulative ≤ allowed; concurrent approvals preserve the invariant; duplicates idempotent; invalid payment states rejected; return quantity ≤ purchased; returns cannot touch unrelated orders; evidence access restricted; audit history not alterable by ordinary users; fake outcomes distinguishable from real; failed transaction leaves no partial financial state. Unit/integration: eligibility, amount and cumulative calculation in integer kobo, idempotency, concurrent processing, return validation, dispute transitions, permission decisions, provider failure/timeout, reconciliation, duplicate events, audit creation, safe retry. Browser (mobile-360 and desktop): customer submits and sees accurate refund status; cannot reach another customer's request; support reviews with correct permissions; approval is visibly distinct from provider execution; fake outcomes labelled; return request and dispute submission; evidence shown only to authorised users; invalid quantities/amounts rejected; duplicate submissions create no duplicates; loading/empty/success/failure states; keyboard operation and labels; no overflow; no serious axe violations.

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

---

## PART D — CROSS-PHASE SECURITY AND QUALITY REQUIREMENTS

- **D1 State machines.** Inspect and document permitted transitions of the order, payment, rider assignment, handover, completion, refund, return and dispute state machines. No incompatible duplicate status fields; privileged transitions enforced on the server and, where appropriate, in the database; invalid transitions fail safely.
- **D2 Idempotency and retry safety.** Assess and test delivery completion, signature/evidence submission, one-time token consumption, refund request/approval, return and dispute creation, provider event handling and audit creation. A retry never creates a second completed delivery or duplicate financial effect.
- **D3 Concurrency.** Transactions, locks, conditional updates and constraints appropriate to each invariant; adversarial concurrent tests; where a constraint is the real backstop, show it protects the invariant even if application checks are bypassed.
- **D4 Authorisation matrix.** Maintain and extend an explicit matrix (anonymous, customer, vendor, rider, support, finance, administrator; insufficient vs required MFA) for each relevant table, function and endpoint: allowed and denied actions; tests must cover denials, not only happy paths.
- **D5 Privacy.** Minimise collection/disclosure of customer, recipient, rider, signature, payment-reference, location and dispute-evidence data; never expose military or sensitive location detail in notifications, logs or public pages; keep location retention controls; no real campus coordinates in tests.
- **D6 Accessibility.** Plain wording, readable statuses, visible errors, obvious next steps, keyboard navigation, screen-reader labels, focus management, mobile touch; never replace mandatory proof with a weaker process to ease the UI.
- **D7 Dependencies.** Inspect existing packages first; no paid services, mapping-provider purchase, native app or stack replacement; any genuinely necessary new dependency is justified in the report and waits for owner approval if it brings material cost, security risk or architectural change.

---

## PART E — ADDITIONAL TESTING AND ACCEPTANCE (adds to Part 4)

**E1 Commands.** Use the repository's actual scripts: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test` (unit project), `pnpm test:db`, `pnpm build`, `pnpm check:secrets`, `pnpm exec supabase db lint --local`, `pnpm exec playwright test` (also `pnpm test:e2e`). If a command is missing, say so; never invent a pass; never skip a failing test to turn green.

**E2 Baselines.** Batch 4 reported 138 unit, 171 DB and 142 e2e executions (71 tests × 2 viewports). These are baselines, not current facts. Record actual final counts, explain material changes, run regression for all earlier batches, delete no tests to look green.

**E3 Additional acceptance criteria.** Batch 5 is not complete unless, in addition to Part 4: completion is server-authoritative; drawn signature mandatory and typed acknowledgement disabled; evidence bound to order and current assignment; replayed/expired/unrelated tokens fail; concurrent completion creates no duplicate; riders cannot complete deliveries; refund requests/approvals are separate from provider execution; over-refunds prevented; financial operations idempotent and auditable; returns and disputes correctly scoped; **no real refund, payout, settlement or live payment executed; the rider-terms placeholder defect (A8/K48) is corrected or verified fixed with evidence;** K45 and K46 remain documented; all applicable checks pass; no production deployment or real coordinates; documentation states what is implemented, tested, unverified and awaiting approval; the report, review package and Batch 6 prompt exist; work stops after Batch 5. If a critical security or financial requirement cannot be met, report a blocker — do not claim completion.

### Extra traceability rows

| ID    | Requirement                                                                                                            | Verification           |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A8    | Placeholder rider terms cannot authorise go-active or accept; approved fixture works; direct RPC cannot bypass         | DB tests, browser test |
| A9/10 | K45 and K46 stay in known issues and external approvals                                                                | doc check              |
| A11   | Typed acknowledgement stays disabled and cannot be enabled by default/migration; capture method kept in receipts/audit | DB tests               |
| A12   | Evidence storage unchanged unless owner decides; no leakage via table reads or API; audited access                     | DB + route tests       |
| A15   | New jobs idempotent, protected, locally tested; scheduling still an open decision                                      | DB + route tests       |
| D4    | Authorisation matrix documented and tested for every new table, function and endpoint                                  | DB tests, doc          |
| C1-C9 | Refund/return/dispute invariants, boundary to provider execution, audit                                                | DB + concurrency tests |

---

## PART F — DOCUMENTATION REQUIREMENTS

Update consistently: `docs/known-issues.md`; architecture and state-machine docs; security and access-control docs; payment and refund docs; delivery-proof docs; testing and local setup instructions; `docs/external-approvals.md`; the Batch 5 report; the Batch 6 prompt. Document unresolved issues without inventing decisions. Label every item with exactly one of: Implemented; Tested locally; Verified externally; Awaiting owner approval; Awaiting AFIT approval; Awaiting legal or operational review; Not implemented; Not tested; Unverified. Never describe an interface or stub as a working provider integration, synthetic map behaviour as real routing, a refund request as a completed refund, or a placeholder agreement as approved terms.

---

## PART G — REQUIRED BATCH 5 COMPLETION REPORT (`docs/reports/batch-5.md`)

A executive summary (what Phases 9 and 10 implement; final status). B repository and commit information (branch; implementation and final documentation commit SHAs; working-tree status; CI run links and results). C requirements traceability (requirement → files → migration/function → tests → result → limitations). D database changes (tables, constraints, functions, triggers, policies, grants, indexes; how invariants are enforced). E delivery completion (state machine, signature process, token handling, evidence integrity, concurrency, audit trail). F refunds, returns and disputes (workflows, permission model, refund cap, idempotency, audit, provider boundary). G security review (access-control tests, MFA enforcement, secret handling, concurrency, replay protection, privacy). H test results (exact commands, counts, pass/fail, skipped or blocked). I accessibility and usability (automated results; manual testing only if actually performed, with evidence). J CI (exact commit tested and each workflow result). K unresolved owner decisions. L known issues (carried forward and new). M external approvals and operational blockers (AFIT authorisation, rider terms, rider identity/vehicle verification, zone safety, real coordinates, payment approval, privacy review, job scheduling, others). N deployment and pilot status (state explicitly whether anything is deployed or pilot-ready; do not claim production readiness). O final recommendation: Complete / Conditionally complete / Blocked, with reasons.

---

## PART H — INDEPENDENT-REVIEW PACKAGE (for the owner and ChatGPT)

Exact implementation and documentation commit SHAs; changed-file list; migration list; security-critical function names; relevant RLS policies and grants; the delivery completion function and tests; refund cap and concurrency implementation and tests; return and dispute authorisation implementation and tests; test output summaries; CI evidence; known issues and unresolved decisions; exact local reproduction steps; every failed, skipped or unverified check; file paths and function names. Do not claim ChatGPT reviewed anything until the owner submits evidence and the review occurs; do not claim the owner approved a decision without explicit approval.

---

## PART I — COMPLETE BATCH 6 PROMPT (Phases 11 and 12)

The complete Batch 6 prompt is stored at `docs/reports/batch-6-prompt.md` and is reproduced in full in the appendix below. After Batch 5 is implemented, the engineer must update it with Batch 5's real outcome and any owner corrections, keep all corrections at its beginning, and re-save it in that file and in the Batch 5 report. Do not implement Batch 6.

---

## PART J — GIT, CI AND STOP CONDITIONS

For implementation: inspect Git status first; preserve uncommitted work; no force-push or history rewrite; record the exact commit SHA; verify CI for the relevant final commit and report pending or inaccessible CI accurately; never claim a documentation commit passed CI because an earlier commit did.

Stop and report if: the local stack cannot run; a security-critical or financial requirement cannot be met; an owner decision is needed to proceed safely (especially signature/typed acknowledgement for delivery, partial-refund policy, stock handling, return policy); a step needs real coordinates, a paid service, production deployment, live credentials or verified Paystack refund behaviour that is unavailable. Do not begin Phase 11. Do not claim the project is ready for public launch. After the report, the review package and the updated Batch 6 prompt are delivered, stop and wait for the owner.

---

## APPENDIX — BATCH 6 PROMPT (copy as it was when this prompt was approved; the CURRENT version is `docs/reports/batch-6-prompt.md`, updated after Batch 5)

# AFIT MARKET — MASTER BATCH 6 PROMPT

**Phase 11 (notifications, reviews and administration tools) + Phase 12 (security hardening, reliability and pilot readiness)**

Status: **DRAFT prepared before Batch 5 is implemented.** It must be re-read and updated with the real outcome, findings and owner corrections from Batch 5 before use. **The owner must review and explicitly approve this complete prompt before implementation begins.** Do not claim ChatGPT or the owner reviewed anything until evidence is submitted and reviewed.

---

### PART 0 — CORRECTIONS AND UNRESOLVED ISSUES CARRIED FORWARD FROM BATCHES 1–5 (binding; read first)

Continue from the actual repository, branch and latest valid commit. Inspect Git status, history, prior reports (`docs/reports/batch-1.md` … `batch-5.md`), `docs/known-issues.md`, `docs/external-approvals.md`, migrations, tests and workflows before changing anything. Do not assume earlier reports are accurate; verify important claims. Do not rename the repository, reset branches, force-push, delete data or refactor unrelated code. Do not begin anything beyond Phase 12.

#### 0.1 Architecture and local-first rules (unchanged)

Next.js App Router, React, TypeScript strict, Tailwind PWA; Supabase Postgres/Auth/RLS/private storage; modular monolith; the browser never talks to Supabase; no `NEXT_PUBLIC_` secrets; critical rules in hardened `SECURITY DEFINER` functions (fixed `search_path`, EXECUTE revoked from PUBLIC/anon, identity + role + aal checks inside) or constraints; RLS and tested policies on every table; every protected prefix in `ROUTE_POLICIES` with `enforceRoutePolicy`; route handlers check authorisation themselves; privileged roles need aal2; integer kobo; Paystack test mode only; `APP_ENV` fails closed. No integration-infrastructure provider (Nango, Composio, Pipedream, Make, Zapier), no replacement of Supabase, no rebuild in another framework, no native app. Local-first: no deployment, live payments, real customer messages, paid services, real campus coordinates or committed secrets without explicit owner approval. If the local stack fails, record the exact failure, state what could not be tested and stop the dependent work; never switch silently to remote or weaker testing.

#### 0.2 Corrections and facts from Batch 4 and earlier (verify, preserve)

- **Rider terms placeholder defect (K48).** Verified during Batch 5 prompt preparation: `rider_go_active` and `rider_accept_order` check only that the rider acknowledged the _current_ terms version and never reject a version flagged `is_placeholder`. Batch 5 must correct this at the database level with tests; Batch 6 must verify the correction exists, passes, and that no real rider operation can run on placeholder terms.
- **Pickup secret.** Codes derive from server-only `PICKUP_CODE_SECRET` (fails closed); the database stores a nonce and a hash only. Rotation (K44) and unlock/re-issue (K28) remain owner decisions.
- **Signature.** Drawn signature mandatory; typed acknowledgement disabled (`typed_signature_enabled=false`) and not approved as a substitute (K27); signature storage decision (K26) open; evidence immutable once accepted; capture method preserved in receipts and audit.
- **Payments.** Real Paystack behaviour is **unverified** (K19/K30). Fake-provider tests are not proof of real behaviour. No live payments, real refunds, payouts, settlement or escrow claims.
- **Riders.** Capacity five and one active rider per order are database-enforced; location only during an active shift with an active delivery; **Android background tracking is UNVERIFIED (K34)**; polling not Realtime (K37); no real map provider (K35); synthetic coordinates only (K36).
- **K45** (unsafe/impossible batches beyond the cap) and **K46** (rider identity and vehicle verification) remain unresolved operational requirements; software approval is not proof of identity, vehicle, background or institutional checks.
- **Jobs.** Expiry and location-purge jobs exist but are not scheduled (K18/K39); who schedules them is an owner decision.
- No QR image unless Batch 5 delivered one safely; a short code is not a QR image. No notifications existed before Batch 6.

#### 0.3 Open owner decisions (do not decide)

MFA recovery and backup authenticator; TOTP enrolment point, default customer role, replay/lockout policy; pickup-code reissue/unlock (K28); typed acknowledgement (K27); signature storage (K26); who schedules expiry and location-purge jobs; AFIT-approved delivery points/coordinates/zones; approved rider terms; rider identity and vehicle verification; delivery-zone and route safety rules; mapping-provider purchase; stock reservation and rejected-paid-order stock/ledger handling; anonymous carts; one shop vs multiple shops per vendor; food/hygiene return policy per category; partial-refund policy; repository rename; pilot pricing, usage limits and caps; plus every new decision recorded in `docs/reports/batch-5.md` §K.

#### 0.4 Engineering lessons (follow them)

Wait for server-action POSTs and form resets; scope alert locators; remeasure after error banners; assert resulting state, not vanished success messages; Chromium emits emulated geolocation only on change; headers like `Permissions-Policy` can silently block features; scope or clear DB test data with `isoTx`; unique ids for append-only tables; concurrency tests must prove their own power through control-removal and name the real backstop; `supabase db lint --local`; do not mark functions `stable` if they call volatile code; never `pkill -f` a pattern matching your own shell; report CI with exact commit SHA and per-job results — never report a skipped check as passed.

#### 0.5 Batch 5 verification before new work

Before Phase 11, confirm from the repository and GitHub Actions: Batch 5 implementation and documentation commit SHAs and CI results; the K48 correction and its tests; the completion, refund, return and dispute invariants still hold under the full regression set. Report any gap honestly; stop if a Batch 5 security or financial invariant is broken.

---

### PART 1 — PHASE 11: NOTIFICATIONS, REVIEWS AND ADMINISTRATION TOOLS

#### 1.1 Notifications

- In-app notifications first (table with RLS: a user reads/updates only their own). Email/SMS/push only through a fake or local sink in this batch; no real customer messages, no paid provider, without owner approval.
- Notification content must **not** disclose sensitive personal, payment or location information: no payment references, amounts beyond what the user already sees in their own authenticated view, no addresses/coordinates/rider position, no military or sensitive location detail, no tokens, pickup codes or signature data. Prefer an opaque "your order has an update" with an authenticated deep link.
- Delivery with retries: outbox pattern, idempotent send, bounded retry with backoff, dead-letter state, observable failures, no duplicate sends, safe to retry, audit of sends where appropriate, user preferences and opt-outs where lawful.
- Triggers are server-side events from the existing state machines; a notification failure must never block or roll back an order, payment, delivery or refund transition.
- Tests: RLS allow/deny; content-leak tests (assert forbidden fields absent); retry/idempotency; outbox race (two workers send once); opt-out respected.

#### 1.2 Reviews

- Reviews only for **eligible completed transactions** (the order reached the completed state through the real proof flow); one review per eligible order/item as policy defines; the reviewer must be the verified customer; edits and deletions audited.
- Abuse prevention and moderation: rate limits, report/flag, moderation queue, hide-with-reason, no deletion of the audit trail, no review of cancelled/refunded-in-full/disputed-open orders unless policy says so (record the decision, do not invent it), protection against vendor self-review and review bombing, plain-language community rules.
- Aggregate ratings computed server-side; no client-supplied ratings or counts.
- Tests: ineligible order rejected, duplicate rejected, vendor/rider cannot review own order, moderation permissions, aggregates correct under concurrency.

#### 1.3 Administration tools

- Admin/support/finance workflows with **granular permissions** (not "admin can do everything"), aal2 for privileged roles, reason required for sensitive actions, full audit history, separation of duties for money-related actions.
- Cover: vendor and rider management, category/settings management, case queues, moderation, notification oversight, job/health dashboards, audit-log viewer (read-only; ordinary users cannot alter audit history), configuration of policies Batch 5 made configurable (e.g. return policy), reconciliation views.
- Extend and maintain the explicit authorisation matrix (anonymous, customer, vendor, rider, support, finance, administrator; aal1 vs aal2) for every new table, function and endpoint.
- Tests: allow/deny per role and assurance level; direct-API bypass attempts; audit entries written for every privileged action.

---

### PART 2 — PHASE 12: SECURITY HARDENING, RELIABILITY AND PILOT READINESS

#### 2.1 Security regression and hardening

- Full security regression suite across all roles: RLS, grants, function catalog hygiene (fixed `search_path`, no PUBLIC/anon EXECUTE beyond the allowlist), secret scanning, dependency audit (record findings; do not auto-upgrade majors without review), headers/CSP review, rate limiting and brute-force protection review (login, TOTP, pickup/proof codes), input validation and payload limits, error-message leakage review, logging review (no secrets/signatures/payment credentials).
- Replay, forgery and race re-tests for completion, refunds, tokens and webhooks.
- Penetration-style negative tests for the authorisation matrix. Record, do not hide, residual risk.

#### 2.2 Reliability and recovery

- Backup and restore rehearsal on the **local** stack (document exact steps and results), migration forward/rollback strategy, idempotent and retry-safe jobs, graceful degradation when providers fail, timeouts, health endpoint, structured logs with request ids, failure-injection tests (database error mid-transaction leaves no partial state; provider timeout leaves a reconcilable state).
- **Job scheduling and monitoring plan:** inventory every job (order expiry, location purge, notification outbox, reconciliation), its idempotency, authentication (`JOBS_SECRET`), expected cadence, failure alerting and the owner decision still needed (who schedules). Do not introduce a paid scheduler or production schedule without approval. Do not claim jobs run because endpoints exist.

#### 2.3 Privacy and retention

Data inventory, retention periods as configuration (owner/legal sets values), location and evidence purge verification, minimisation review of customer/rider/recipient/signature/payment data, data-subject access/deletion handling plan, no real campus coordinates in tests. Nigerian data-protection (NDPA/NDPC) obligations are for legal review, not for the engineer to declare satisfied.

#### 2.4 Accessibility and usability

axe checks and keyboard/focus review on every new critical flow at mobile-360 and desktop; no horizontal overflow; plain wording for non-technical campus users; do not claim manual device testing without evidence.

#### 2.5 Pilot-readiness checklist (produce, do not self-certify)

A checklist in `docs/` listing, with status _Implemented / Tested locally / Verified externally / Awaiting owner / Awaiting AFIT / Awaiting legal-operational review / Not implemented / Unverified_, at least: AFIT written authorisation; approved delivery points, zones and route/safety rules (K45); approved rider terms; rider identity and vehicle verification process (K46); real-device Android background-location test results (K34); mapping-provider decision; **independent verification of real Paystack behaviour** using owner-controlled test credentials and an approved procedure, then separate legal/financial approval for any live use (K19/K30); refund/return/dispute policies; Nigerian legal, payment (CBN/Paystack terms) and privacy/data-protection review; job scheduling and monitoring; support/escalation staffing; incident response; backups; pilot caps and pricing; MFA recovery policy; signature legal sufficiency and storage decision; accessibility sign-off; owner sign-off.

The engineer must **not** declare the system production-ready or pilot-ready. The report states the honest status and the blockers.

#### 2.6 Hard limits

Batch 6 must not silently activate live payment, payout, settlement, refunds against a real provider, paid infrastructure, real messaging or production deployment. No real AFIT coordinates. No deployment.

---

### PART 3 — TESTS AND ACCEPTANCE

Run and report actual results of: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm check:secrets`, `pnpm exec supabase db lint --local`, `pnpm exec playwright test` (mobile-360 + desktop). Where a command does not exist, say so; never invent a pass. Do not delete or skip tests to turn a run green; explain every change in test counts against the Batch 5 report. Run full regression for Batches 1–5.

Acceptance: notifications leak nothing sensitive and cannot block core transitions; reviews only for eligible completed orders with working moderation; admin tools have granular, audited permissions; security regression, reliability and recovery tests pass or blockers are reported; the pilot checklist exists with honest statuses; every earlier invariant (signature mandatory, rider cannot complete, refund cap, capacity five, placeholder terms rejected) still holds; K19/K30, K34, K45, K46 and every open decision remain visible; no real coordinates, live credentials, paid services or deployments.

---

### PART 4 — REPORTING, REVIEW PACKAGE AND STOP

Produce `docs/reports/batch-6.md` with sections A–O: A executive summary; B repository/commit/CI (exact SHAs and per-job results); C requirements traceability; D database changes; E notifications/reviews/admin design; F security review; G exact commands and results; H accessibility; I what failed or is incomplete; J technical debt; K dependencies and cost; L unresolved owner decisions; M external approvals and operational blockers; N deployment and pilot status (state explicitly it has not been deployed and is not production-ready unless truly satisfied); O final recommendation (COMPLETE / CONDITIONALLY COMPLETE / BLOCKED) — and an **INDEPENDENT REVIEW PACKAGE FOR CHATGPT** (commit SHAs, changed files, migrations, security-critical functions, RLS/grants, test summaries, CI, known issues, reproduction steps, failed/skipped checks). Update README, known issues, external approvals, security and testing docs.

Stop and report if the local stack cannot run, a security-critical requirement cannot be met, or an owner decision is needed to proceed safely. Do not start any work beyond Phase 12. Do not claim ChatGPT reviewed anything or that the owner approved anything without evidence. Stop and wait for owner review.
