# AFIT Market — Product Requirements

## 1. Product goal
Make buying and selling easy for the AFIT community through an approved campus marketplace with pickup or delivery, transparent order progress, controlled live tracking and reliable handover evidence.

## 2. Roles
- Buyer/recipient: students, teachers/lecturers, civilian staff, military personnel and other users approved by AFIT.
- Vendor: approved restaurant, shop, souvenir seller, printing provider or other permitted business.
- Vendor staff: limited permissions for orders/products.
- Rider: approved delivery worker.
- Support/dispute agent: reviews order issues with limited access.
- Finance administrator: payment reconciliation, refunds and settlement review.
- Platform administrator: account/vendor/rider moderation, configuration and audit review.

A user can hold multiple roles only after the required approval. Vendor/rider onboarding must be reviewed before activation.

## 3. Customer experience
- Mobile-first home page with search, categories, open-now status, product availability, ratings and realistic preparation/delivery estimates.
- Browse vendor, product options/add-ons, price and availability.
- Cart and checkout; begin with one vendor per order to simplify fulfillment and disputes.
- Choose **Pickup** or **Delivery**.
- Delivery destination must be an AFIT-approved delivery point/zone. Free-text instructions may clarify the final handover but must not override security restrictions.
- Show price breakdown before payment: items, delivery fee, platform fee if any, discounts and total.
- Show order timeline and useful notifications.
- Show live map, route distance and ETA only while delivery tracking is active and access is authorized.
- Recipient signs on successful handover. Optional QR or in-app code is offered without requiring paid SMS.
- Order receipt available after completion.
- Report missing/damaged/wrong items and view dispute/refund status.

## 4. Vendor experience
- Apply and remain pending until approved.
- Store profile, operating hours, menu/catalogue, variants, stock/availability, preparation estimates and order management.
- Accept/reject order with reason where permitted; mark preparation stages.
- For pickup: use a simple **Confirm handover** screen. Scan order QR or enter short code to resolve the exact order. Verify displayed item/order summary, then record vendor handover. Recipient signature remains mandatory.
- For delivery: confirm package is ready and confirm handover to the assigned rider using order-specific confirmation. Do not allow a vendor to hand a package to an unrelated rider.
- View sales/fees/payout status and refund/dispute requests appropriate to their role.

## 5. Rider experience
- Rider must tap **Go Active** before location collection starts. Clearly show “Location sharing ON” and a one-tap Go Inactive control when safe.
- Do not collect/store live location while off duty. If a rider has active deliveries, safely require handover/reassignment or a controlled pause before fully ending a shift.
- Show available eligible delivery offers and active jobs.
- Rider can accept a job only if fewer than five active accepted deliveries are assigned. Server enforces a hard maximum of 5.
- Rider sees assigned orders, vendor pickup point, approved delivery point, route sequence, distance and ETA.
- GPS is collected automatically by the device. No manual coordinates or manual “I have arrived” as the source of truth.
- Arrival is inferred server-side from geofence proximity plus GPS accuracy and freshness checks. Provide a fallback “GPS issue” workflow that creates a support flag, not a fake arrival.
- Rider can report a problem (vendor not ready, recipient unavailable, blocked route, safety/security restriction) with a reason.
- Rider cannot complete an order directly. Completion is triggered by valid handover evidence and server-side state machine.

## 6. Live tracking
- Start only after rider explicitly goes active and has an assigned accepted delivery that requires delivery.
- Share rider location only with the relevant customer/recipient and authorized operations staff.
- Stop sharing when the order is completed/cancelled/reassigned or no eligible active work remains.
- Use GPS accuracy and timestamps; mark location stale when updates stop.
- Use route distance, not just straight-line distance, for delivery distance/ETA when a supported routing service is available.
- Use only AFIT-approved zones/points. Do not map restricted areas without written approval.
- Use synthetic locations in development and staging.

## 7. Identity and 2FA
- Use established authentication, preferably Supabase Auth.
- 2FA is in V1. Prefer TOTP authenticator apps to avoid recurring SMS costs.
- Enforce MFA in backend and database access rules, not only in UI.
- Admin accounts must require MFA. Vendor/rider privileged accounts must require MFA. Document a proportionate policy for buyers and sensitive actions.
- Provide safe enrollment, recovery and account recovery procedures. No support agent should be able to silently bypass MFA.

## 8. Orders and states
Use an explicit server-side state machine. Proposed states:
`PENDING_PAYMENT`, `PAID`, `VENDOR_REVIEW`, `ACCEPTED`, `PREPARING`, `READY`, `AWAITING_RIDER`, `RIDER_ASSIGNED`, `PICKED_UP_BY_RIDER`, `EN_ROUTE`, `ARRIVAL_DETECTED`, `AWAITING_RECIPIENT_PROOF`, `DELIVERED`, `PICKUP_AWAITING_HANDOVER`, `COMPLETED`, `CANCELLED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`, `RETURN_REQUESTED`, `RETURN_IN_PROGRESS`, `RETURNED_TO_VENDOR`.

Not every state applies to every fulfillment type. Define allowed transitions and actors in code and tests. Never trust a status sent by the browser.

## 9. Notifications
- In-app notifications are core and should not cost per SMS.
- Email/push may be added based on selected providers and costs.
- SMS is optional for future critical alerts, not a requirement for delivery proof.
- Notifications should not reveal sensitive military or location details.

## 10. Accessibility and performance
- Responsive mobile-first UI, large touch targets, clear Nigerian naira formatting and simple wording.
- Handle poor connectivity, retry safe requests, prevent duplicate checkout/payment/refund operations.
- Make state visible in a persistent timeline.
- Support reduced motion and accessible signature controls.
