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
