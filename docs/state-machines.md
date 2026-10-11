# State machines (permitted transitions)

All order transitions go through `app_private.step_order(order, from, to, actor, reason)`, a conditional update (`where status = from`) that also writes `order_status_history`. Users cannot call it. `try_step_order` moves an order only if it is currently in one of the expected states.

## Order (delivery)

`PENDING_PAYMENT -> PAID -> (VENDOR_REVIEW) -> ACCEPTED -> PREPARING -> READY/AWAITING_RIDER -> RIDER_ASSIGNED -> PICKED_UP_BY_RIDER -> EN_ROUTE -> ARRIVAL_DETECTED -> AWAITING_RECIPIENT_PROOF -> DELIVERED -> COMPLETED`

- `EN_ROUTE -> ARRIVAL_DETECTED`: server only, from a fresh accurate fix inside the geofence (`rider_post_location`).
- `ARRIVAL_DETECTED -> AWAITING_RECIPIENT_PROOF`: the customer starts the confirmation (`delivery_proof_begin`).
- `AWAITING_RECIPIENT_PROOF -> DELIVERED -> COMPLETED`: only inside `complete_delivery` (drawn signature + live proof token).
- `PICKED_UP_BY_RIDER | EN_ROUTE | ARRIVAL_DETECTED | AWAITING_RECIPIENT_PROOF -> DISPUTED`: only `ops_handle_delivery_exception` (support).
  Pickup orders: `... -> PICKUP_AWAITING_HANDOVER -> COMPLETED` (`complete_pickup`).

## Order after completion

`COMPLETED | DELIVERED -> DISPUTED` (a case is opened) `-> COMPLETED` (case closed, if nothing else moved it); `-> RETURN_REQUESTED -> RETURN_IN_PROGRESS -> RETURNED_TO_VENDOR` (return flow; a rejected request restores the prior state); `-> PARTIALLY_REFUNDED | REFUNDED` (a refund succeeded; `REFUNDED` when the refunded total reaches the received total). A cancelled paid order keeps `CANCELLED` whatever happens to its refunds.

## Rider assignment

`accepted -> picked_up -> en_route -> completed` (recipient completion) · `accepted -> released` (rider/ops) · `picked_up | en_route -> released` (support exception only). `accepted | picked_up | en_route` are the active statuses (capacity five per rider, one per order).

## Delivery proof session

`live -> used` (completion) · `live -> invalidated` (restart, release) · expired by clock · locked after 5 wrong tries.

## Refund

`requested -> under_review -> approved -> processing -> succeeded | failed | reconciliation_required` and `requested | under_review -> rejected`; `reconciliation_required -> succeeded | failed` (finance). Enforced by trigger `refunds_state_guard`; amount, order and requester never change. Active (counting against the cap): requested, under_review, approved, processing, succeeded, reconciliation_required.

## Return

`requested -> approved | rejected`; `approved -> received_by_vendor -> closed`. Enforced by trigger `return_state_guard`.

## Support case

`open -> under_review -> decided -> closed`. `case_decide` is the only writer of a decision.
