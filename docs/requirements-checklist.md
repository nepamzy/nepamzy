# Requirements checklist (end of Batch 5)

Legend: ☐ Planned (not built) · ◐ Planned, designed (Phase 0) · ◑ Implemented, not fully tested · ✔ Implemented and Tested · ⛔ Blocked / owner decision.

| Area                                                      | Requirement                                                                                                                      | Batch | Status                                                       | Evidence                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------ | ---------------------------- |
| Foundation                                                | Next.js/TS strict/Tailwind app, scripts, env template, env validation                                                            | 1     | ✔                                                            | build, typecheck, unit       |
| Foundation                                                | Design system and components                                                                                                     | 1     | ✔                                                            | `/design`, axe on all shells |
| Foundation                                                | Role shells (customer, vendor, rider, admin) with mock data; Go Active is a **non-functional preview** with no geolocation calls | 1     | ✔                                                            | e2e shells                   |
| Foundation                                                | PWA basics: manifest, icon, offline fallback via service worker                                                                  | 1     | ✔ (placeholder icon is an SVG only)                          | e2e                          |
| Foundation                                                | Security headers, nonce CSP, secret scan                                                                                         | 1     | ✔                                                            | e2e headers, `check:secrets` |
| Foundation                                                | CI workflow (lint, typecheck, unit, build, secrets)                                                                              | 1     | ◑ (workflow written, not executed on GitHub in this session) | —                            |
| Identity                                                  | Supabase Auth email+password, confirmation email, session refresh, sign-out                                                      | 1     | ✔                                                            | e2e journey                  |
| Identity                                                  | Roles, RLS everywhere, audited role grants, append-only audit                                                                    | 1     | ✔                                                            | db tests                     |
| MFA                                                       | TOTP enrol/challenge/verify/factor list/removal; session upgrade; server + DB enforcement                                        | 1     | ✔                                                            | db, e2e, API pins            |
| MFA                                                       | Customer policy (MFA before ordering / protected features); staff/vendor/rider MFA before protected features                     | 1     | ✔                                                            | db, e2e                      |
| MFA                                                       | Backup authenticator                                                                                                             | 1     | ✔                                                            | e2e journey                  |
| MFA                                                       | Recovery after losing ALL factors                                                                                                | 1     | ⛔ owner decision                                            | `security-privacy.md` §3     |
| Security                                                  | Rate limiting login/MFA, audited failures                                                                                        | 1     | ✔                                                            | e2e                          |
| Security                                                  | SECURITY DEFINER hardening + parallel-connection harness                                                                         | 1     | ✔ (harness proven on a stub)                                 | db tests                     |
| Vendors                                                   | Onboarding, catalogue, hours, stock                                                                                              | 2     | ☐                                                            | —                            |
| Customers                                                 | Browse (real data), cart, checkout prep, order creation                                                                          | 2     | ☐ (public browse shows sample data)                          | —                            |
| Payments                                                  | Paystack test mode, webhooks, idempotency, ledger; settlement disabled                                                           | 3     | ☐ (setting `settlement_policy` code-locked to DISABLED)      | db test                      |
| Orders                                                    | Server-side state machine, audit                                                                                                 | 3     | ☐ (status vocabulary only)                                   | —                            |
| Pickup                                                    | One-screen vendor handover, signature                                                                                            | 3     | ☐ (non-functional preview)                                   | —                            |
| Riders                                                    | Onboarding, Go Active, capacity 5 atomic                                                                                         | 4     | ☐                                                            | —                            |
| Location                                                  | Opt-in, freshness, map/ETA, arrival (never completes)                                                                            | 4     | ☐                                                            | —                            |
| Proof                                                     | Signature, optional single-use bound QR/code                                                                                     | 5     | ☐                                                            | —                            |
| Refunds, returns, disputes                                | Full/partial, caps, idempotency, evidence                                                                                        | 5     | ☐                                                            | —                            |
| Notifications, reviews, admin, hardening, pilot readiness |                                                                                                                                  | 6     | ☐                                                            | —                            |
| External                                                  | AFIT permission, Paystack/legal confirmations                                                                                    | —     | ☐ (owner)                                                    | `external-approvals.md`      |

## Batch 2 additions

