# Security and privacy notes (planning stage)

## MFA policy (owner decision, V1)
- Public visitors: browse public products without registering.
- Registered customers: TOTP MFA before placing orders or using protected account features.
- Vendors, riders, support, finance admins, platform admins: MFA before protected operational/privileged features.
- Enforcement: server guards (`requireAuth({roles, aal})`) **and** database (restrictive RLS / function checks on `auth.jwt()->>'aal' = 'aal2'`). UI is never the control.

## Recovery (status: DESIGN GATE, not built)
Verified: Supabase offers no standard TOTP recovery codes; recommends a backup TOTP factor on a different device/app; cannot restore accounts if all factors are lost; an experimental recovery-codes factor exists. Rules: recovery never bypasses primary authentication; no custom weaker system; attempts rate-limited and audited; admin-assisted recovery never lets a single admin take over an account (two distinct aal2 admins, neither the target, owner notified, delay, audit) and only if implementable with supported APIs. If not securely possible: document blocker, propose verified alternative, ask owner before coding.

## Database
SECURITY DEFINER functions: fixed `search_path`, restricted EXECUTE, internal identity + authorization checks, allowed/denied tests, concurrency tests where atomicity matters. Sensitive tables have direct writes revoked from `authenticated`. Append-only: audit, status history, ledger, proofs, payment events.

## Location, proof, payments
See Phase 0 report §H, §I, §K. Rider location only after Go Active; stale/inaccurate fixes ignored; GPS never completes orders. Mandatory signature; single-use, expiring, assignment-bound tokens. Payments test-mode/mocked; settlement disabled; never described as escrow.

## Privacy
Synthetic data only in development; no real AFIT locations; minimal collection; retention periods pending legal advice.
