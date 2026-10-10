# AFIT Market — Phase 0 Report: Discovery and Architecture

Status: **Phase 0 complete — awaiting explicit user approval.** No application code has been written.
Labels used below: **[CONFIRMED]** = fixed by the owner/handoff pack. **[RECOMMENDED]** = my proposal, needs approval. **[UNVERIFIED]** = I have not verified it against current vendor documentation; Batch 1 must verify before relying on it.

---

## A. Executive summary

The repository was an empty GitHub profile placeholder (one `README.md`, one commit, no code, no config, no tests, no secrets). As instructed it was cleared. The only content added is the handoff pack (`docs/handoff/`) and this Phase 0 documentation.

Proposed approach: a **modular monolith** — Next.js (App Router) + TypeScript + Tailwind as a mobile-first PWA, with **Supabase** (Postgres, Auth + TOTP MFA, RLS, Realtime, private Storage). Anything that must be atomic or tamper-proof (order state transitions, rider capacity of five, handover-token consumption, refund caps, location acceptance) lives in **transactional Postgres functions** behind a thin server layer, so the rules hold even if a UI or route handler has a bug. Paystack is used in test mode only; settlement/payout stays disabled and is not called escrow.

Three findings matter most:
1. **PWA background location is the biggest technical risk.** A web page generally cannot keep sending GPS once the screen locks or the tab is backgrounded. The rider flow must be designed around a visible, screen-on "active" mode, and tested on real Android phones before we commit; a native/hybrid rider app may be needed. (See §H.)
2. **Escrow-like delayed vendor release is not something we can promise.** Paystack split payments are not escrow. Settlement is built as a configurable, disabled layer. (See §G.)
3. **Almost every launch-critical dependency is a real-world approval** (AFIT permission, delivery points, legal advice, Paystack marketplace terms). The software can proceed with synthetic data, but cannot launch without these.

## B. Assessment of the existing codebase

| Item | Finding |
|---|---|
| Directory / git | `/home/user/nepamzy`, branch `claude/afit-market-phase-0-asm8xd`, one commit ("Initial commit"), clean tree |
| Contents | Only `README.md` (GitHub profile template text, no project content) |
| Package manager, deps, routes, components, backend, migrations, auth, tests, env templates, CI/deploy config, docs | None exist |
| Secrets | None found |
| Handoff pack | Provided as ZIP, extracted, all 9 files read, copied to `docs/handoff/` (unmodified) |

Nothing useful existed to preserve. Deleting `README.md` is the only removal; it is recoverable from git history (`3b65f63`).

**Repository rename:** you asked for the repo to be renamed to "AFIT Market". I have **no tool that can rename a GitHub repository** (my GitHub access is file/branch/PR level only), and this session's access is scoped to `nepamzy/nepamzy`. Please rename it yourself: GitHub → repo → Settings → General → Repository name (suggest `afit-market`; GitHub names cannot contain spaces). GitHub redirects the old URL. After renaming, tell me, because the session's repo scope may need re-adding.

## C. Proposed system architecture [RECOMMENDED unless stated]

```
 Phones (PWA)                      Server (Next.js, one deployable)               Supabase
 ┌───────────────┐   HTTPS   ┌─────────────────────────────────────┐   ┌─────────────────────────┐
 │ Customer app  │──────────▶│ Route handlers / Server Actions     │   │ Postgres (RLS on)       │
 │ Vendor app    │           │  1. authenticate (Supabase session) │──▶│  - tables + constraints │
 │ Rider app     │◀──────────│  2. check role + MFA level (aal2)   │   │  - SECURITY DEFINER fns │
 │ Admin app     │  Realtime │  3. validate input (zod)            │   │    (state machine,      │
 └───────────────┘◀──────────│  4. call domain service → SQL fn    │   │     capacity, tokens,   │
                              │ Webhook endpoint (Paystack, HMAC)   │   │     refunds, location)  │
                              │ Provider adapters: payments, maps   │   │ Auth (+TOTP MFA)        │
                              └─────────────────────────────────────┘   │ Realtime (RLS-gated)    │
                                                                        │ Storage (private)       │
                                                                        └─────────────────────────┘
```

Key design decisions:

