# Commission, settlement and rider-payment analysis (RESOLVED 2026-10-15: see `docs/financial-model.md`)

> **Update 2026-10-15:** the owner resolved the conflict described below: no customer platform fee; a 4.5% vendor commission (3% AFIT allocation + 1.5% Paystack-cost budgeting allowance, not a verified tariff). It is implemented; this file is kept as the history of the conflict. **Rider payment is also decided (§5): riders use AFIT Market free of charge with no rider commission, and a delivery fee not collected through Paystack is paid by the customer directly to the rider by bank transfer.**

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

## 5. Rider payment: current arrangement (owner-decided; implemented in the Final Implementation Completion stage)

### 5.1 Current arrangement

- **Riders use AFIT Market free of charge.** No rider commission exists. The rider dashboard says "Rider earnings: Free of charge." and "Delivery commission features: Coming Soon". **No future commission rate or date has been decided or is implied.**
- **Checkout is unchanged**: customers pay through Paystack (test mode only; no live use). The vendor commission and settlement (§1–§4, `docs/financial-model.md`) are unchanged and exclude delivery.
- **Direct bank transfer, only when the fee was not collected through Paystack.** An order carries an explicit, immutable marker (`delivery_fee_collection`). Every existing and new order is `paystack` by default. Only an order explicitly marked `direct_to_rider`, whose payable total excludes the delivery fee, can ask the customer to pay the rider. If the records are inconsistent (for example money received exceeds the payable total, or no fee is recorded) the order is treated as **ambiguous: the customer is not asked to pay** and an administrator sees it. No current checkout creates `direct_to_rider` orders; the capability is dormant until an owner-approved checkout mode sets the marker.
- **Process**: the rider keeps bank details (secure, never public); when a payment is opened the customer sees a **snapshot** of them, so later edits never redirect an existing order. The customer reports the transfer; the **rider independently confirms or disputes**; only then is one official digital receipt issued (unique number, QR/verification link). A dispute is never silently overwritten: only a platform or finance administrator can resolve it, with a written reason, and every step is audited. A receipt can be voided (reason recorded) but is never deleted.
- **What is NOT verified**: AFIT Market has **no independent bank-verification provider** (none has been approved), cannot see a personal bank account, and **does not move, hold or pay out any money for riders**. "Confirmed by both" means two parties' statements, not bank verification; the public receipt page says this explicitly.
- **No real rider transfers or payouts exist.** No live Paystack use occurred or is authorised.

### 5.2 Historical options R1–R4 (superseded; kept for the record)

These were the options put to the owner before the decision above. **They are not the current arrangement and none is implemented.**

| Option                                | Description                                                                               | Why not current                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| R1: flat share of the delivery fee    | Rider earns a fixed percentage of the customer-paid delivery fee; platform keeps the rest | Not chosen: no rider commission or fee share         |
| R2: fixed amount per delivery         | Fixed kobo per completed delivery                                                         | Not chosen                                           |
| R3: zone or distance tiers            | Amount by approved zone                                                                   | Not chosen                                           |
| R4: platform keeps fee, pays by shift | Flagged as raising worker-classification questions                                        | Not chosen; classification advice still not obtained |

Payout minimums and provider-fee questions belonged to a platform-pays-riders model. Because the platform does not pay riders, **they are not active settings or open design items.**

### 5.3 Genuinely unresolved matters

1. **Cancellation and failed-delivery handling**: whether and how a delivery fee is owed (or returned) when an order is cancelled, refused or fails after pickup.
2. **Tips**: not supported; no rule decided.
3. **Dispute resolution and escalation**: who decides, what evidence is considered, time limits, and what happens to repeat disputes. Today a platform/finance administrator records a written decision; no policy defines the standard of proof.
4. **Evidence requirements**: optional private evidence upload is **not built** (no private file storage exists yet). Any future evidence would be supporting only and never auto-verify a payment.
5. **Ambiguous or disputed transfers**: the process for contacting parties, how long to wait, and what to do when records are ambiguous is operational, not defined.
6. **Legal and contractual rider relationship**: classification, the rider agreement (a draft only), tax and consumer-law treatment of a customer paying a rider's personal account, and any duty to the customer when a rider's account details are wrong. Needs qualified Nigerian legal advice.
7. **When a `direct_to_rider` checkout mode will be offered**, if ever: the marker exists but no approved flow sets it.

## 6. Paystack test-mode status

The existing tests exercise a **local fake Paystack** (`pnpm dev:paystack`, `scripts/fake-paystack.mjs`): signature verification, duplicate webhooks, amount/currency checks, idempotency, expiry, failure and refund reconciliation are covered by DB and e2e tests. **The real Paystack API (even in test mode) has not been contacted in this stage**, no test key was provided, and none was requested. Real test-mode verification remains an external prerequisite (K19, K29, K30); a successful test-mode payment would not prove production merchant onboarding or any split-payment arrangement.
