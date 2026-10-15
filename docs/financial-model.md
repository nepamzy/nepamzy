# Financial model (as implemented, 2026-10-15)

Owner-approved model (stated in Master Prompt 2): **the customer pays no platform fee; AFIT Market earns a 4.5% vendor commission** on eligible product sales. Everything below is implemented in `supabase/migrations/20261018000001_vendor_commission_settlement.sql` and tested in `tests/db/settlement.test.ts`. **Real payments and payouts are not enabled and were not tested.**

## 1. What the customer pays

`total = items - product discount + delivery fee`. There is **no** service or platform fee. `orders.platform_fee_kobo` still exists as a column so historical orders keep their stored totals (they are not rewritten), but every new order stores `0`: `app_private.platform_fee()` now always returns 0, the setting `platform_fee_bps` is pinned to 0 (allowed range 0 to 0), the checkout form, cart text, order page and PDF receipt no longer show a service fee row (an older order with a stored fee shows a line labelled "charged on earlier orders; no longer applied"). The Paystack amount comes from `orders.total_kobo`, so the charged amount no longer includes a fee. Pickup orders still carry a delivery fee of 0 (database check).

## 2. The commission

| Item                                  | Rule                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base                                  | `items_total_kobo - discount_kobo` of the order (product sales after product discounts). Delivery is excluded.                                                                                                                                                         |
| Vendor commission                     | 4.5% = 450 bps (`vendor_commission_bps`)                                                                                                                                                                                                                               |
| AFIT Market allocation                | 3.0% = 300 bps (`commission_afit_bps`)                                                                                                                                                                                                                                 |
| Paystack-cost **budgeting allowance** | the rest of the commission, 1.5% (`commission_bps - afit_bps`). **It is an internal budget, not a verified Paystack tariff.** AFIT Market pays the actual Paystack charges; nothing here records them.                                                                 |
| Rounding                              | one rule: **half up to the kobo**, integer arithmetic only (`app_private.round_bps = (amount * bps + 5000) / 10000`). The AFIT allocation is rounded the same way and the Paystack allowance is the remainder, so allocation + allowance always equals the commission. |
| Example                               | Sales ₦5,000 (500000 kobo): commission 22500, AFIT 15000, Paystack budget 7500, vendor amount before other adjustments 477500.                                                                                                                                         |

## 3. Authoritative records (append-only)

- `order_settlement_lines`: **one per order** (`unique(order_id)`), created in the same transaction that records the order as `COMPLETED` (trigger on `order_status_history`). Stores the base, the rates **copied at that moment** (later rate changes never recalculate it), the commission, AFIT allocation, Paystack budget and the delivery fee (informational). Database checks keep `commission = afit + paystack` and `commission <= base`.
- `order_settlement_adjustments`: **one per succeeded refund** (`unique(refund_id)`), created by a trigger when a refund reaches `succeeded`. Records the product value reversed and the commission, AFIT and Paystack-budget amounts reversed, with a reason.
- Both tables are immutable (update/delete/truncate denied), readable only through the functions below, and have restrictive aal2 row-level security with no direct grants to app roles.
- Historical completed orders get **no** retroactive lines.

## 4. Refunds

Reversal uses cumulative rounding: after each refund the remaining commission equals `round_half_up(remaining base x rate)`, so partial refunds never drift and refunding everything reverses exactly the whole commission. Item refunds reverse the product value of those items (price x quantity less its share of any discount). A refund with no item breakdown (whole-order, or an amount-only finance refund) is applied to **product sales first**; only the part that falls on product value reverses commission (delivery is never in the base). A refund can never reverse more product value than was counted. **Idempotency:** `unique(refund_id)` plus an existence check make retries and duplicate outcome events harmless; the existing refund controls (cap at money received, requester cannot approve, locks) are unchanged.

## 5. What each role sees

- **Vendor** (`/vendor/earnings`, function `vendor_settlement_summary`, shop members at aal2 only; another shop, customers, staff without the shop, aal1 and anonymous are refused): completed orders (finalised), product sales, commission, refunded value, commission returned, **calculated amount due**, delivery fees (not part of it), a **pending estimate** for paid but not completed orders at the current rate, and recent orders with per-order explanations. It says plainly that nothing has been paid out.
- **Finance and platform administrators** (`/admin/settlements`, `admin_settlement_overview`): totals and per-vendor figures, AFIT allocation and Paystack budget separately. Support and everyone else are refused.
- **Vendor applicants** see the commission rate (read from the same setting) before they accept the terms.

## 6. What is simulated or not built

Payouts: **none** (`settlement_policy` stays code-locked to `DISABLED`; the dashboard shows "not enabled"). The distinct states "approved", "paid", "failed" and "reversed" payout do not exist yet, by design. Rider earnings: **not modelled** (the payment formula is an open owner decision). Refunds execute only against the local FAKE provider. Paystack has only ever run against the local fake.

## 7. Needs approval before real money moves

Counsel and Paystack confirmation of the funds flow (whether AFIT Market may hold funds, split payments, settlement timing); a payout design (approval, payment and failure states); who bears provider fees on refunds; rider payment policy; tax treatment.
