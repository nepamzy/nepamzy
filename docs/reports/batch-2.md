# Batch 2 Completion Report — Phases 3 and 4

_Written by the implementing engineer (Claude). Nothing here has been reviewed by ChatGPT or the owner._

## A. Executive summary

Batch 2 delivers vendor onboarding and catalogue (Phase 3) and customer browsing, cart, checkout and order creation before payment with a **mock** payment (Phase 4), on the approved architecture. Rules that must be atomic or secure live in hardened PostgreSQL functions with RLS; the app is server-only against Supabase. All suites pass locally: lint, typecheck, format, build, secret scan, 107 unit, 97 DB, 126 e2e (63 tests × mobile-360 and desktop), `supabase db lint` clean. DB/e2e are not in CI (K23). Phase 5 was not started.

## B. Requirements coverage

- **Implemented and verified:** vendor application/approval/suspension; shop profile, hours, closure; catalogue with option groups, stock, availability, archive; public browse/search/filter; cart rules; checkout (pickup/delivery); `create_order` (idempotent, recomputed prices, immutable snapshots, stock reservation, race-safe); unpaid cancel/expiry function; mock payment (local only); customer order list/detail with timeline; vendor read-only order list; admin applications/vendors/delivery points/categories.
- **Implemented, not verified beyond automation:** manual accessibility (screen reader/zoom), real devices.
- **Partial:** `expire_unpaid_orders` is tested but unscheduled (K18). One shop per owner in UI (K20).
- **Not implemented (by scope):** Paystack, order state transitions, handover, riders, product images, anonymous carts, MFA recovery (owner gate).

## C. Files changed

79 files, ~8,000 lines (`git diff --stat 4634af0~1 HEAD`). Migrations: `supabase/migrations/20261011000001_vendors_catalogue.sql`, `…000002_cart_orders.sql`; `supabase/seed.sql` (local-only demo data). App modules: `src/server/modules/{vendors-and-catalogue,cart-and-checkout,orders-and-state-machine,shared}`; routes under `src/app/{(public),cart,checkout,orders,apply,vendor,admin}`; components `src/components/{domain,forms,shells}`; policy table extended. Tests: `tests/db/*`, `tests/e2e/marketplace.spec.ts` and updated specs, unit tests. `src/mocks` removed.

## D. Frontend review

Mobile-first, 360px checked by automated no-horizontal-scroll + axe on every new page (customer, vendor, admin shells and public routes). Clear blocked-checkout messages (closed, sold out, unavailable). Test-payment button is labelled "no real money" and absent in production mode (e2e proves it). Gaps: no images, no manual screen-reader pass.

## E. Backend and database review

See `docs/database.md` (Batch 2 section). Highlights: money in integer kobo; platform fee half-up rounding; settings in `platform_settings` (placeholders); `create_order` locks cart then products in id order; unique (customer, idempotency key); `order_items` immutable, `order_status_history` and `payment_attempts` append-only; anon sees only the five public read functions (hygiene test pins the allowlist); `SECURITY DEFINER` functions have fixed `search_path`, revoked PUBLIC/anon, identity/role/aal checks. `supabase db lint` flagged one STABLE/PERFORM function; fixed.

## F. Security review

Controls: server-side pricing; RESTRICTIVE aal2 policies on orders/carts; no client-supplied amounts; service-role used for expiry only; mock payment needs `APP_ENV=local` AND DB flag (flag unsettable via `set_platform_setting`; seed sets it locally only); vendor-staff checks inside every vendor function; uniform non-oracle response on staff add; admin cannot approve own application. Residual: S1–S8 and K15; mock flag depends on deployment hygiene (production seed must not be run — documented); rate limiting of cart/checkout actions relies on existing auth limiter only (not added).

## G. Test report (final run on committed code, local stack)

| Command                                              | Result               |
| ---------------------------------------------------- | -------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | pass                 |
| `pnpm test`                                          | 107 passed           |
| `pnpm test:db` (after `pnpm db:reset`)               | 97 passed            |
| `pnpm build` / `pnpm check:secrets`                  | pass                 |
| `pnpm exec supabase db lint --local`                 | No schema errors     |
| `pnpm exec playwright test`                          | 126 passed (4.9 min) |

Mutation check: removing the product row lock made the last-unit concurrency test fail; restored. Earlier failures fixed along the way are listed in `docs/review-log.md`.

## H. What worked

Full journey e2e: apply → admin approve → hours/catalogue → anonymous browse → login redirect → cart → MFA enrol → totals (₦3,780 pickup / ₦4,280 delivery) → order → test pay → vendor sees paid order and stock 1 → stranger gets 404 → suspension hides vendor. Race tests: 10 buyers/3 units never oversell; duplicate idempotent submissions yield one order; double-tap yields one order.

## I. Failed or incomplete

K18 (expiry unscheduled), K23 (no DB/e2e CI), K24 (request ID in logs), no images, no anonymous cart, no manual a11y/device checks. Rate-limit purge job still absent (K16).

## J. Technical debt

Experimental `forbidden()`; large migration files; seed is local demo data that must never run in production.

## K. Costs and dependencies

New: `pg_trgm` extension (built-in). No paid services, no remote calls.

## L. Decisions needing owner approval

1. Real pilot values: delivery fee, platform fee %, unpaid-order expiry, max quantity (placeholders now).
2. One store per vendor owner for the pilot?
3. Stock reserved at order creation and released on cancel/expiry — acceptable policy?
4. Anonymous (pre-login) carts: skip until later?
5. Carried over: MFA recovery, backup authenticator for privileged roles, forced TOTP at sign-up, default customer role, TOTP replay/lockout trade-offs, repo rename.

## M. Manual verification still needed

Screen reader and 200% zoom on cart/checkout/catalogue forms; real Android phone through the apply → order journey; confirm repository rename; confirm the production deployment will not run `seed.sql`.

## N. Completion assessment

**CONDITIONALLY COMPLETE.** Phase 3 and 4 exit criteria are met with executed evidence; conditions: K18, K23 and the owner decisions above.

## O. Next phase prompt

`docs/reports/batch-3-prompt.md` (Phases 5 + 6; Batch 2 corrections first).

---

# INDEPENDENT REVIEW PACKAGE FOR CHATGPT

_No review has taken place. This is evidence for the owner to submit._

1. **Report:** this file. 2. **Changed files:** `git diff --stat 4634af0~1 HEAD`. 3. **Tests:** §G (re-run locally with the listed commands). 4. **Decisions:** §L. 5. **Defects:** §I, `docs/known-issues.md` K18–K25.
2. **Security-critical code to inspect:** `create_order`, `cart_add_item`, `price_cart`, `mock_pay_order`, `decide_vendor_application`, `require_vendor_actor` in the two migrations; `mockPaymentsAllowed()` in `src/lib/env.ts`; `ROUTE_POLICIES`.
3. **Migration/RLS summary:** `docs/database.md`.
4. **Next prompt:** `docs/reports/batch-3-prompt.md`.

**Suggested review questions:** (1) Can any client input influence a price or fee? (2) Can two buyers oversell, or one request create two orders? (3) Can the mock payment be reached in a production build? (4) Can a suspended or foreign vendor read or write another shop's data? (5) Is the anon allowlist minimal? (6) Is stock-at-creation reservation with expiry sound? (7) Could any test pass while its control is broken?
