# Architecture and Security Recommendations

## 1. Recommended starting architecture
Use a modular monolith first: one repository, one deployable web app, clear domain modules. Avoid microservices until real scale proves they are needed.

Recommended baseline:
- Next.js App Router + React + TypeScript
- Tailwind CSS with accessible component primitives
- PWA support for installable mobile web
- Supabase Postgres as the primary database
- Supabase Auth for identity and MFA
- Supabase Realtime where suitable for authorized order/status updates
- Supabase private Storage for signatures and dispute evidence, with strict access policies
- Server-side route handlers/server actions/domain services for trusted business operations
- Map/routing provider chosen after checking AFIT coverage, route quality, pricing and terms
- Paystack as initial payment provider, subject to merchant/marketplace approval
- In-app notifications first; avoid paid SMS as a core dependency
- A queue/background job mechanism only where needed for retries, webhooks and notifications

Claude Code must verify current SDKs and deployment compatibility before selecting exact package versions.

## 2. Trust boundaries
Treat the browser/mobile client as untrusted. Never trust client-provided:
- role or permissions
- order amount or refund amount
- payment success
- order status
- rider assignment
- location/arrival result
- signature completion claim
- QR/code validity
- settlement eligibility

All sensitive transitions must be authorized and validated server-side. Use database constraints and atomic transactions for money, rider capacity and state transitions.

## 3. Supabase security
- Enable Row Level Security on all exposed tables.
- Write explicit RLS policies and test both allowed and denied access.
- Never expose the Supabase service-role key in client code.
- Store secrets in server environment variables/secret management only.
- Restrict private storage buckets and use short-lived signed URLs.
- Use least privilege for database access and administrator roles.
- Keep sensitive admin operations server-only and MFA-protected.
- Use Supabase Auth MFA/TOTP for cost-conscious 2FA. Enforce the appropriate assurance level on protected server routes and RLS policies.
- Rate-limit login, code verification, QR validation, refund requests and support submissions.
- Log security events without logging passwords, tokens, signature raw data or unnecessary personal data.

## 4. Suggested domain modules
- identity-and-access
- vendors-and-catalogue
- cart-and-checkout
- orders-and-state-machine
- payments-and-ledger
- delivery-and-rider-capacity
- location-and-routing
- handover-proof
- refunds-and-returns
- disputes-and-support
- notifications
- admin-and-audit
- privacy-and-retention

Keep payment, order state transitions and proof validation in domain/service logic, not scattered across UI components.

## 5. Initial schema concepts
Claude Code should refine a normalized schema and migrations. Likely tables:
- profiles
- user_roles / role_assignments
- vendor_applications
- vendors
- vendor_staff
- stores
- delivery_zones / approved_delivery_points
- products / product_variants / product_options
- carts / cart_items (if persisted)
- orders / order_items
- payment_attempts / payment_events / ledger_entries
- rider_profiles
- rider_shifts
- delivery_assignments
- delivery_tasks / delivery_stops
- rider_location_current (ephemeral/current)
- rider_location_history (limited retention)
- handover_tokens (hashed, expiring, one-time)
- handover_proofs
- signature_assets / signature_metadata
- refund_cases / refund_lines
- return_cases / return_events
- disputes / dispute_evidence
- notifications
- reviews
- audit_events
- admin_actions

Do not store every GPS ping forever. Keep current position separately and retain only a limited, policy-defined trail necessary for active delivery, dispute and safety purposes.

## 6. Rider tracking lifecycle
- Default `OFF_DUTY`.
- Rider taps `GO_ACTIVE`; app requests foreground/background location permissions only as required and explains why.
- Location tracking is permitted only during an active shift and relevant active delivery work.
- Use platform capabilities and test browser limitations honestly. If reliable background location is not supported in the chosen PWA/browser, document the limitation and recommend a dedicated rider app only if tests prove it necessary; do not pretend a PWA can reliably track in all background states.
- Send location updates at a sensible interval/distance threshold; include accuracy and timestamp.
- Reject stale/inaccurate data for arrival decisions.
- Share location only with the order's authorized recipient and operations staff.
- Stop tracking when rider is inactive or no active work remains. Make exceptions explicit and narrow for an active safety/handover workflow.
- Use approved AFIT points/zones only; never expose a public map of restricted areas.

## 7. Payments and money ledger
- Server initializes payment; client never declares payment successful.
- Verify provider transaction server-side and validate webhook signatures.
- Webhooks must be idempotent and safe to retry.
- Store provider references, amount, currency, status and reconciliation timestamps.
- Maintain an internal ledger for amounts owed/paid/refunded, but do not treat ledger state as a bank balance.
- Build refund calculations with immutable line-level prices and idempotency.
- Settlement behavior is a gated decision: confirm Paystack marketplace and delayed payout support before production. Avoid claiming escrow without legal approval.
- Do not build a wallet or custody of customer funds in V1 unless a qualified compliance review approves it.

## 8. Privacy and retention
- Collect only data needed for account, fulfillment, safety, payment, dispute and legal duties.
- Provide clear notice and purpose for location collection, signatures and identity verification.
- Keep signature/evidence files private; do not make public URLs.
- Set retention periods for GPS history, signatures, payment records and dispute evidence with legal advice.
- Implement access, correction, deletion/restriction request workflows as applicable, while preserving records that must legally be retained.
- Use synthetic identities/locations for development and testing.

## 9. Observability and reliability
- Structured logs with request/correlation IDs.
- Error monitoring and alerting.
- Retry transient webhook/notification failures safely.
- Idempotency for checkout, payment webhooks, handover tokens and refunds.
- Backups and tested restoration process.
- Health checks and documented incident response.
- Never use production credentials in local tests.

## 10. Map provider selection
Do not choose a provider only because it is popular. Before committing, compare:
- Actual road/path coverage in the AFIT area
- Routing and ETA quality
- Geocoding quality for approved delivery points
- SDK/browser support
- Pricing at expected order/location volumes
- Terms for storing/displaying map data
- Ability to restrict the app to approved destination points

Use mock-map/provider adapters during early local phases. Real campus coordinates should be supplied/approved by AFIT, not invented.
