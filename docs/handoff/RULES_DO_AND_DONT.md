# AFIT Market — Rules, Do's and Don'ts

## Do
- Do inspect the repository and existing code before changes.
- Do use Supabase Postgres as the source database.
- Do keep business rules on trusted server-side code and enforce authorization in RLS.
- Do use server-side state transitions and immutable audit events.
- Do require 2FA in V1 for admins and privileged vendor/rider actions.
- Do prefer authenticator-app TOTP to avoid mandatory SMS cost.
- Do require a signature for every successful handover.
- Do offer QR/in-app code as optional extra verification, not a replacement for the signature.
- Do bind QR/code to one order and its current assigned rider/vendor context.
- Do make all tokens one-time, short-lived and resistant to replay.
- Do allow a rider up to five accepted active deliveries, with atomic server-side capacity enforcement.
- Do make rider location opt-in, visible, purpose-limited and automatically stopped when no longer needed.
- Do automatically detect arrival using fresh, accurate GPS plus approved geofence rules.
- Do stop treating GPS as proof that an item was physically handed over.
- Do support partial refunds for specific missing/damaged/wrong items as well as full refunds.
- Do keep original order and proof records immutable; append corrections and admin decisions.
- Do preserve neutral evidence for disputes and give parties a fair chance to respond.
- Do use private storage for signatures, identity documents and dispute evidence.
- Do use synthetic data and test credentials locally.
- Do test unhappy paths, race conditions, replay attempts, authorization failures and duplicate webhooks.
- Do document costs and external service dependencies before enabling them.
- Do stop after each phase and wait for approval.

## Don't
- Don't implement all phases in one run.
- Don't deploy or connect production services without explicit permission.
- Don't commit secrets or put service-role keys in frontend code.
- Don't trust browser-sent roles, payment status, order status, refund amounts or GPS arrival claims.
- Don't let a rider manually mark an order delivered.
- Don't allow a reusable/static QR to confirm a delivery.
- Don't make paid SMS OTP mandatory for the core product.
- Don't collect rider location before Go Active or while off duty.
- Don't expose all rider locations to all users or show location after the order ends.
- Don't invent AFIT building coordinates, restricted zones or security procedures.
- Don't use GPS alone to decide who is lying.
- Don't auto-refund/penalize someone solely because a location point is missing.
- Don't call the payment arrangement escrow unless properly structured and approved.
- Don't release or split real funds based on an unverified browser event.
- Don't create a wallet/stored-value system in V1 without compliance review.
- Don't let admins silently rewrite signature, order history or proof records.
- Don't retain every GPS ping indefinitely.
- Don't overbuild microservices or add paid services without a reason.
- Don't build peer-to-peer used-item classifieds in the first release; start with approved vendors.
- Don't treat examples of delivery points in planning documents as verified real campus locations.
