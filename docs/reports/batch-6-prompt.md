# AFIT MARKET — MASTER BATCH 6 PROMPT

**Phase 11 (notifications, reviews and administration tools) + Phase 12 (security hardening, reliability and pilot readiness)**

Status: **DRAFT, updated after Batch 5 was implemented (see `docs/reports/batch-5.md`).** It must still be re-read and updated with the owner's own review findings and corrections from Batch 5 before use. **The owner must review and explicitly approve this complete prompt before implementation begins.** Do not claim ChatGPT or the owner reviewed anything until evidence is submitted and reviewed.

---

## PART 0 — CORRECTIONS AND UNRESOLVED ISSUES CARRIED FORWARD FROM BATCHES 1–5 (binding; read first)

Continue from the actual repository, branch and latest valid commit. Inspect Git status, history, prior reports (`docs/reports/batch-1.md` … `batch-5.md`), `docs/known-issues.md`, `docs/external-approvals.md`, migrations, tests and workflows before changing anything. Do not assume earlier reports are accurate; verify important claims. Do not rename the repository, reset branches, force-push, delete data or refactor unrelated code. Do not begin anything beyond Phase 12.

### 0.1 Architecture and local-first rules (unchanged)

Next.js App Router, React, TypeScript strict, Tailwind PWA; Supabase Postgres/Auth/RLS/private storage; modular monolith; the browser never talks to Supabase; no `NEXT_PUBLIC_` secrets; critical rules in hardened `SECURITY DEFINER` functions (fixed `search_path`, EXECUTE revoked from PUBLIC/anon, identity + role + aal checks inside) or constraints; RLS and tested policies on every table; every protected prefix in `ROUTE_POLICIES` with `enforceRoutePolicy`; route handlers check authorisation themselves; privileged roles need aal2; integer kobo; Paystack test mode only; `APP_ENV` fails closed. No integration-infrastructure provider (Nango, Composio, Pipedream, Make, Zapier), no replacement of Supabase, no rebuild in another framework, no native app. Local-first: no deployment, live payments, real customer messages, paid services, real campus coordinates or committed secrets without explicit owner approval. If the local stack fails, record the exact failure, state what could not be tested and stop the dependent work; never switch silently to remote or weaker testing.

### 0.2 Corrections and facts from Batch 4 and earlier (verify, preserve)

- **Rider terms placeholder defect (K48): corrected in Batch 5** (`20261014000001`): `rider_ack_terms`, `rider_go_active` and `rider_accept_order` refuse a placeholder, unknown or missing terms version (`terms_not_approved`). Batch 6 must re-verify it and that no real rider operation can run on placeholder terms; AFIT-approved wording is still needed (K38).
- **Pickup secret.** Codes derive from server-only `PICKUP_CODE_SECRET` (fails closed); the database stores a nonce and a hash only. Rotation (K44) and unlock/re-issue (K28) remain owner decisions.
- **Signature.** Drawn signature mandatory; typed acknowledgement disabled (`typed_signature_enabled=false`) and not approved as a substitute (K27); signature storage decision (K26) open; evidence immutable once accepted; capture method preserved in receipts and audit.
- **Payments.** Real Paystack behaviour is **unverified** (K19/K30). Fake-provider tests are not proof of real behaviour. No live payments, real refunds, payouts, settlement or escrow claims.
- **Riders.** Capacity five and one active rider per order are database-enforced; location only during an active shift with an active delivery; **Android background tracking is UNVERIFIED (K34)**; polling not Realtime (K37); no real map provider (K35); synthetic coordinates only (K36).
- **K45** (unsafe/impossible batches beyond the cap) and **K46** (rider identity and vehicle verification) remain unresolved operational requirements; software approval is not proof of identity, vehicle, background or institutional checks.
- **Jobs.** Expiry and location-purge jobs exist but are not scheduled (K18/K39); who schedules them is an owner decision.
- **Batch 5 facts to build on (verify, do not re-decide):** only the customer (recipient) can start and complete a delivery (`delivery_proof_begin`, `complete_delivery`; drawn signature; one-time hashed proof token bound to the current assignment); the rider has no completion action; typed acknowledgement is OFF and refused for deliveries; supervised exceptions go through `ops_handle_delivery_exception` and never deliver. Refunds are request -> review -> approval -> execution -> outcome with caps, idempotency, triggers and a FAKE provider only (`provider_mode`, fails closed outside `local`); a refund decision from a case only creates a request. Returns are separate (customer brings; no restock). Cases are decided only by people. Access rules: `docs/access-matrix.md`; transitions: `docs/state-machines.md`; ADR 0003.
- **New Batch 5 known issues Batch 6 must carry:** K49 (no return logistics/rider return tasks), K50 (placeholder policy values: fee share, support approval limit, return policy), K51 (no evidence upload, no signature viewer UI), K52 (recipient is the account holder; cannot-draw path is support), K53 (points without coordinates; receipt rendered on demand), K54 (no notifications: Phase 11), K55 (proof token is internal; no QR). Batch 6 notifications must cover refund, return and report status changes without leaking amounts, payment references, locations or tokens.
- No QR image exists. No notifications existed before Batch 6.