| Area      | Requirement                                                                                 | Batch | Status                            | Evidence                 |
| --------- | ------------------------------------------------------------------------------------------- | ----- | --------------------------------- | ------------------------ |
| Vendors   | Application, admin approve/reject (no self-approval), suspend/reinstate, audit              | 3     | ✔                                 | DB vendors tests, e2e    |
| Vendors   | Shop profile, weekly hours (Africa/Lagos), temporary closure, staff                         | 3     | ✔                                 | DB + e2e                 |
| Catalogue | Products, options, stock, availability, archive; integer kobo                               | 3     | ✔ (no images)                     | DB + e2e                 |
| Browsing  | Anonymous browse/search/filter via function-only read model; suspended/archived hidden      | 4     | ✔                                 | DB public, e2e           |
| Cart      | One-vendor cart, quantity/option rules, conflict message, server pricing                    | 4     | ✔ (no anonymous cart)             | DB orders, e2e           |
| Checkout  | Pickup/delivery, approved delivery points, blocked-state messages, aal2                     | 4     | ✔                                 | e2e marketplace          |
| Orders    | Atomic idempotent creation, immutable snapshots, stock reservation, cancel, expiry, history | 4     | ✔ (expiry not scheduled, K18)     | DB orders + concurrency  |
| Payments  | Mock payment, local only, fails closed in production mode                                   | 4     | ✔ (mock only; Paystack = Batch 3) | DB + e2e production mode |
| Quality   | Axe + 360px/desktop on new pages                                                            | 3–4   | ✔ automated; ☐ manual             | e2e                      |

## Batch 3 additions

| Area     | Requirement                                                                           | Batch | Status                                  | Evidence                    |
| -------- | ------------------------------------------------------------------------------------- | ----- | --------------------------------------- | --------------------------- |
| Payments | Server-side initialize + verify (test mode), amount from DB                           | 5     | ✔ vs fake provider; ☐ real API          | e2e payments-fulfilment     |
| Payments | Signed webhook, idempotent event store, replay/out-of-order/mismatch/late handling    | 5     | ✔                                       | DB payments, unit, e2e      |
| Payments | Ledger (receipts only), reconciliation flags + admin page, refund requests            | 5     | ✔ (no provider refund call)             | DB payments, e2e            |
| Payments | Live keys rejected, no settlement/payout                                              | 5     | ✔                                       | unit env, settlement locked |
| Orders   | Vendor accept/reject/prepare/ready; illegal transitions rejected; history append-only | 6     | ✔                                       | DB fulfilment, e2e          |
| Handover | One-time code (hashed), mandatory signature, evidence, replay/wrong-order tests       | 6     | ✔                                       | DB fulfilment, e2e          |
| Receipts | PDF receipt for customer and shop                                                     | 6     | ✔                                       | e2e                         |
| Ops      | Expiry job route; request id in logs; CI job for DB+e2e                               | 5–6   | ✔ route/logs; ✔ CI job passed on GitHub | e2e, unit                   |

## Batch 4 additions (R-numbers from the owner's Batch 4 v2 prompt)

| ID     | Requirement                                                         | Status                            | Evidence                                          |
| ------ | ------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| R1     | Rider approval, protected access, MFA                               | ✔                                 | `riders.test.ts`, route policy, e2e 403s          |
| R2     | Terms acknowledgement before first activation (placeholder terms)   | ✔ (terms text ⛔ owner/counsel)   | `riders.test.ts`, e2e                             |
| R3     | Rider profiles, shifts, current location, limited history           | ✔                                 | migrations 000002/000003, RLS tests               |
| R4     | Explicit Go Active / Inactive; no geolocation call before Go Active | ✔                                 | e2e geolocation counter                           |
| R5     | Safe shift end (none / release / refuse)                            | ✔                                 | `riders.test.ts`, e2e                             |
| R6     | Atomic five-delivery maximum                                        | ✔                                 | `rider-concurrency.test.ts` incl. control-removal |
| R7     | Assigned orders, pickup, destination, distance, ETA                 | ✔ (fake/straight-line, labelled)  | e2e                                               |
| R8     | No manual coordinates / client-claimed arrival                      | ✔                                 | catalog test, no endpoint                         |
| R9     | Server geofence with freshness + accuracy validation                | ✔                                 | `location.test.ts`, unit                          |
| R10    | Rider issue reporting                                               | ✔                                 | `riders.test.ts`, e2e                             |
| R11    | No rider-controlled completion                                      | ✔                                 | catalog + journey tests                           |
| R12    | Assignment-bound, expiring, single-use, hashed tokens               | ✔                                 | `riders.test.ts`                                  |
| R13    | Location visible only to authorised viewers                         | ✔                                 | `location.test.ts`, e2e API checks                |
| R14    | Tracking only during eligible active work                           | ✔                                 | lifecycle tests, e2e                              |
| R15    | Limited history + purge                                             | ✔ (scheduling = deployment)       | `location.test.ts`                                |
| R16    | Accuracy, freshness, rate limits, stale UX                          | ✔                                 | tests, e2e                                        |
| R17    | Route distance when a provider exists                               | ✔ adapter + fake; ☐ real provider | unit                                              |
| R18    | Synthetic coordinates only                                          | ✔                                 | seed, fixtures                                    |
| R19    | No automatic penalty for missing location                           | ✔ (no such code path)             | code review                                       |
| R20    | Notifications expose no location                                    | ✔ (no notifications exist yet)    | n/a                                               |
| R21    | Background tracking                                                 | ⛔ UNVERIFIED                     | manual script                                     |
| R22    | Physical approvals documented                                       | ✔                                 | `external-approvals.md` #9-15                     |
| R23    | Earlier requirements intact                                         | ✔                                 | full regression                                   |
| Part 0 | Pickup secret out of the database                                   | ✔                                 | `fulfilment.test.ts`, unit                        |
| Part 0 | Accessible signature alternative (gated, off)                       | ◑ owner decision                  | `fulfilment.test.ts`                              |

