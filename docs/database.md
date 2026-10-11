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
