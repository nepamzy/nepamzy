# Delivery Proof, Pickup, Refunds, Returns and Disputes

## 1. Proof-of-handover policy
**Signature is mandatory** for successful pickup or delivery. Customer/recipient may also choose an optional QR or app-generated code. The QR/code is not a replacement for the signature in V1.

Do not rely on one signal alone:
- GPS proves approximate device location, not that goods were handed over.
- Signature proves a person made a signature action, not by itself that every item was correct.
- QR/code helps link the handover to the correct order/rider, but can be shared or coerced.
- Vendor/rider confirmation, timeline, item summary, recipient report and dispute evidence add context.

The server is the source of truth for state transitions and proof validation.

## 2. QR design
- Generate a cryptographically random, short-lived, one-time token per order/handover.
- Store only a token hash where practical; expire and invalidate after use, reassignment, cancellation or completion.
- Bind token to order ID, fulfillment type, assigned rider (for delivery), intended recipient/session where feasible, and token expiry.
- Never use a static vendor QR as proof of a specific delivery.
- A rider QR used for a handover must identify the rider/order assignment, but scanning it must not itself complete the order.
- Validate QR server-side and rate-limit attempts. Reject replay, expired tokens, wrong rider, wrong order and wrong fulfillment mode.
- Do not put personal data, access tokens or sensitive location details in QR payloads.

## 3. App-generated code vs SMS OTP
SMS OTP is not required for V1. Paid SMS would create recurring cost.
- Prefer an in-app, server-generated, short-lived code shown in the relevant authenticated order screen.
- Code is order-specific, single-use, rate-limited and bound to the correct actor/order.
- Avoid making the rider the only person who knows the recipient's verification secret. The recipient must independently confirm receipt in their own authenticated app where possible.
- If a rider displays a rider/order code and recipient enters it, treat it as confirmation that the handover is associated with that rider/order—not standalone proof that goods were received.
- Optional SMS delivery OTP can be considered later only after cost and threat review.

## 4. Delivery flow
1. Vendor accepts and prepares the order.
2. Order becomes `AWAITING_RIDER`.
3. Rider explicitly goes active. Location permission and sharing indicator are shown.
4. Rider accepts an available order only if their active accepted count remains below five. Server transaction prevents race conditions.
5. Assignment creates a unique order/rider binding and QR/code token.
6. Vendor confirms handover to the assigned rider using the order-specific in-app handover action/scan.
7. Rider's app automatically sends GPS updates while active and assigned. Server validates freshness/accuracy and estimates arrival using approved delivery point/geofence.
8. Customer sees location, distance and ETA. Location is shared only for the relevant active delivery.
9. At handover, recipient chooses optional QR or app-generated code if desired, then signs. The app displays the order summary before signature.
10. Server checks assigned rider, correct order, status, recipient authorization, signature presence, any selected QR/code, and reasonable location/timestamp evidence.
11. Server records proof and transitions order. Rider cannot manually set `DELIVERED`.
12. Generate a receipt and immutable audit event. Stop location sharing for that order.

## 5. Pickup flow with minimal vendor effort
1. Customer selects pickup and pays/places order.
2. Customer's order screen displays a one-time QR and/or short in-app pickup code.
3. Vendor has one universal **Confirm handover** screen, not a separate complicated workflow per order.
4. Vendor scans the QR or enters the code. The app resolves exactly one eligible order and displays order number, items and status.
5. Vendor taps **Confirm handover** after checking the correct package.
6. Recipient signs on their own device or a controlled shared screen.
7. Server validates the token, order state, vendor permission, signature and any selected additional proof.
8. Order completes and receipt is created. Expire the QR/code.

If the vendor's device cannot scan, short code entry is a fallback. Never allow a code to select or complete an arbitrary order without server validation.

## 6. Rider capacity: up to five active deliveries
- A rider may hold up to 5 active accepted deliveries.
- “Active” means accepted and not yet completed/cancelled/reassigned.
- Use a database transaction/locking or an equivalent atomic server-side operation so two simultaneous accepts cannot exceed capacity.
- Only accept orders already in `AWAITING_RIDER`.
- Show the rider the assigned jobs and an ordered route/sequence; provide updated ETAs.
- The system must prevent an unsafe or impossible batch, including incompatible pickup readiness, delivery windows, zone rules, or excessive detours. A hard cap of five is not a requirement to always fill all five.
- Each order retains its own rider binding, token, signature and proof record.
- Reassignment invalidates old rider tokens and creates new assignment-specific tokens.

## 7. What if nobody agrees about what happened?
Do not automatically assume either side is truthful. Do not automatically punish a party based on GPS alone.

Collect a neutral evidence bundle:
- Order contents and amount at checkout
- Payment provider transaction and webhook status
- Vendor accept/preparation/ready timestamps
- Vendor-to-rider handover event
- Rider assignment history
- Location points with timestamp and accuracy (minimize and retain only as policy requires)
- Arrival detection result and geofence used
- QR/code validation outcome (never store the plaintext secret)
- Signature asset and signature metadata, stored privately
- Recipient's order confirmation/report
- In-app messages and support notes
- Photos/evidence submitted voluntarily
- Previous related disputes only where lawful and necessary

Decision workflow:
1. Customer reports issue and chooses category.
2. Order/payment is flagged for review; preserve relevant evidence.
3. Vendor and rider may submit separate statements/evidence.
4. Support reviews timeline without changing original events.
5. Apply published policy: full refund, item-level partial refund, fee adjustment, replacement, return, or reject with reason.
6. Record decision maker, reason, amount, evidence references and timestamp.
7. Notify affected parties and allow escalation.

## 8. Partial refunds
Support:
- Full refund
- Partial refund for one or more selected missing/damaged/wrong items
- Applicable proportional delivery/service-fee adjustment if policy says the issue warrants it
- Replacement/re-delivery instead of or alongside a refund, where operationally possible

Calculation must be server-side and based on immutable order line prices, quantities, discounts and fee policy. Never let an admin enter an amount greater than the refundable balance. Prevent duplicate refunds with idempotency keys and provider reconciliation.

Example: three items cost ₦1,000, ₦1,500 and ₦500. If the ₦1,500 item is missing, the default item refund starts from ₦1,500, then applies relevant discounts/tax/fee rules consistently. Do not refund the whole order unless policy or facts justify it.

## 9. Return to vendor
Returns depend on the product category and hygiene/safety policy. Food cannot always be safely returned or resold.

Recommended workflow:
1. Customer reports wrong/damaged item promptly and adds photos where appropriate.
2. Support decides whether return is required, optional, or unsafe/unnecessary.
3. If required, create a `RETURN_REQUESTED` case and specify approved pickup/drop-off method.
4. For physical return, create a separate return task linked to the original order. Assign a rider only after vendor agrees and return handling is approved.
5. Rider collects the item from customer with a return-specific QR/code and handover record; do not mix return status with original delivery proof.
6. Rider returns it to the vendor's approved return point.
7. Vendor confirms receipt of returned item using a simple scan/code and records condition.
8. Support finalizes partial/full refund or replacement according to policy.
9. If return logistics cost exceeds item value, support may authorize a no-return refund.
10. Keep the original delivery proof immutable; add linked return events instead of rewriting history.

Never send a rider to collect food or goods without a clear return authorization and safe handling instructions.

## 10. Settlement caveat
A platform's internal “pending settlement” status is not legal escrow and does not mean funds are technically held. Confirm Paystack's supported marketplace/payout model and obtain appropriate Nigerian legal/payment advice before promising vendors that funds will only be released after every party confirms. Implement payment states so settlement policy can be changed without corrupting order records.