## Batch 5 additions (traceability to the owner's master Batch 5 prompt)

Legend as above. "Tested" means executed locally in this sandbox (GitHub results are in `docs/reports/batch-5.md` section J). Nothing is verified against the real Paystack API or on real devices.

| ID                                                           | Requirement                                                                                                           | Status                   | Evidence                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| A8/K48                                                       | Placeholder rider terms never authorise rider work (database level)                                                   | ✔                        | `20261014000001`; `riders.test.ts` A8 block; rider e2e             |
| B1/P9-4                                                      | Delivery completion is server-authoritative; the rider has no completion action                                       | ✔                        | `complete_delivery`; `delivery.test.ts` (actors, catalog list)     |
| B2/P9-1                                                      | Mandatory drawn signature; empty/tiny/non-PNG/oversize refused; typed refused for deliveries                          | ✔                        | `delivery.test.ts`, `signature.test.ts`, `delivery.spec.ts`        |
| B3/P9-7                                                      | Immutable evidence bound to order + assignment; audit event; receipt (on demand)                                      | ✔                        | `handover_evidence` extension; tests                               |
| B4/P9-3                                                      | One-time hashed expiring bound proof token; substitution, expiry, replay, reassignment refused                        | ✔                        | `delivery.test.ts`                                                 |
| B5/B8                                                        | One transaction; partial failure leaves no state; exactly one completion under 8 concurrent requests; control-removal | ✔                        | `delivery-concurrency.test.ts`                                     |
| P9-6/P9-8                                                    | Slot freed once, location stored position removed, `completed` status, rider-capacity tests re-run                    | ✔                        | `delivery.test.ts`, `rider-concurrency.test.ts`                    |
| 1.4                                                          | Vendor counter: find ONE pending order by code (rate limited); completion still needs code + signature                | ✔                        | `delivery.test.ts`, `payments-fulfilment.spec.ts`                  |
| 1.5                                                          | Supervised exception path that never delivers                                                                         | ✔                        | `ops_handle_delivery_exception`; tests                             |
| C1-C4/P10-1,2                                                | Refund request/approval/execution separated; caps, idempotency, quantities; fake provider only; reconciliation        | ✔ (local, fake)          | `refunds.test.ts`, `refund-concurrency.test.ts`, `support.spec.ts` |
| C5/P10-4                                                     | Returns separate from refunds; policy per category configurable; no restock                                           | ✔ (customer-brings only) | `cases-returns.test.ts`; K49                                       |
| C6-C7/P10-3,5,6                                              | Cases with party-scoped statements, neutral bundle, reasoned human decisions, original proof untouched                | ✔                        | `cases-returns.test.ts`, `support.spec.ts`                         |
| C8                                                           | Vendor-rejected paid orders keep the flag -> request -> approval -> execution distinction                             | ✔                        | request on a CANCELLED paid order leaves it CANCELLED              |
| C9                                                           | Audit + events for every step                                                                                         | ✔                        | `refund_events`, `case_events`, `audit_events`                     |
| Real refund execution                                        | Paystack refund call                                                                                                  | ☐ not built (fake only)  | K29/K30                                                            |
| Return rider tasks, QR image, evidence upload, notifications |                                                                                                                       | ☐                        | K49, K51, K54, K55                                                 |