- **D1 [CONFIRMED]** Supabase Postgres is the database. **[RECOMMENDED]** Supabase Auth, Realtime, private Storage.
- **D2 [RECOMMENDED]** Next.js App Router + React + TypeScript (strict) + Tailwind. Reason: one codebase for four role experiences, server components/route handlers for trusted logic, mature PWA story, strong Supabase SSR support. Alternative considered: separate SPA + API (more moving parts, two deployables, no benefit at this scale).
- **D3 [RECOMMENDED]** Modular monolith. No microservices, no queue infrastructure until needed. Background work (expiring tokens, location purge, webhook retry) uses Postgres-based jobs (`pg_cron`) or scheduled route handlers.
- **D4 [RECOMMENDED] Where business rules live.** Rules that must be atomic are SQL functions (`SECURITY DEFINER`, fixed `search_path`, `auth.uid()` checked inside, `FOR UPDATE` locking). Direct `INSERT/UPDATE/DELETE` on orders, assignments, tokens, proofs, ledger, refunds is **revoked** from the `authenticated` role; clients can only `SELECT` through RLS and call whitelisted functions. The service-role key is used only server-side for webhooks, jobs and admin tasks, never in browser code.
  Why: this keeps "rider presses a button to mark delivered" impossible at the database level, not just in the API.
- **D5 [RECOMMENDED]** Domain code in `src/server/modules/<module>` mirroring the 13 modules in the handoff (identity-and-access, vendors-and-catalogue, cart-and-checkout, orders-and-state-machine, payments-and-ledger, delivery-and-rider-capacity, location-and-routing, handover-proof, refunds-and-returns, disputes-and-support, notifications, admin-and-audit, privacy-and-retention). UI never contains business rules.
- **D6 [RECOMMENDED]** Money as integer **kobo** (`bigint`), currency fixed `NGN`. Never floats.
- **D7 [RECOMMENDED]** Providers behind adapters (`PaymentProvider`, `MapProvider`, `Notifier`) with mock implementations for local dev/tests. This keeps the cost and vendor-choice decisions reversible.
- **D8 [RECOMMENDED]** Tooling: pnpm, ESLint, Prettier, Vitest (unit/integration), Playwright (E2E + mobile viewport + axe accessibility), Supabase CLI local stack with SQL/pgTAP-style RLS tests. **[UNVERIFIED]** The Supabase local stack needs Docker; I must confirm Docker is available in this cloud environment in Batch 1. Fallback if not: run migration + RLS tests against a throwaway Supabase project branch (needs your approval; may cost money) — I will not do that silently.
- **D9 [RECOMMENDED]** Hosting is **not** chosen in Phase 0 and nothing is deployed. Candidates (Vercel, Render, Cloudflare) are a Batch 6 / pilot decision.

### D10 Tech decisions I could not verify (all **[UNVERIFIED]**)
Exact current package versions; Supabase MFA behavior details (whether the JWT `aal` claim can be used directly in RLS — believed yes via `auth.jwt()->>'aal'`; whether Supabase provides TOTP recovery codes); Supabase Realtime RLS behavior for private channels; Paystack refund/partial-refund API specifics and webhook event names; Paystack marketplace/delayed-settlement support. Batch 1 and Batch 3 must read current docs before coding against them.

## D. Proposed folder structure

```
afit-market/
├─ docs/
│  ├─ handoff/                 original pack (read-only reference)
│  ├─ phase-0/                 this report, batch prompts
│  ├─ adr/                     architecture decision records
│  ├─ reports/                 per-batch completion reports
│  ├─ requirements-checklist.md
│  ├─ database.md  security-privacy.md  environment.md  testing.md
│  ├─ known-issues.md  review-log.md  external-approvals.md
├─ supabase/
│  ├─ migrations/              explicit SQL migrations only
│  ├─ seed.sql                 synthetic data only
│  └─ tests/                   RLS + function tests
├─ src/
│  ├─ app/
│  │  ├─ (public)/  (auth)/
│  │  ├─ (customer)/ (vendor)/ (rider)/ (admin)/     role shells
│  │  └─ api/                  webhooks + thin handlers
│  ├─ components/ui/           design system primitives
│  ├─ server/modules/<13 modules>/   domain services, zod schemas, tests
│  ├─ server/providers/        payments/, maps/, notifications/ (+ mock)
│  ├─ lib/                     supabase clients, money, time, errors
│  └─ styles/tokens.css
├─ tests/e2e/
├─ public/ (manifest, icons)
├─ .env.example                placeholders only
└─ package.json  tsconfig.json  next.config.ts  playwright.config.ts
```

