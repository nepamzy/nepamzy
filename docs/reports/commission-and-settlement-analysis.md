# Commission, settlement and rider-payment analysis (Gate D: STOPPED, conflict reported)

Prepared 2026-10-13 against HEAD `daee8a4`. **No financial behaviour was changed in this stage.** The owner confirmed a 5% vendor commission on the eligible product subtotal. Inspecting the existing accounting model shows that the request is **not ambiguous in intent but conflicts with what is already built**, so implementation was stopped as Master Prompt 1 Gate D requires.

## 1. What the code does today (verified in migrations and tests)

| Topic              | Current behaviour                                                                                                                                                                                                                                                                                      | Source                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| The "5%"           | `platform_fee_bps = 500` (placeholder, "pending owner decision"). It is a **customer-paid service fee added on top of the items total**: `total_kobo = items_total_kobo + delivery_fee_kobo + platform_fee_kobo - discount_kobo` (database check `orders_total_matches`). Rounded half up to the kobo. | `20261011000002_cart_orders.sql` (`app_private.platform_fee`, `orders` columns) |
| Delivery fee       | Flat `delivery_fee_kobo = 50000` (placeholder), separate column, charged to the customer; pickup orders have 0 (check constraint).                                                                                                                                                                     | same                                                                            |
| Money received     | `ledger_entries` hold only `payment_received` and `refund_paid`; one receipt per transaction (unique index); append-only.                                                                                                                                                                              | `20261012000001_payments_orders_handover.sql`                                   |
| Vendor proceeds    | **Not modelled.** No vendor payable, commission, payout or deduction record exists. `settlement_policy` is code-locked to `DISABLED`.                                                                                                                                                                  | same; K4                                                                        |
| Rider amount       | **Not modelled.** No rider earnings, payout or fee-allocation record exists.                                                                                                                                                                                                                           | riders migrations                                                               |
| Refund calculation | Item price x quantity less its share of any order discount; with `refund_fee_policy = proportional_service_fee` also a share of the customer-paid platform fee; delivery fee never refunded by default. Cumulative refunds capped at money received (`app_private.order_received`).                    | `20261014000003_refunds_returns_disputes.sql`                                   |
| Checkout display   | Shows items, delivery fee and the service fee separately.                                                                                                                                                                                                                                              | `checkout-form.tsx`, `cart-and-checkout/queries.ts`                             |

## 2. The conflict

The confirmed decision is a **vendor commission**: 5% of the eligible product subtotal, deducted from what the vendor receives, disclosed to the vendor, reversed in proportion to refunds. The existing 5% is a **customer service fee on top of the price**. They are two different financial contracts:

- Keeping the customer fee **and** adding a vendor commission would charge the platform twice on the same sale (customer pays +5%, vendor loses 5%).
- Re-labelling the customer fee as the vendor commission would change what customers pay (they would pay 5% less) and change the refund rules (the fee-share refund option).
- Neither can be done "silently": the order total, the receipt, the refund policy setting and the vendor disclosure all change.

## 3. Decisions the owner must make before this can be built

1. **Who bears the 5%?** (a) vendor only: set the customer service fee to 0 and add the vendor commission; (b) vendor commission and a customer fee both (state the customer fee rate explicitly); (c) keep the customer fee only (then it is not a vendor commission and the vendor agreement must not say so).
2. **Commission base:** items total before or after discounts? Who funds a discount (platform or vendor)? Recommended: base = items total minus discount actually deducted from the customer price.
3. **Eligibility:** commission applies only to orders that reach a completed state (delivered or collected). Cancelled, rejected and fully refunded orders carry none.
4. **Refunds:** commission reverses in proportion to the refunded item amounts (partial refunds reduce the base); a refund fee policy for any non-reversible fee.
5. **Payment-provider fees:** who bears Paystack's fee (vendor, platform, customer)? Not covered by the confirmed decisions.
6. **Settlement timing and method:** the whole payout side is locked (K4, owner decision 7). Needs Paystack and counsel confirmation (funds flow, split payments, whether the platform may hold funds).

## 4. Proposed design (NOT built; for owner approval)

Append-only table `order_settlement_lines` (one row per order, created once when the order reaches a completed state, `unique (order_id)`):

`order_id, vendor_id, commission_base_kobo, commission_rate_bps, commission_kobo, delivery_fee_kobo (informational, never in the base), created_at`, plus append-only `order_settlement_adjustments` (`order_id, refund_id, base_reversed_kobo, commission_reversed_kobo`, `unique (refund_id)`) written by the refund-success path. Vendor payable view = base - commission - adjustments. All in integer kobo; commission = `round_half_up(base * bps / 10000)` (same function as `app_private.platform_fee`); rate read from a platform setting and **copied into the line at creation** so later rate changes never re-price past orders. Idempotency from the two unique constraints; reconciliation test: for every order, `ledger received - refunds paid` equals `vendor payable + commission retained + delivery fee + provider fee (if modelled)`. Vendors see the base, rate, commission, adjustments and payable per order; the vendor agreement states the rate and base before acceptance.

Tests required when approved: rounding (including 1 kobo cases), deterministic repeat, duplicate-completion idempotency, partial and cumulative refunds never exceeding received, commission reversal proportionality, delivery fee excluded, concurrent completion/refund, authorization (vendors see only their own lines), and migration of existing orders (no retroactive lines unless the owner approves).

## 5. Rider payment: options for owner review (nothing invented)

No rider payment amount, timing or cancellation treatment is defined in the repository. Options:

| Option                                | Description                                                                               | Pros                                                     | Cons / risks                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| R1: flat share of the delivery fee    | Rider earns a fixed percentage of the customer-paid delivery fee; platform keeps the rest | Simple, matches "customers pay delivery through the app" | Percentage still to be chosen; low fees may under-reward long trips |
| R2: fixed amount per delivery         | Fixed kobo per completed delivery                                                         | Predictable for riders                                   | Platform bears the difference if the fee differs                    |
| R3: zone or distance tiers            | Amount by approved zone                                                                   | Fairer for variable distance                             | Needs approved zones (external prerequisite) and more configuration |
| R4: platform keeps fee, pays by shift | Not recommended before legal advice on classification                                     | n/a                                                      | Worker-classification implications                                  |

Also undecided: timing (per delivery, daily, weekly), cancellation and failed-delivery treatment, tips, who bears provider fees, minimum payout, dispute holds. A rider agreement must not classify riders (employee, contractor, agent) without qualified advice. **No real rider payments, transfers or live Paystack use occurred or are authorised.**

## 6. Paystack test-mode status

The existing tests exercise a **local fake Paystack** (`pnpm dev:paystack`, `scripts/fake-paystack.mjs`): signature verification, duplicate webhooks, amount/currency checks, idempotency, expiry, failure and refund reconciliation are covered by DB and e2e tests. **The real Paystack API (even in test mode) has not been contacted in this stage**, no test key was provided, and none was requested. Real test-mode verification remains an external prerequisite (K19, K29, K30); a successful test-mode payment would not prove production merchant onboarding or any split-payment arrangement.
