# AFIT Market — 12-Phase Implementation Roadmap

**Rule:** one phase at a time. At the end of each phase Claude Code stops and reports. The user reviews and explicitly approves before the next phase.

## Phase 0 — Repository discovery and architecture proposal
Inspect repository, dependencies, git status, existing code and tests. Deliver architecture decision record, threat model, data-flow diagram, proposed schema, phase acceptance criteria and risks. No feature coding.
**Exit:** user approves architecture and scope.

## Phase 1 — Project foundation and design system
Set up/confirm Next.js, TypeScript, lint/format/test tooling, responsive layout, accessible design tokens, navigation shells for customer/vendor/rider/admin, environment template, CI/local checks. Use mock data only.
**Exit:** builds locally; no secrets; responsive shell reviewed.

## Phase 2 — Supabase schema, authentication, roles and 2FA
Create migrations, profile/role model, Supabase Auth integration, MFA enrollment/challenge/recovery UX, protected routes, RLS policies and negative tests. Enforce 2FA for admins and privileged vendor/rider operations. No production user data.
**Exit:** role/RLS tests prove users cannot access other users' records; MFA enforced server-side.

## Phase 3 — Vendor onboarding and catalogue
Vendor applications/approval, store profiles, opening hours, categories, products, options/add-ons, stock, availability and vendor dashboard. Seed synthetic vendors/products.
**Exit:** approved vendor can manage catalogue; unapproved vendor cannot sell.

## Phase 4 — Customer browsing, cart and checkout preparation
Search/filter, vendor pages, product details, cart, one-vendor-per-order rule, pickup/delivery choice, approved destination selector, fee breakdown and order creation before payment. Mock payment only.
**Exit:** checkout calculations and order creation tests pass.

## Phase 5 — Payments, webhook verification and ledger
Integrate Paystack in test mode only. Server-side initialization/verification, signed webhook validation, idempotency, payment event history, failed payment handling, reconciliation and refund primitives. Keep settlement gated pending provider/legal confirmation.
**Exit:** simulated/replayed webhook tests pass; no live keys or production payouts.

## Phase 6 — Vendor order operations and pickup handover
Order state machine, vendor accept/reject/prepare/ready actions, simple vendor handover screen, one-time pickup QR/code, mandatory recipient signature, private receipt/evidence storage and PDF receipt. Test token replay and wrong-order cases.
**Exit:** pickup cannot complete without required server-validated proof.

## Phase 7 — Rider onboarding, active shift and capacity-five assignment
Rider approval/profile, Go Active/Inactive, location permission/status, eligible order offers, atomic maximum of five accepted active deliveries, assignment-bound QR/code tokens, vendor-to-rider handover, route/order sequence and rider issue reporting.
**Exit:** concurrency tests prove six simultaneous accepts cannot exceed five active jobs.

## Phase 8 — Live location, map, ETA and automatic arrival
Provider adapter, approved delivery points/zones, GPS update service, freshness/accuracy checks, live map updates, route distance/ETA, arrival geofence and stale-location UX. Use fake locations first; real coordinates only after AFIT approval.
**Exit:** tracking is off-duty by default, privacy access tests pass, arrival is not based on stale/inaccurate GPS.

## Phase 9 — Delivery proof, signature, QR/code and completion
Recipient handover screen, mandatory signature, optional order-bound QR or in-app code, proof validation, immutable audit events, server-controlled completion, location stop behavior and receipt. Rider has no direct delivered action.
**Exit:** no order completes without all mandatory conditions; replay/forgery/incorrect-rider tests pass.

## Phase 10 — Refunds, returns, disputes and support
Item-level partial refunds, full refunds, return authorization and return tasks, evidence timeline, vendor/rider statements, admin review, audit history and reasoned decisions. No automatic guilt decisions.
**Exit:** refund caps/idempotency and return state tests pass; food/hygiene policy is configurable.

## Phase 11 — Notifications, reviews, admin and operational tools
In-app notifications, optional push/email, reviews, admin dashboards, vendor/rider moderation, financial reconciliation views, audit search, rate limits, abuse controls and support workflows.
**Exit:** key events visible; admin permissions separated; tests pass.

## Phase 12 — Hardening, pilot readiness and release gate
End-to-end tests, accessibility, low-bandwidth/error handling, load and security testing, backup/restore test, privacy/retention review, map and payment cost review, vendor/rider training docs, incident procedures, production checklist and pilot runbook. No deployment until user explicitly approves.
**Exit:** signed-off readiness checklist and AFIT approvals. Only then can a separate deployment phase be authorized.

## Phase count
This plan has **13 phases including Phase 0** (Phase 0 through Phase 12). Phase 0 is discovery, not implementation. If you count only build phases, there are **12 build phases** (Phase 1–12).

## Acceptance report template
- Phase:
- Scope completed:
- Files/migrations changed:
- Tests run and results:
- Security/privacy checks:
- Known limitations:
- Manual review steps:
- Open decisions:
- Next phase proposal:
- Awaiting explicit approval: YES
