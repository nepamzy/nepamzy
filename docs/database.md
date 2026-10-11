# Database (Batch 1)

Migration: `supabase/migrations/20261010000001_core_identity.sql`. Reset from scratch with `pnpm db:reset`.

## Principles

RLS on every table. Privileged roles (anything except `customer`) must be aal2 for ANY table access via a RESTRICTIVE policy. API roles have no INSERT/DELETE anywhere and UPDATE only on `profiles.display_name`. Sensitive writes go through hardened SECURITY DEFINER functions (fixed `search_path`, EXECUTE restricted, identity + role + aal checked inside). Internal helpers live in `app_private` (not exposed by the Data API). A catalog test asserts these properties.

## Tables

| Table                                          | Purpose                                | Notes                                                                                                          |
| ---------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `profiles`                                     | one per user (trigger on `auth.users`) | user may update own `display_name` at aal2                                                                     |
| `role_assignments`                             | roles per user                         | active/revoked, unique active (user, role); read-only via API; every account gets `customer`                   |
| `audit_events`                                 | append-only trail                      | triggers reject UPDATE/DELETE/TRUNCATE for everyone; `actor_id` has no FK so history survives account deletion |
| `platform_settings`                            | config                                 | `settlement_policy` locked to `"DISABLED"` by function                                                         |
| `vendors`, `vendor_staff`, `rider_profiles`    | STUBS                                  | only to test ownership RLS; extended in Batches 2 and 4                                                        |
| `stub_order_placements`, `stub_capacity_slots` | STUBS                                  | test the customer aal2 rule and the parallel-claim harness; replaced later                                     |
| `app_private.rate_limit_events`                | rate limiting                          | service role only                                                                                              |

## Functions

Client-callable (authenticated): `my_roles()`, `grant_role()`, `revoke_role()`, `set_platform_setting()`, `stub_place_order()`, `stub_claim_slot()`.
Service-role only: `rate_limit_hit()`, `record_security_event()` (action whitelist `auth.*`/`mfa.*`).
Internal (not callable by API roles): `app_private.audit_write()`, trigger functions.
Helpers: `app_private.is_aal2()`, `has_role()`, `has_any_role()`, `has_privileged_role()`, `mfa_satisfied()`, `is_vendor_member()`.

## Not yet built

All commerce tables (Batch 2+), retention jobs, location tables, storage buckets. Design in `docs/phase-0/PHASE_0_REPORT.md` §F.

## Batch 2 additions (migrations `20261011000001`, `20261011000002`)

- **Catalogue:** `categories`, `vendors` (extended, unique slug), `vendor_staff`, `vendor_applications`, `store_hours` (weekday 0=Sunday, Africa/Lagos), `products` (integer kobo, 1..100,000,000; stock NULL = unlimited), `product_option_groups`, `product_options`.
- **Commerce:** `approved_delivery_points`, `carts`, `cart_items`, `orders` (23-state CHECK; only `PENDING_PAYMENT`, `PAID`, `CANCELLED`/expiry reachable in this batch), `order_items` (immutable snapshots), `order_status_history` and `payment_attempts` (append-only; mock only).
- **Rules in SECURITY DEFINER functions** (fixed `search_path`, EXECUTE revoked from PUBLIC/anon, identity/role/aal checked inside): application submit/decide, vendor suspend, category/delivery-point admin, shop profile/hours/staff, product upsert/availability/archive, cart add/set/clear/quote, `create_order`, `cancel_unpaid_order`, `expire_unpaid_orders` (service_role only), `mock_pay_order`.
- **Anonymous read model** is functions only (`list_categories`, `browse_vendors`, `get_vendor_menu`, `get_product`, `search_products`); a hygiene test pins this exact anon allowlist. Search is `ILIKE` with escaped wildcards + `pg_trgm` index.
- **Pricing:** prices and fees are recomputed in the database from product rows; the client sends only ids/quantities/option ids and an idempotency key. Platform fee = round-half-up(items × bps / 10000).
- **Stock policy:** stock is reserved (decremented) at order creation under `FOR UPDATE` locks taken in id order; released on cancel/expiry. Idempotency: unique (customer_id, idempotency_key).
- **Settings:** `delivery_fee_kobo`, `platform_fee_bps`, `unpaid_order_expiry_minutes`, `max_cart_item_quantity` (placeholders), `mock_payments_enabled` (cannot be changed through `set_platform_setting`; seed sets true locally only).

## Batch 3 additions (migration `20261012000001`)

- **Payments:** `payment_transactions` (one reference per attempt; amount copied from the order row), `payment_events` (append-only; unique provider event id), `ledger_entries` (append-only; only `payment_received` / `refund_paid`; no payout entries), `reconciliation_flags` (amount_mismatch, late_payment, duplicate_payment, unknown_reference, vendor_rejected_paid_order), `refunds` (requests only).
- **Functions:** `payment_prepare` (customer, aal2, owner), `payment_set_access_code` and `payment_apply_event` (service role only; advisory lock per event id, row locks on transaction and order; idempotent), `list_reconciliation_flags`, `resolve_reconciliation_flag`, `refund_request` (platform/finance admin, aal2, capped by received minus requested).
- **State machine:** `vendor_transition_order(order, action, reason)` with actions accept / reject / start_preparing / mark_ready; every step goes through `app_private.step_order` (conditional update + history row). `VENDOR_REVIEW` is unused: `PAID` is the "waiting for vendor" state. Pickup orders end `mark_ready` in `PICKUP_AWAITING_HANDOVER`; delivery orders in `AWAITING_RIDER` (Batch 4 takes over).
- **Handover:** `pickup_codes` (hash + attempt counter, no user access), `get_pickup_code` (customer only; code recomputed from HMAC with a private pepper in `app_private.secrets`), `complete_pickup` (vendor staff, aal2; code + recipient + PNG signature validated; evidence row; `COMPLETED`), `handover_evidence` (append-only, visible to customer/shop/staff by order visibility).

