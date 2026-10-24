# ADR 0002 - Riders, capacity-five assignment and location (Batch 4)

Status: accepted for Batch 4 (implementation evidence in `docs/reports/batch-4.md`). Date: 2026-10-12.

## Context

Phases 7-8 add rider onboarding, shifts, the five-delivery cap, parcel handover from vendor to rider, and live location with server-side arrival. These are the highest-risk rules for privacy and for double-assignment, so they live in the database.

## Decisions

1. **Capacity and exclusivity have layered controls.** I1 (<= 5 active deliveries per rider): rider-row lock, plus `unique (rider_id, slot)` over slots 1..5. I2 (<= 1 active assignment per order): order-row lock, plus a partial unique index on active assignments, plus the conditional status update in `step_order`. The tests remove layers one at a time (barrier seam `app_private.test_seam`) to show which layer is the backstop and that the test detects the invariant being broken when all layers are gone.
2. **Rider actions never complete an order.** The assignment/location functions only move `AWAITING_RIDER -> RIDER_ASSIGNED -> PICKED_UP_BY_RIDER -> EN_ROUTE -> ARRIVAL_DETECTED`. `DELIVERED`/`COMPLETED` belong to Phase 9 (recipient code + signature).
3. **Arrival is inferred, never claimed.** `rider_post_location` has no arrival parameter. It marks `ARRIVAL_DETECTED` only for an `EN_ROUTE` order, from a fix that is fresh, accurate and inside the delivery point's geofence.
4. **No direct reads of location tables.** `rider_location_*` and `assignment_tokens` grant nothing to API roles. Customers use `get_order_tracking` (own order, in transit, rider on shift); staff use `staff_get_order_tracking` with a recorded purpose.
5. **The pickup-code secret is not in the database.** The server derives the code with `PICKUP_CODE_SECRET`; the database keeps a nonce and the hash.
6. **Handover token is random, hashed, assignment-bound.** One live token per assignment, expiring, locked after five wrong tries, invalidated when the assignment is released.
7. **Polling, not Realtime.** The customer map polls a protected route every 10 s. Realtime/Storage services cannot run in the build sandbox and their RLS isolation was not verified; polling keeps every read behind the same server checks.
8. **Maps and routing are adapters with fake/synthetic data.** No mapping service is approved or purchased; the sample map is an SVG labelled synthetic; ETAs are labelled approximations.
9. **Geolocation is allowed only under `/rider`.** `Permissions-Policy: geolocation=(self)` is served for `/rider*`; everywhere else it stays `geolocation=()`.

## Consequences

- Phase 9 must extend the "active" status list (a terminal assignment status frees the slot/order indexes).
- A real routing/map provider needs owner approval, a cost review and a privacy review (location is sent to the provider).
- Background tracking is unverified (see `docs/testing/android-background-location-test.md`).
