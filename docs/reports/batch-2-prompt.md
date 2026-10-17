# PROMPT — AFIT Market Implementation Batch 2 (Phases 3 + 4)

> Self-contained. Use ONLY after the owner has reviewed the Batch 1 report and explicitly approved this prompt. Implement Phases 3 and 4 only, then stop and report. Do not restart the project, create a new roadmap, skip phases, or begin Phase 5.
> Version: v1, written at the end of Batch 1 (2026-10-10).

---

# PART 0 — CORRECTIONS AND CARRIED-FORWARD FINDINGS FROM BATCH 1 (read first; binding)

## 0.1 Owner decisions still open (do not decide them yourself)

1. **MFA recovery after losing ALL authenticators is not implemented.** No custom recovery-code table, no weaker login path, no experimental Supabase recovery factor (it is unavailable on the local server). Do not build recovery in this batch. If the owner has since decided, the decision will be pasted in `docs/review-log.md`; follow it exactly, with the safety rules in `docs/security-privacy.md` §3.
2. Whether a backup authenticator is **required** for privileged roles (currently offered, not forced) and whether TOTP enrolment is forced at sign-up (currently: required before ordering / protected features; privileged roles are pushed to enrol at first sign-in).
3. Pilot parameters still unset: commission, delivery-fee formula, order caps, opening-hour rules. Use **clearly labelled placeholder values stored as configuration (`platform_settings`)**, never hard-coded; report them.

## 0.2 Verified platform facts (local GoTrue v2.197.0; pinned by `tests/e2e/mfa-api-behavior.spec.ts`)

`aal` JWT claim; aal2 needed to unenroll/add a factor and to change email/password; first verified factor revokes other sessions; TOTP replay inside 30 s is accepted; no server-side guess limit (we add ours); admin-API factor deletion does not revoke sessions; removing all factors leaves password-only. Do not rely on anything beyond these without re-verifying.

## 0.3 Engineering rules learned in Batch 1

- **Architecture is unchanged and approved:** Next.js App Router + React + TypeScript (strict) + Tailwind PWA; Supabase Postgres/Auth/RLS (+ Realtime/Storage when needed); modular monolith; critical atomic rules in hardened PostgreSQL functions; orchestration/presentation in the server app; Paystack test mode/mocks only; local-first. Redesign only for a verified blocker (report it and wait).
- **The browser never talks to Supabase.** All data access is server-side with the user's cookie session (RLS applies); the service-role client is used only for audited helpers. No `NEXT_PUBLIC_` variables (a test enforces it). Keep this.
- **Every protected route prefix must be in `ROUTE_POLICIES`** (`src/server/modules/identity-and-access/policy.ts`) and have a layout calling `enforceRoutePolicy(prefix)`; the guard-coverage test fails otherwise. Server actions re-check with `checkAccess`.
- **Do not add `loading.tsx` (or any Suspense boundary) above a layout that calls `forbidden()`/`notFound()`**: streaming starts first and the status becomes 200. If loading UI is needed, put it below the guard and keep the e2e 403/404 status tests.
- **Every account has the default `customer` role** (trigger). Vendors/riders/admins are additional roles. Privileged = any non-customer role ⇒ aal2 for any protected access, in app and DB.
- **Database rules:** every table RLS-enabled with explicit policies; `RESTRICTIVE` policy requiring `app_private.mfa_satisfied()` on every table exposed to `authenticated`; `anon` gets nothing; `authenticated` gets no INSERT/UPDATE/DELETE on sensitive tables (write via functions); every `SECURITY DEFINER` function has a fixed `search_path`, EXECUTE revoked from PUBLIC/anon, identity + role + aal validated inside, allowed **and** denied tests, concurrency tests where atomicity matters. `tests/db/schema-hygiene.test.ts` asserts these from the catalog; extend, never loosen it. When a new table is added, the test that every exposed table has a restrictive policy must still pass. Money is integer kobo (`bigint`); never floats.
- **Test hygiene (these cost hours):** when a UI action is a server action, wait for the POST response and the form reset before the next step (`submitCode`, `uiSignInAttempt` helpers); never navigate immediately after a click; React 19 resets forms after actions; use scoped locators (`main [role="alert"]`) because Next adds a hidden route announcer with `role="alert"`; `pg` returns custom-enum arrays as strings, so cast to `text[]`; use `exact: true` for ambiguous text; tests that depend on TOTP use `freshCode()`.
- **Local stack in this cloud sandbox:** the Docker daemon must be started (`pnpm db:start` does it); images come from Docker Hub via `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` (ECR anonymous pulls are rate-limited); the CLI's mail catcher image is unavailable, so `scripts/mail-sink.mjs` + `scripts/mail-forwarder.sh` provide email (re-run the forwarder after anything that recreates the Auth container; `pnpm db:reset` does). If the stack cannot run: **STOP and report BLOCKED. Never switch to a remote database or paid service.**
- **Version pins:** TypeScript 5.9.3 and ESLint 9 (newer majors exist; see ADR). Next 16 uses `proxy.ts`, async `cookies()/headers()`, `forbidden()` (experimental).
- **Prettier is enforced** (`pnpm format:check`); run `pnpm format` before committing.
- **Stubs to replace** (keep tests green by migrating them): `vendors`, `vendor_staff`, `rider_profiles` (extend `vendors`/`vendor_staff` in this batch; `rider_profiles` stays for Batch 4), `stub_order_placements` (replace with real orders and update its tests), `stub_capacity_slots` (keep until Batch 4). Mock pages in `src/mocks` and the sample vendor/product pages must be replaced by real data in this batch; remove the "sample data" notes where data becomes real.
- **Open technical debt to address in this batch:** add DB tests and e2e to CI (a job that starts the local stack with the same registry/mail workarounds or a documented equivalent; if impossible on GitHub-hosted runners, document why and keep the local gate); propagate the request ID into log lines; add a purge job design note for rate-limit events.
- **Security limitations accepted for now** (`docs/security-privacy.md` §4): do not widen them.

