# Security and privacy notes (planning stage)

## MFA policy (owner decision, V1) — status: Planned, not implemented
- Public visitors: browse public products without registering.
- Registered customers: TOTP MFA before placing orders or using protected account features.
- Vendors, riders, support, finance admins, platform admins: MFA before protected operational/privileged features.
- Enforcement: server guards (`requireAuth({roles, aal})`) **and** database (restrictive RLS / function checks on `auth.jwt()->>'aal' = 'aal2'`). UI is never the control.

## Recovery (status: DESIGN GATE — Planned, Unverified, not built)
Verified from Supabase docs (Phase 0 review): no standard TOTP recovery codes; a backup TOTP factor on a different device/app is the recommended approach; Supabase cannot restore access if all factors are lost; an experimental recovery-codes factor exists and **must not be assumed production-ready**.
Policy (owner, v3):
- No custom recovery-code table and no weaker alternative login mechanism.
- Investigate secure backup-factor enrollment and recovery; test it for the roles required to use it under the approved MFA policy.
- Do **not** silently require every customer to enroll a second authenticator factor. All registered customers must still meet the mandatory MFA policy before ordering or using protected account features. Any extra-factor requirement (e.g. for privileged roles) is proposed to the owner first.
- Recovery never bypasses primary authentication; attempts rate-limited and audited; admin-assisted recovery never lets one administrator take over an account (two distinct aal2 admins, neither the holder, holder notified, delay, audit) and only if supported APIs allow it.
- If secure recovery cannot be verified: document the limitation here and stop for the owner's decision before implementing recovery. Authentication is never weakened to pass tests.
Still to verify on the local stack: JWT `aal` refresh timing after challenge; session revocation after factor changes; backup-factor behavior; experimental feature availability/guarantees; Admin API factor deletion behavior.

## Database
SECURITY DEFINER functions: fixed `search_path`, restricted EXECUTE, internal identity + authorization checks, allowed/denied tests, concurrency tests where atomicity matters. Sensitive tables have direct writes revoked from `authenticated`. Append-only: audit, status history, ledger, proofs, payment events.

## Location, proof, payments
See Phase 0 report §H, §I, §K. Rider location only after Go Active; stale/inaccurate fixes ignored; GPS never completes orders. Mandatory signature; single-use, expiring, assignment-bound tokens. Payments test-mode/mocked; settlement disabled; never described as escrow.

## Privacy
Synthetic data only in development; no real AFIT locations; minimal collection; retention periods pending legal advice.