### 0.3 Open owner decisions (do not decide)

MFA recovery and backup authenticator; TOTP enrolment point, default customer role, replay/lockout policy; pickup-code reissue/unlock (K28); typed acknowledgement (K27); signature storage (K26); who schedules expiry and location-purge jobs; AFIT-approved delivery points/coordinates/zones; approved rider terms; rider identity and vehicle verification; delivery-zone and route safety rules; mapping-provider purchase; stock reservation and rejected-paid-order stock/ledger handling; anonymous carts; one shop vs multiple shops per vendor; food/hygiene return policy per category; partial-refund policy; repository rename; pilot pricing, usage limits and caps; plus every new decision recorded in `docs/reports/batch-5.md` §K.

### 0.4 Engineering lessons (follow them)

Wait for server-action POSTs and form resets; scope alert locators; remeasure after error banners; assert resulting state, not vanished success messages; Chromium emits emulated geolocation only on change; headers like `Permissions-Policy` can silently block features; scope or clear DB test data with `isoTx`; unique ids for append-only tables; concurrency tests must prove their own power through control-removal and name the real backstop; `supabase db lint --local`; do not mark functions `stable` if they call volatile code; never `pkill -f` a pattern matching your own shell; report CI with exact commit SHA and per-job results — never report a skipped check as passed.

### 0.5 Batch 5 verification before new work

Before Phase 11, confirm from the repository and GitHub Actions: Batch 5 implementation and documentation commit SHAs and CI results; the K48 correction and its tests; the completion, refund, return and dispute invariants still hold under the full regression set. Report any gap honestly; stop if a Batch 5 security or financial invariant is broken.

---

## PART 1 — PHASE 11: NOTIFICATIONS, REVIEWS AND ADMINISTRATION TOOLS

### 1.1 Notifications

- In-app notifications first (table with RLS: a user reads/updates only their own). Email/SMS/push only through a fake or local sink in this batch; no real customer messages, no paid provider, without owner approval.
- Notification content must **not** disclose sensitive personal, payment or location information: no payment references, amounts beyond what the user already sees in their own authenticated view, no addresses/coordinates/rider position, no military or sensitive location detail, no tokens, pickup codes or signature data. Prefer an opaque "your order has an update" with an authenticated deep link.
- Delivery with retries: outbox pattern, idempotent send, bounded retry with backoff, dead-letter state, observable failures, no duplicate sends, safe to retry, audit of sends where appropriate, user preferences and opt-outs where lawful.
- Triggers are server-side events from the existing state machines; a notification failure must never block or roll back an order, payment, delivery or refund transition.
- Tests: RLS allow/deny; content-leak tests (assert forbidden fields absent); retry/idempotency; outbox race (two workers send once); opt-out respected.

### 1.2 Reviews

- Reviews only for **eligible completed transactions** (the order reached the completed state through the real proof flow); one review per eligible order/item as policy defines; the reviewer must be the verified customer; edits and deletions audited.
- Abuse prevention and moderation: rate limits, report/flag, moderation queue, hide-with-reason, no deletion of the audit trail, no review of cancelled/refunded-in-full/disputed-open orders unless policy says so (record the decision, do not invent it), protection against vendor self-review and review bombing, plain-language community rules.
- Aggregate ratings computed server-side; no client-supplied ratings or counts.
- Tests: ineligible order rejected, duplicate rejected, vendor/rider cannot review own order, moderation permissions, aggregates correct under concurrency.

### 1.3 Administration tools

- Admin/support/finance workflows with **granular permissions** (not "admin can do everything"), aal2 for privileged roles, reason required for sensitive actions, full audit history, separation of duties for money-related actions.
- Cover: vendor and rider management, category/settings management, case queues, moderation, notification oversight, job/health dashboards, audit-log viewer (read-only; ordinary users cannot alter audit history), configuration of policies Batch 5 made configurable (e.g. return policy), reconciliation views.
- Extend and maintain the explicit authorisation matrix (anonymous, customer, vendor, rider, support, finance, administrator; aal1 vs aal2) for every new table, function and endpoint.
- Tests: allow/deny per role and assurance level; direct-API bypass attempts; audit entries written for every privileged action.

---

## PART 2 — PHASE 12: SECURITY HARDENING, RELIABILITY AND PILOT READINESS

### 2.1 Security regression and hardening