## 0.4 Constraints that never change

Local-first only. No deployment, production data, real messages, payments, refunds or payouts, live rider tracking, or real AFIT locations. **Synthetic data only; delivery points are fictional placeholders** (never real campus coordinates or names). Paystack/real payments are **not** introduced in this batch ("mock payment only"). Settlement stays DISABLED (code-locked); never call anything escrow. No secrets committed or printed. No integration-middleware platforms. No paid services. Do not remove or weaken any handoff requirement (`docs/handoff/` stays unmodified). Keep README, ADR, requirements checklist, security notes, review log, known issues and external approvals current, using the status vocabulary Planned / Implemented / Tested / Unverified.

---

# PART 1 — PRE-WORK (before code)

1. Inspect the repository and `docs/`; confirm the branch and whether the repo was renamed.
2. Verify the toolchain and the local stack (`pnpm db:start`); run the existing full suite once to establish the baseline (lint, typecheck, unit, db, e2e, build, secrets). Record numbers. A red baseline is a blocker to report, not to paper over.
3. Check current package versions and Supabase APIs you plan to use (e.g. Storage for product images, if used; full-text search options in Postgres). Record findings in `docs/review-log.md`.
4. Resolve what can be verified locally; stop and report anything needing an owner decision.

---

# PART 2 — PHASE 3: VENDOR ONBOARDING AND CATALOGUE

Goal: an approved vendor can manage a catalogue; an unapproved vendor cannot sell.

- **Vendor application flow (customer → vendor):** a signed-in registered customer (aal2) submits a vendor application (business name, contact, category, pickup location text, hours, policy acknowledgements). Status `pending → approved | rejected | suspended`. Platform admin reviews in `/admin/applications` (replace the sample page with real data; approve/reject/suspend with a reason). On approval a function creates the vendor/store and grants `vendor_owner` to the applicant via the existing audited path. Applicants cannot approve themselves; admins at aal1 cannot approve; everything audited.
- **Vendor staff:** owner can invite/add staff (`vendor_staff`, role `vendor_staff`) — by existing account email lookup through a server function that does not reveal whether an arbitrary email exists; staff get limited permissions (orders/products, not payout settings).
- **Stores and hours:** store profile, opening hours (weekly schedule + temporary closed flag), preparation-time estimate, pickup point text. Public "open now" is computed server-side in a fixed timezone (Africa/Lagos) from the schedule.
- **Catalogue:** categories (admin-managed list), products, variants/options and add-ons (price deltas in kobo), stock/availability (in-stock flag and optional quantity), images (private/public Storage decision documented; if Storage is used, restrict upload type/size and test access rules; if not, defer images and say so). Product name/price snapshots are copied into order lines in Phase 4.
- **Vendor dashboard:** replace sample screens (`/vendor`, `/vendor/catalogue`) with real catalogue management (create/edit/archive product, toggle availability, edit hours). `/vendor/orders` and `/vendor/handover` remain preview/non-functional (Batch 3) and stay labelled.
- **Synthetic seed:** at least 3 vendors with realistic fictional products and hours via an idempotent seed script (local only; no real brand or AFIT names).
- **Exit criteria:** approved vendor can manage the catalogue; vendor A cannot read or change vendor B's data (tests); unapproved/suspended/pending vendors do not appear publicly and cannot sell; suspending a vendor hides its catalogue immediately.