## E. Major application modules
The 13 modules from the handoff, grouped by batch ownership: Identity & access (B1); Vendors & catalogue, Cart & checkout (B2); Orders & state machine, Payments & ledger (B3); Delivery & rider capacity, Location & routing (B4); Handover proof, Refunds & returns, Disputes & support (B5); Notifications, Admin & audit, Privacy & retention (B6, with `audit_events` and retention scaffolding created from B1).

## F. Preliminary database design [RECOMMENDED]

Conventions: `uuid` PKs, `timestamptz`, money in `bigint` kobo, `created_at/updated_at`, soft-delete only where needed, **RLS enabled on every table**, enums or lookup tables for statuses with `CHECK` constraints, foreign keys with explicit `ON DELETE`, indexes on every FK and on common filters.

| Group | Tables | Notes |
|---|---|---|
| Identity | `profiles`, `role_assignments` (user, role, status, granted_by, granted_at, revoked_at) (no custom recovery-code table; see §S) | One user may hold several roles only after approval. Roles: `customer, vendor_owner, vendor_staff, rider, support_agent, finance_admin, platform_admin` |
| Vendors | `vendor_applications`, `vendors`, `vendor_staff`, `stores`, `store_hours`, `categories` | Application stays pending until approved; unapproved vendors can't sell |
| Catalogue | `products`, `product_variants`, `product_option_groups`, `product_options`, `stock_levels` | Order lines copy name/price at order time |
| Locations | `delivery_zones`, `approved_delivery_points`, `vendor_pickup_points` | **Synthetic rows only until AFIT approves**; `is_restricted`, `geofence_radius_m`, active flag, `approved_by/at` |
| Orders | `orders`, `order_items` (immutable price snapshot), `order_status_history` (append-only) | Fee breakdown columns; fulfilment type; one vendor per order (v1) |
| Payments | `payment_attempts`, `payment_events` (raw webhook, unique provider event id), `ledger_entries` (append-only, double-entry-style), `settlement_batches` (disabled) | Idempotency keys; unique `(provider, provider_reference)` |
| Riders | `rider_profiles`, `rider_shifts`, `delivery_assignments` (partial unique index + function guard for capacity), `delivery_stops` | `status`: OFF_DUTY/ACTIVE |
| Location | `rider_location_current` (1 row/rider), `rider_location_history` (retention-limited), `arrival_detections` | Writes only via function that checks active shift + active assignment |
| Proof | `handover_tokens` (sha256 hash, expiry, single-use, bound order+assignment+type, attempt counter), `handover_proofs`, `signature_assets` (private Storage path, hash, metadata) | |
| Refunds/returns | `refund_cases`, `refund_lines` (per order_item), `refunds` (provider ref, idempotency key), `return_cases`, `return_tasks`, `return_events` | Cap enforced in function + constraint |
| Disputes | `disputes`, `dispute_statements`, `dispute_evidence`, `dispute_decisions` | |
| Platform | `notifications`, `reviews`, `audit_events` (append-only, no UPDATE/DELETE grant), `admin_actions`, `platform_settings` | |

