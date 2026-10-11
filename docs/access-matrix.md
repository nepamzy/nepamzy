# Access matrix (Batch 5 additions; maintained from Batch 5 on)

Legend: **Y** allowed · **-** refused by the database (and tested) · **own** only for rows/orders they own or are a party to · **aal2** privileged and every protected action needs a second factor; a session at aal1 is refused everywhere below.
Every function below checks identity, role and assurance level **inside the database**; the route guards and server actions are a second layer. Tests: `tests/db/delivery.test.ts`, `refunds.test.ts`, `cases-returns.test.ts`, `riders.test.ts`, `schema-hygiene.test.ts`.

## Delivery proof (Phase 9)

| Operation | Anonymous | Customer (order owner) | Other customer | Shop | Rider | Support | Finance | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `delivery_proof_begin(order)` | - | Y (arrival detected; not if they are the assigned rider) | - | - | - | - | - | - |
| `complete_delivery(order, token, name, drawn signature)` | - | Y (once; own session token) | - | - | - | - | - | - |
| Read delivery evidence row (`handover_evidence`) | - | own | - | - (pickup evidence only) | - | - (use audited function) | - | - |
| `staff_get_delivery_proof(order, purpose, include_signature)` | - | - | - | - | - | Y (purpose >= 10 chars, audited) | - | Y (same) |
| `ops_handle_delivery_exception(order, reason)` | - | - | - | - | - | Y | - | Y |
| `vendor_find_pickup_by_code(code)` | - | - | - | Y (own shop members; 10 failed tries / 10 min) | - | - | - | - |
| Mark an order DELIVERED / COMPLETED any other way | - | - | - | - | - | - | - | - |

## Refunds, returns, reports (Phase 10)

| Operation | Anonymous | Customer (owner) | Other customer | Shop | Rider | Support | Finance | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_request_refund` | - | Y (finished + paid order) | - | - | - | - | - | - |
| `refund_request` (finance-created) | - | - | - | - | - | - | Y | Y |
| `refund_start_review` | - | - | - | - | - | Y (not own) | Y (not own) | Y (not own) |
| `refund_decide` approve | - | - | - | - | - | only up to `refund_support_approval_limit_kobo` (default 0) | Y (not own) | Y (not own) |
| `refund_decide` reject | - | - | - | - | - | Y | Y | Y |
| `refund_begin_execution` (FAKE mode only) | - | - | - | - | - | - | Y (not own request) | Y |
| `refund_record_outcome` / `refund_reconcile` | - | - | - | - | - | - | Y | Y |
| `refund_provider_outcome` (provider-event path) | - | - | - | - | - | - | - | service role only |
| Read refunds table | - | own | - | - | - | Y | Y | Y |
| Read refund events (internal notes) | - | - | - | - | - | Y | Y | Y |
| `customer_request_return` | - | Y | - | - | - | - | - | - |
| `staff_decide_return` | - | - | - | - | - | Y | - | Y |
| `vendor_confirm_return_received` | - | - | - | Y (own shop) | - | - | - | - |
| `open_support_case` | - | Y (own paid order) | - | - | - | - | - | - |
| `case_add_statement` | - | Y (reporter) | - | Y (party) | Y (party) | Y (public or internal) | - | Y |
| `get_case` | - | own, own side | - | own side, no description | own side, no description | full | - | full |
| `staff_case_bundle` (neutral evidence) | - | - | - | - | - | Y (audited) | - | Y (audited) |
| `case_start_review`, `case_decide`, `case_close` | - | - | - | - | - | Y (not own case) | - | Y |

## Rider terms (K48 correction)

`rider_ack_terms`, `rider_go_active`, `rider_accept_order`: riders only, approved profile, aal2 **and** an approved (non-placeholder) current terms version that they acknowledged. API roles cannot edit `rider_terms_versions`.

## Tables new in Batch 5 (RLS enabled, restrictive aal2 policy, SELECT-only grants)

`delivery_proof_sessions` and `code_lookup_attempts`: no API access at all. `refund_items`: via the parent refund. `refund_events`: staff. `support_cases`: reporter or support/admin. `case_statements`: support/admin, or the reporter for customer/support-public statements only (vendor and rider statements are never readable by the customer through the table). `case_events`: support/admin. `return_requests`: customer, shop members for their orders, support/admin. `return_request_items`: via the parent.