## Batch 4 additions (migrations `20261013000001` - `000003`)

**Corrections (000001):** pickup-code pepper removed from the database (`app_private.secrets` and `pickup_code_for` dropped); `pickup_codes.code_hash` is NULL until the server registers the hash of the code it derived (`pickup_code_register`, service role, once only); `get_pickup_code` returns a nonce, never the code; `handover_evidence.capture_method` (`drawn` | `typed_acknowledgement`) with a shape constraint; `complete_pickup(..., p_method, p_typed)`; setting `typed_signature_enabled` (default `false`).

**Phase 7 (000002):** `rider_applications`, `rider_profiles` (extended), `rider_terms_versions`, `rider_terms_acknowledgements` (append-only), `rider_shifts` (one active per rider), `delivery_assignments` (slot 1..5; unique active per order; unique active slot per rider), `assignment_tokens` (hash only, no user access), `rider_issues`. The Batch 1 capacity stub was dropped. Functions: `submit_rider_application`, `decide_rider_application`, `set_rider_status`, `rider_ack_terms`, `my_rider`, `rider_go_active`, `rider_go_inactive`, `list_delivery_offers`, `rider_accept_order`, `my_assignments`, `rider_issue_handover_token`, `vendor_pending_rider_pickups`, `vendor_confirm_rider_pickup`, `rider_start_route`, `rider_report_issue`, `list_rider_issues`, `resolve_rider_issue`, `ops_release_assignment`, `delivery_point_set_geo`. Internal: `lock_rider`, `lock_order_row`, `step_order`, `release_assignment`, `test_seam`, `haversine_m`, `require_rider`, `require_ops`.

**Phase 8 (000003):** `rider_location_current`, `rider_location_history` (no API-role access at all), `rider_post_location` (validates shift + active work + range + accuracy + freshness + frequency, infers arrival), `get_order_tracking` (own order, in transit), `staff_get_order_tracking` (purpose recorded + audited), `purge_location_data` (service role). `approved_delivery_points` gained `lat`, `lng`, `geofence_radius_m`, `is_synthetic`.

**Settings added** (placeholders, validated by `set_platform_setting`): `rider_terms_current_version`, `handover_token_ttl_minutes`, `location_max_accuracy_m`, `location_max_age_seconds`, `location_min_interval_seconds`, `location_stale_after_seconds`, `arrival_max_accuracy_m`, `arrival_max_age_seconds`, `default_geofence_radius_m`, `location_history_retention_hours`, `typed_signature_enabled`.

**Invariant layers** - I1 (<=5 active per rider): rider-row lock -> `unique(rider_id, slot)`. I2 (<=1 active per order): order-row lock -> unique partial index -> conditional update in `step_order`.

## Batch 5 additions (migrations `20261014000001` - `000003`)

**K48 (000001):** `app_private.current_terms_version`, `require_approved_terms`, `require_terms_ack`; `rider_ack_terms`, `rider_go_active`, `rider_accept_order` and `my_rider` replaced so a placeholder, unknown or missing terms version raises `terms_not_approved`.

**Phase 9 (000002):** assignment status `completed` (+ `completed_at`; the two active-assignment unique indexes list their statuses explicitly, so completion frees the rider's slot and the order); `handover_evidence` extended (`evidence_kind` pickup|delivery, `assignment_id`, `proof_session_id`, `arrival_detected_at`, shape constraint: deliveries are drawn only); `delivery_proof_sessions` (hash only, expiring, one live per assignment, 5 wrong tries); `delivery_proof_begin` (recipient; ARRIVAL_DETECTED -> AWAITING_RECIPIENT_PROOF), `complete_delivery` (one transaction: validate -> consume token -> evidence -> AWAITING_RECIPIENT_PROOF -> DELIVERED -> COMPLETED -> assignment `completed` -> stop stored location); `staff_get_delivery_proof` (audited); `vendor_find_pickup_by_code` + `code_lookup_attempts`; evidence read policy narrowed (customer, and the shop for pickup only). Setting `delivery_proof_ttl_minutes`.

**Phase 10 (000003):** `refunds` state machine `requested -> under_review -> approved -> processing -> succeeded | failed | reconciliation_required` (or `rejected`), `refund_items`, `refund_events`, ledger `refund_id`; `support_cases`, `case_statements`, `case_events`; `return_requests`, `return_request_items`. Functions are listed in `docs/access-matrix.md`. Settings `refund_fee_policy`, `refund_support_approval_limit_kobo`, `return_policy` (validated by `set_platform_setting`).

**Invariant layers**

- Delivery completion once: order-row lock -> assignment-row lock + status re-check -> proof-session lock + `used_at is null` -> evidence primary key (order) -> conditional update in `step_order`. `tests/db/delivery-concurrency.test.ts` removes them one by one; with every layer removed duplicates DO happen.
- Refund cap (R1): order-row lock -> balance check -> trigger `refunds_cap_guard` (its own order lock + sum re-check). Item quantities: trigger `refund_items_cap_guard` / `return_items_cap_guard`. State machine: trigger `refunds_state_guard` / `return_state_guard`. `tests/db/refund-concurrency.test.ts`.
- Idempotency: unique `(requested_by, idempotency_key)` on refunds, `(reporter_id, idempotency_key)` on cases, `(customer_id, idempotency_key)` on returns; one open case per (order, type).
- Provider boundary: `refund_begin_execution` accepts mode `fake` only; the real modes raise `provider_not_enabled`. Success needs a provider reference (unique) and writes one `refund_paid` ledger entry per refund (unique `refund_id`).