Transaction boundaries (each = one SQL function = one transaction): place order; record payment verification; vendor transition; **accept delivery (locks rider row, counts active assignments, inserts or fails)**; reassign (invalidates tokens, new token); consume handover token + finalise proof + transition + audit; issue refund (locks order's refundable balance); accept location ping.

**Append-only enforcement:** `audit_events`, `order_status_history`, `ledger_entries`, `handover_proofs`, `payment_events` get triggers that raise on UPDATE/DELETE, plus no grants. Corrections are new rows.

## G. Role and permission model [RECOMMENDED]

| Role | Can | Cannot | MFA |
|---|---|---|---|
| customer (public visitor) | Browse public vendors/products **without registering** | Anything account-bound | None |
| customer (registered) | Order, view **own** orders, own rider location for **own active delivery**, report issues | See others' orders; any admin/vendor function | **Required (TOTP, aal2) before placing orders or using protected account features** (owner decision, review round 1) |
| vendor_owner / vendor_staff | Manage **own** store/catalogue, view/transition **own** orders, pickup handover screen | Other vendors' data; payouts config (owner only) | **Required (aal2)** before any privileged vendor action |
| rider | Go Active/Inactive, view eligible offers, accept ≤5, send location while active, report problems | Mark delivered; see other riders; see location history | **Required (aal2)** before Go Active/accept |
| support_agent | Read dispute bundles, add notes, propose resolutions | Move money, change evidence, reset MFA | Required |
| finance_admin | Reconciliation, approve refunds within limit | Edit ledger rows, vendor approval | Required |
| platform_admin | Approve/suspend vendors/riders, zones/points, settings | Rewrite audit/proof/ledger; silently reset others' MFA | Required |

Enforcement layers: (1) RLS on every table using `auth.uid()` and role/ownership helper functions; (2) MFA: RLS and functions require `auth.jwt()->>'aal' = 'aal2'` for privileged roles **[UNVERIFIED claim path]**; (3) server route checks role + aal; (4) UI hiding is cosmetic only. Money-moving admin actions need a limit and second approver above a configured threshold (threshold = owner decision).

## H. Location-tracking design

- Default `OFF_DUTY`. `Go Active` is a deliberate tap showing a plain-language consent (what is collected, who sees it, when it stops). Only then does the browser's permission prompt appear. A persistent banner "Location sharing ON" and one-tap "Go inactive" (blocked with an explanation while a handover is in progress; support-assisted reassign path exists).
- Server function `submit_location(lat, lng, accuracy_m, captured_at)` rejects unless: caller is a rider with `ACTIVE` shift **and** ≥1 active assignment (or a narrowly-defined in-progress handover); `captured_at` within allowed clock skew; accuracy ≤ configured max. Coordinates come from `navigator.geolocation` only — no manual entry anywhere.
- Storage: `rider_location_current` overwritten per ping; `rider_location_history` only while a delivery is active, purged on a schedule (default **30 days, placeholder pending legal advice**).
- Visibility: RLS lets a customer read a rider position only when `order.customer_id = auth.uid()` **and** the assignment is active and the order is in an eligible state. Nobody can list riders. Stops showing when the order ends.
- Staleness: UI shows "Location last updated X ago — map may be out of date" after a threshold (default 60 s, configurable); stale or inaccurate fixes are ignored for arrival.
- Arrival: server computes distance to the approved point; arrival requires **N consecutive fresh fixes** inside the geofence with acceptable accuracy → writes `arrival_detections` and moves to `ARRIVAL_DETECTED`. Arrival never completes an order. GPS unavailable → rider taps "GPS issue" → support flag + admin-controlled, audited exception that still cannot skip signature.
- **PWA limitation [UNVERIFIED — must test on target Android devices]:** `watchPosition` normally pauses when the page is hidden/screen locked; no reliable web background geolocation. Mitigation plan: "active delivery mode" screen with Screen Wake Lock API, clear "keep this screen open" guidance, offline queue of pings, stale handling. If Batch 4 device tests show this is unworkable, I will document evidence and recommend a thin native/hybrid rider app (Capacitor or similar) — a cost/scope decision for you. I will not claim background tracking works until tested on real devices.

## I. Delivery-proof design (summary; full rules in handoff)

- Tokens: 128-bit CSPRNG, stored as SHA-256 hash only, TTL (default 15 min, configurable), single-use, bound to `(order_id, assignment_id, fulfilment_type, purpose)`; re-issue on reassignment invalidates old ones. Short in-app code (8 chars, unambiguous alphabet) only resolves within a **narrow scope** (the calling vendor's eligible pickup orders) with per-actor and per-order attempt limits and lockout, because short codes are brute-forceable.
- Signature: drawn on canvas → PNG stored in a **private** bucket, SHA-256 recorded, linked to the handover event, submitting session id and timestamp. Recipient sees the order summary first.
- **Core anti-forgery rule:** a rider's device alone must never be able to produce a "recipient-confirmed" handover. Preferred: recipient confirms in their own authenticated session. Fallback ("controlled shared screen"): the rider hands the phone over, but confirmation still needs a secret that exists only in the recipient's own app/session (e.g., a recipient-app code); if the recipient has no working phone, the only path is an audited support exception — and it can't waive the signature.
- Completion function `complete_handover(...)` runs in one transaction: verifies order status, token validity/binding/expiry/not-used, actor, signature present, selected optional proof, then transitions state, writes proof + audit + receipt, invalidates tokens, stops location sharing for that order. There is **no** function a rider can call to set `DELIVERED`.
- Honest limits (for disputes): GPS ≠ handover; signature ≠ items correct; QR can be shared. Evidence bundle assembled per handoff §7.

## J. Security and privacy threat assessment (top risks)

| # | Threat | Mitigation | Verified in |
|---|---|---|---|
| 1 | Customer reads another's order (IDOR) | RLS ownership policies; tests | B1/B2 |
| 2 | Vendor edits another vendor's products | RLS via `vendor_staff`; tests | B2 |
| 3 | Privilege escalation via forged role/status in request | No client-writable role columns; functions derive actor from `auth.uid()` | B1 |
| 4 | Service-role key leak | Server-only env, `import 'server-only'`, CI secret scan, never `NEXT_PUBLIC_` | B1 |
| 5 | MFA bypass (UI-only check) | aal2 enforced in server guards **and** restrictive RLS (pattern verified in Supabase docs); no custom weaker recovery path; recovery per `docs/security-privacy.md` after Batch 1 verification spike | B1 |
| 6 | Account takeover / credential stuffing | Supabase rate limits + app rate limits, MFA, session revocation on MFA change | B1/B6 |
| 7 | Payment spoofing / replayed webhook | HMAC-SHA512 signature check on raw body, server-side verify, unique event id, idempotent handler, amount+currency check against order | B3 |
| 8 | Duplicate / excess refund | Row lock on order refundable balance, idempotency key, DB check constraint | B5 |
| 9 | Rider exceeds 5 / race | Single transaction w/ `FOR UPDATE` on rider + count; concurrency test (6 parallel accepts) | B4 |
| 10 | QR replay / wrong rider / brute force | Hash-only, single-use, binding, TTL, attempt limits | B5 |
| 11 | Rider fakes delivery / GPS spoofing | No client completion; signature required; recipient-session confirmation; spoofing is **not fully preventable on a PWA** — mitigate with plausibility checks and audit, document residual risk | B4/B5 |
| 12 | Location stalking of riders / customers | Opt-in only, RLS-scoped visibility, retention purge, no history exposure | B4 |
| 13 | Sensitive campus data exposure | Synthetic data only; approved-points table; no free-text coordinates; restricted flag never returned to clients | B2/B4 |
| 14 | Admin silently alters evidence/ledger | Append-only triggers, no grants, admin actions audited | B1/B6 |
| 15 | Signature/evidence leak | Private bucket, short-lived signed URLs issued per authorised request | B5 |
| 16 | XSS / CSRF / injection | Strict CSP, framework escaping, zod validation, parameterised SQL, SameSite cookies | B1 |
| 17 | PII in logs | Redacting logger; no tokens/signatures/passwords | B1 |

Privacy: collect minimum; notices for location and signatures; retention schedule (placeholders until legal advice); access/deletion workflow preserving legally required records; synthetic data only in dev.

## K. Payment and settlement risk assessment

- **Risk 1 (high): delayed release/escrow.** Paystack split payments/subaccounts distribute settlement; that is not custody/escrow, and holding customer funds until confirmation may need licensing. **Decision:** build `settlement_policy` (e.g., `PROVIDER_SPLIT_IMMEDIATE`, `MANUAL_PAYOUT_AFTER_COMPLETION`, `DISABLED`) default `DISABLED`; ledger tracks "owed to vendor" as bookkeeping only; UI wording never says "escrow/held safely". Needs: Paystack written confirmation + Nigerian counsel.
- **Risk 2 (high): refunds after settlement.** Refund API and split interplay unverified; vendors may have already been paid. Needs Paystack answer; ledger models vendor clawback as a receivable.
- **Risk 3 (med): amount tampering.** Server computes totals from DB prices; verifies provider-returned amount == order total in kobo.
- **Risk 4 (med): duplicate charge/webhook ordering.** Idempotency keys, unique constraints, state guards.
- **Risk 5 (med): reconciliation drift.** Daily reconciliation job comparing ledger vs Paystack list/verify (B3 basic, B6 views).
- **Risk 6 (low-med): chargebacks/disputes at provider.** Process unknown; ask Paystack.
- No wallet, no stored value, no real keys, no live charges until you approve.

## L. External services that may create cost

| Service | Why | Free option? | If unavailable | Cost status |
|---|---|---|---|---|
| Supabase | DB/Auth/Realtime/Storage | Free tier suits dev; **pilot likely needs Pro** (backups, no pausing) | App down | **[UNVERIFIED]** current pricing; est. low tens of USD/month |
| Hosting (Vercel/Render/etc.) | Run Next.js | Free hobby tiers exist but may not allow commercial use | App down | **[UNVERIFIED]**; decided in B6 |
| Paystack | Card/transfer payments | No monthly fee; per-transaction fees | No online payment | **[UNVERIFIED]** fee schedule; confirm |
| Map tiles + routing | Live map, distance, ETA | OSM-based tiles/OSRM possible, but public OSM servers forbid heavy/production use; Mapbox/Google have free quotas then per-request billing | Show status + last known text, no map | **[UNVERIFIED]**; provider chosen in B4 after coverage test |
| Email (transactional) | Optional | Free tiers exist | In-app only | Optional |
| Web Push | Optional | Free (VAPID) | In-app only | Optional |
| SMS | **Not used** | — | — | Excluded by design |
| Error monitoring (e.g., Sentry) | Reliability | Free tier | Less visibility | Optional, B6 |
| Domain | Public URL | No | — | Annual fee, B6 |

No paid service is enabled in Phase 0 or Batch 1 (Supabase free tier/local only).

## M. Testing strategy

Pyramid: Vitest unit tests for pure logic (money, fee calc, state machine table, geofence math, freshness, token generation, refund calculation); SQL tests against the local Supabase stack for RLS (allowed **and** denied), constraints, append-only triggers, SECURITY DEFINER functions; integration tests for route handlers with mocked providers; **concurrency tests** with parallel connections (6 simultaneous accepts, duplicate webhooks, double refund); Playwright E2E on a mobile viewport for the main journeys plus axe accessibility checks; security checks (secret scan, dependency audit, CSP, authorization matrix tests auto-generated from the permission table). Reporting uses the six categories required by your prompt (passed / failed / not run / blocked by credentials / manual / external approval). Real-device Android GPS tests are manual and tracked separately.

## N. Proposed implementation sequence and acceptance criteria

Batch 1 (P1+P2) → Batch 2 (P3+P4) → Batch 3 (P5+P6) → Batch 4 (P7+P8) → Batch 5 (P9+P10) → Batch 6 (P11+P12). Each batch stops for review. Exit criteria per phase are exactly those in `docs/handoff/PHASED_ROADMAP.md`; **I recommend adding** these cross-cutting criteria to every batch: all new tables have RLS + denied-access tests; no secrets in repo (scan passes); `typecheck`, `lint`, `test`, `build` green; docs updated; requirements checklist updated; known-issues list current.

Batch 1 acceptance (detail in `BATCH_1_PROMPT.md`): app builds; responsive shells for 4 roles with mock data; design tokens; Supabase migrations apply cleanly from scratch; RLS negative tests pass; TOTP enroll/challenge/recovery working; admin/vendor/rider privileged routes and DB policies reject aal1 sessions; unauthenticated and wrong-role access rejected; append-only audit table works.

## O. Unresolved decisions and approvals

**Owner decisions needed (blocking nothing in Batch 1 unless noted):**
1. Approve the architecture in §C (or request changes). **Blocks Batch 1.**
2. Rename repo (you do this in GitHub settings).
3. ~~Customer MFA policy~~ **Decided in review round 1:** public browsing needs no account; registered customers need TOTP before ordering or protected account features; all staff/vendor/rider roles need MFA for protected features.
4. Hosting preference (decide by Batch 6).
5. ~~Rider app form~~ **Decided:** PWA first. If real-device tests show the PWA cannot meet tracking needs I stop and report evidence; starting a native app is the owner's decision only.
6. Pilot parameters: number of vendors/riders, order caps, commission, delivery fee formula (needed by Batch 2/3; defaults will be placeholders).
7. Refund approval limits / second-approver threshold (Batch 5).

**External approvals (cannot be coded around):** AFIT written permission and authorised signatory; approved delivery points/zones/hours/prohibited areas; AFIT name/logo use; Paystack marketplace settlement confirmation; Nigerian legal/compliance advice on funds flow, signatures-as-evidence, NDPA obligations, retention periods; return policy per category; device testing on target Android phones. Full list in `docs/handoff/PHYSICAL_ACTION_CHECKLIST.md`.

**Assumptions I made (not verified):** Docker available for the local Supabase stack; Supabase TOTP MFA exposes `aal` in the JWT usable by RLS; no built-in TOTP recovery codes; Paystack supports partial refunds via API; Next.js + Supabase SSR works on the chosen host.

## P. Requirement-to-phase coverage (nothing dropped)
Every item in your 35-section prompt and the handoff roadmap maps to a batch: auth/MFA/roles → B1; vendor/catalogue/browse/cart/checkout → B2; payments/ledger/state machine/vendor ops/pickup handover → B3; rider/capacity/location/map/ETA/arrival → B4; signature/QR/completion/refunds/returns/disputes → B5; notifications/reviews/admin/hardening/accessibility/pilot → B6. Audit-event table and design system are introduced in B1 and reused later.

## Q. Phase 0 completion assessment

**COMPLETE for Phase 0 scope** (discovery, architecture proposal, risk assessment, plan). No code or tests exist yet, so no test results are claimed. Several recommendations are **[UNVERIFIED]** against current vendor docs and are explicitly scheduled for verification in Batch 1/3/4.

## R. INDEPENDENT REVIEW PACKAGE FOR CHATGPT
Submit: this file, `docs/phase-0/BATCH_1_PROMPT.md`, and `docs/handoff/DECISIONS_AND_OPEN_GATES.md`. Suggested review questions: (1) Is moving business rules into SECURITY DEFINER SQL functions the right trade-off vs. app-layer services (testability, migration discipline)? (2) Is the "recipient-held secret" approach sufficient against a colluding rider? (3) Are the PWA location mitigations realistic? (4) Is the MFA recovery design acceptable? (5) Anything in the 35-section brief that the batch plan drops? No code diffs exist yet; none are provided. I have not claimed any ChatGPT review has occurred.

---

## S. Review round 1 — corrections incorporated (owner decision: APPROVED IN PRINCIPLE WITH CORRECTIONS)

No architecture change. Verification done after review (Supabase docs, via docs search; no code written):

| Item | Result |
|---|---|
| JWT `aal` claim usable in RLS | **Verified** in Supabase MFA docs: `auth.jwt()->>'aal'`; documented template uses a `RESTRICTIVE` policy `to authenticated using ((select auth.jwt()->>'aal') = 'aal2')`. JWTs with no `aal` claim are aal1. |
| Unenrolling a verified factor | **Verified**: requires an `aal2` session. |
| Enrolling/verifying a factor | **Verified**: verifying logs out all other sessions and promotes the current one to aal2. |
| TOTP recovery codes | **Verified: not provided as a standard feature.** Docs say Supabase does not return recovery codes and recommend registering a **backup TOTP factor** on a different device/app; Supabase cannot restore access if all factors are lost. The JS reference lists an **experimental** recovery-codes factor (`auth.experimental.recoveryCodes: true`: regenerate/unenroll). Whether it works with the local CLI stack, its stability, and how it interacts with aal levels are **UNVERIFIED** → Batch 1 verification spike before any recovery coding. |
| My earlier "custom hashed recovery codes" proposal | **Withdrawn.** A separate custom recovery mechanism could create a weaker second authentication system. Batch 1 must not build one. |
| Local Supabase stack | **BLOCKER to confirm in Batch 1:** Docker client and `dockerd` are installed in this environment but the daemon is **not running** (no `/var/run/docker.sock`). Batch 1 may try to start the local daemon (free, local); if it cannot run, Batch 1 stops and reports. It must not silently use a remote project or paid service. |

Other corrections adopted: customer MFA policy (above); SECURITY DEFINER hardening checklist and "don't put every rule in SQL" boundary; rider-PWA evidence rule; handover/proof rules restated as testable acceptance criteria; payments mock/test-mode only with settlement disabled and no "escrow" wording; root README; updated docs set. See `docs/review-log.md`.

### S.2 Follow-up (v3)
Recovery policy refined: no custom recovery table; backup-factor investigation; do not silently require all customers to enroll a second factor; stop for owner if secure recovery cannot be verified. Session revocation after factor changes added to the verification list. See `docs/review-log.md` and `docs/phase-0/BATCH_1_PROMPT.md` v3.