Database requirements (migrations only; explicit): `vendor_applications`, `vendors` (extend stub: status, slug, contact, timestamps), `vendor_staff`, `stores` (or merge into vendors if one store per vendor — document the choice), `store_hours`, `categories`, `products`, `product_option_groups`, `product_options`, `stock` fields, indexes on FKs and filters, check constraints (non-negative prices, valid hours), RLS + restrictive aal2 policy for privileged access, public read policy limited to approved+open-for-sale vendors and available products (decide whether public browse reads via a server-side function or an `anon`-safe view; keep the rule "anon can read nothing from base tables" unless you deliberately add narrowly scoped read policies — if you do, extend and justify the schema-hygiene test). Writes only through hardened functions (create/update/archive product, set availability, approve application) with allowed/denied tests.

---

# PART 3 — PHASE 4: CUSTOMER BROWSING, CART AND CHECKOUT PREPARATION

Goal: checkout calculations and order creation are correct and tested; payment is MOCK ONLY.

- **Browsing:** home with search, categories, open-now badge, availability; vendor page; product page with options/add-ons; filters (category, open now, price) and text search (Postgres full-text or `ilike` — choose, justify, index). Public (no account) browsing of approved vendors/products with real data. Pagination or bounded lists.
- **Cart:** persistent server-side cart per signed-in user (and a safe anonymous/session cart that merges on sign-in — decide and document; if anonymous carts are skipped, say so). **One vendor per order**: adding an item from another vendor prompts to replace/keep. Quantity limits; unavailable items flagged; price shown is informational — the server recomputes everything at checkout.
- **Checkout preparation:** choose **Pickup** or **Delivery**. Delivery requires choosing from admin-managed **approved delivery points** (fictional placeholders; table `approved_delivery_points` with `is_active`, `label`, optional `instructions` free text that never overrides the point; NO coordinates are required in this batch and none may be real). Show the fee breakdown: items, delivery fee (placeholder formula from `platform_settings`), platform fee (placeholder), discounts (none yet), total, all in kobo. Pickup shows the vendor pickup point text and prep estimate.
- **Order creation before payment:** a hardened function `create_order(cart…)` in one transaction that: validates the caller is a registered customer at **aal2**, the vendor is approved and open, every product is available and in stock, quantities valid, delivery point active (delivery only); recomputes all prices from the database (never trusts client amounts); snapshots product names, option names and unit prices into immutable `order_items`; stores the fee breakdown; sets status `PENDING_PAYMENT`; writes `order_status_history` (append-only) and an audit event; decrements/reserves stock safely (state your reservation policy and release rule for unpaid orders — e.g., expiry job — and test the race of two customers buying the last unit). Idempotent via a client-supplied idempotency key (duplicate submissions return the same order). Do **not** implement the full state machine or vendor transitions (Batch 3); only the order-creation path and `PENDING_PAYMENT`, plus cancellation of unpaid orders by the customer or expiry.
- **Mock payment:** a clearly labelled "Test payment (no real money)" action that marks the order `PAID` **only in local/test mode** via a server function guarded by an environment flag that cannot be enabled in production builds (fail closed). It must write a mock `payment_attempts`-style record so Batch 3 can replace it with Paystack test mode. Never describe it as real payment.
- **Customer screens:** replace sample `/orders` with real orders (list, detail with timeline using the status vocabulary, totals), a cart page, checkout page, order confirmation. Receipts/PDF are Batch 3.
- **Exit criteria:** checkout calculation tests pass (items, options, fees, rounding, large values, zero/negative rejection); order creation tests pass (tamper attempts: client-supplied prices ignored, another vendor's product, unavailable item, inactive delivery point, aal1 customer, duplicate idempotency key, two customers racing for the last unit); browsing works without an account; customer cannot read others' orders (RLS tests); vendor can see only its own orders (read-only; no actions yet).

Database requirements: `carts`, `cart_items`, `approved_delivery_points`, `orders`, `order_items` (immutable price snapshot), `order_status_history` (append-only), `payment_attempts` (mock marker; unique idempotency), fee configuration in `platform_settings`, indexes, constraints (totals = sum of lines + fees, enforced by a check or by the function and verified by tests), RLS (customer: own; vendor members: own vendor's orders read-only; admins/support: read at aal2), restrictive aal2 policy on all tables, append-only triggers where stated, hardened functions with allowed/denied/concurrency tests. Replace `stub_order_placements` and update its tests (keep the same protections).

---

# PART 4 — SECURITY REQUIREMENTS (both phases)

Server-side authorization on every action; RLS on every table; aal2 for registered customers placing orders and for all privileged roles; no client-trusted price/role/status; strict input validation (zod) and length limits; no PII or secrets in logs; rate limits on application submission, cart/checkout mutation and search; audited admin actions (approval/suspension reasons); suspended vendors lose access immediately (test sessions that already exist); IDOR tests for carts, orders, applications, products; file upload (if any) limited by type/size and stored privately unless intentionally public; synthetic data only.

---

# PART 5 — ACCEPTANCE CRITERIA AND TESTING

1. Baseline and final: `pnpm install && pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm test:db && pnpm build && pnpm check:secrets` and `pnpm exec playwright test` all pass from a clean checkout with the local stack; DB lint clean.
2. All Part 2 and Part 3 exit criteria met with executed evidence.
3. New DB tests (allowed **and** denied, per role at aal1/aal2): vendor application lifecycle and authorization; admin-only approval; vendor/store/product isolation (A vs B); staff limits; public visibility rules; suspended/pending vendors hidden; checkout calculation property tests (unit); `create_order` tamper/race/idempotency tests with parallel connections; customer/vendor/admin read rules for orders; append-only history; no new function executable by PUBLIC/anon; catalog hygiene test still green.
4. New e2e (mobile 360 + desktop): vendor applies → admin approves (with real MFA) → vendor creates products → public customer browses → customer adds to cart, changes vendor (prompt), checks out (pickup and delivery) → mock-paid order visible to customer and to the vendor (read-only); wrong-role 403 matrix extended; axe + no horizontal scroll on every new page; search/filter works; empty/error/offline states for new pages.
5. Manual verification list (what cannot be automated), with steps.
6. Documentation updated (README status table, ADR, requirements checklist, database docs, security notes, known issues, review log, external approvals).

---

# PART 6 — REQUIRED REPORT

Finish with the full A–O report: executive summary; requirements coverage (implemented+verified / implemented not verified / partial / not implemented / blocked); files changed (incl. migrations); frontend review; backend & database review; security review; test report (exact commands, results, counts, failures, fixes); successes with evidence; failures/incomplete; technical debt; costs and dependencies; decisions/assumptions needing approval; manual verification; completion status (COMPLETE / CONDITIONALLY COMPLETE / INCOMPLETE / BLOCKED) with justification; the complete self-contained prompt for **Batch 3 (Phases 5 + 6)** with any corrections discovered in Batch 2 **at its beginning**; and an **INDEPENDENT REVIEW PACKAGE FOR CHATGPT** (report, changed files, test results, decisions, defects, security-critical diffs, migration/RLS summaries, next prompt). Self-review the diff as an independent engineer first and fix in-scope defects. Do not claim the owner or ChatGPT reviewed anything until evidence has been submitted and reviewed.

# PART 7 — STOP CONDITIONS

Stop and report (do not bypass) if: the local stack cannot run; a security-critical requirement cannot be implemented safely; an owner decision in 0.1 blocks the work; a verified technical blocker requires an architecture change (propose, wait); any step would need a remote database, paid service, real credential, deployment, real payment, live tracking, or real AFIT location data. Do not begin Phase 5 or later. **Stop after Batch 2 and wait for the owner's explicit approval before Batch 3.**