- Full security regression suite across all roles: RLS, grants, function catalog hygiene (fixed `search_path`, no PUBLIC/anon EXECUTE beyond the allowlist), secret scanning, dependency audit (record findings; do not auto-upgrade majors without review), headers/CSP review, rate limiting and brute-force protection review (login, TOTP, pickup/proof codes), input validation and payload limits, error-message leakage review, logging review (no secrets/signatures/payment credentials).
- Replay, forgery and race re-tests for completion, refunds, tokens and webhooks.
- Penetration-style negative tests for the authorisation matrix. Record, do not hide, residual risk.

### 2.2 Reliability and recovery

- Backup and restore rehearsal on the **local** stack (document exact steps and results), migration forward/rollback strategy, idempotent and retry-safe jobs, graceful degradation when providers fail, timeouts, health endpoint, structured logs with request ids, failure-injection tests (database error mid-transaction leaves no partial state; provider timeout leaves a reconcilable state).
- **Job scheduling and monitoring plan:** inventory every job (order expiry, location purge, notification outbox, reconciliation), its idempotency, authentication (`JOBS_SECRET`), expected cadence, failure alerting and the owner decision still needed (who schedules). Do not introduce a paid scheduler or production schedule without approval. Do not claim jobs run because endpoints exist.

### 2.3 Privacy and retention

Data inventory, retention periods as configuration (owner/legal sets values), location and evidence purge verification, minimisation review of customer/rider/recipient/signature/payment data, data-subject access/deletion handling plan, no real campus coordinates in tests. Nigerian data-protection (NDPA/NDPC) obligations are for legal review, not for the engineer to declare satisfied.

### 2.4 Accessibility and usability

axe checks and keyboard/focus review on every new critical flow at mobile-360 and desktop; no horizontal overflow; plain wording for non-technical campus users; do not claim manual device testing without evidence.

### 2.5 Pilot-readiness checklist (produce, do not self-certify)

A checklist in `docs/` listing, with status _Implemented / Tested locally / Verified externally / Awaiting owner / Awaiting AFIT / Awaiting legal-operational review / Not implemented / Unverified_, at least: AFIT written authorisation; approved delivery points, zones and route/safety rules (K45); approved rider terms; rider identity and vehicle verification process (K46); real-device Android background-location test results (K34); mapping-provider decision; **independent verification of real Paystack behaviour** using owner-controlled test credentials and an approved procedure, then separate legal/financial approval for any live use (K19/K30); refund/return/dispute policies; Nigerian legal, payment (CBN/Paystack terms) and privacy/data-protection review; job scheduling and monitoring; support/escalation staffing; incident response; backups; pilot caps and pricing; MFA recovery policy; signature legal sufficiency and storage decision; accessibility sign-off; owner sign-off.

The engineer must **not** declare the system production-ready or pilot-ready. The report states the honest status and the blockers.

### 2.6 Hard limits

Batch 6 must not silently activate live payment, payout, settlement, refunds against a real provider, paid infrastructure, real messaging or production deployment. No real AFIT coordinates. No deployment.

---

## PART 3 — TESTS AND ACCEPTANCE

Run and report actual results of: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm check:secrets`, `pnpm exec supabase db lint --local`, `pnpm exec playwright test` (mobile-360 + desktop). Where a command does not exist, say so; never invent a pass. Do not delete or skip tests to turn a run green; explain every change in test counts against the Batch 5 report. Run full regression for Batches 1–5.

Acceptance: notifications leak nothing sensitive and cannot block core transitions; reviews only for eligible completed orders with working moderation; admin tools have granular, audited permissions; security regression, reliability and recovery tests pass or blockers are reported; the pilot checklist exists with honest statuses; every earlier invariant (signature mandatory, rider cannot complete, refund cap, capacity five, placeholder terms rejected) still holds; K19/K30, K34, K45, K46 and every open decision remain visible; no real coordinates, live credentials, paid services or deployments.

---

## PART 4 — REPORTING, REVIEW PACKAGE AND STOP

Produce `docs/reports/batch-6.md` with sections A–O: A executive summary; B repository/commit/CI (exact SHAs and per-job results); C requirements traceability; D database changes; E notifications/reviews/admin design; F security review; G exact commands and results; H accessibility; I what failed or is incomplete; J technical debt; K dependencies and cost; L unresolved owner decisions; M external approvals and operational blockers; N deployment and pilot status (state explicitly it has not been deployed and is not production-ready unless truly satisfied); O final recommendation (COMPLETE / CONDITIONALLY COMPLETE / BLOCKED) — and an **INDEPENDENT REVIEW PACKAGE FOR CHATGPT** (commit SHAs, changed files, migrations, security-critical functions, RLS/grants, test summaries, CI, known issues, reproduction steps, failed/skipped checks). Update README, known issues, external approvals, security and testing docs.

Stop and report if the local stack cannot run, a security-critical requirement cannot be met, or an owner decision is needed to proceed safely. Do not start any work beyond Phase 12. Do not claim ChatGPT reviewed anything or that the owner approved anything without evidence. Stop and wait for owner review.
