# Requirements checklist (end of Batch 1)

Legend: ☐ Planned (not built) · ◐ Planned, designed (Phase 0) · ◑ Implemented, not fully tested · ✔ Implemented and Tested · ⛔ Blocked / owner decision.

| Area | Requirement | Batch | Status | Evidence |
|---|---|---|---|---|
| Foundation | Next.js/TS strict/Tailwind app, scripts, env template, env validation | 1 | ✔ | build, typecheck, unit |
| Foundation | Design system and components | 1 | ✔ | `/design`, axe on all shells |
| Foundation | Role shells (customer, vendor, rider, admin) with mock data; Go Active is a **non-functional preview** with no geolocation calls | 1 | ✔ | e2e shells |
| Foundation | PWA basics: manifest, icon, offline fallback via service worker | 1 | ✔ (placeholder icon is an SVG only) | e2e |
| Foundation | Security headers, nonce CSP, secret scan | 1 | ✔ | e2e headers, `check:secrets` |
| Foundation | CI workflow (lint, typecheck, unit, build, secrets) | 1 | ◑ (workflow written, not executed on GitHub in this session) | — |
| Identity | Supabase Auth email+password, confirmation email, session refresh, sign-out | 1 | ✔ | e2e journey |
| Identity | Roles, RLS everywhere, audited role grants, append-only audit | 1 | ✔ | db tests |
| MFA | TOTP enrol/challenge/verify/factor list/removal; session upgrade; server + DB enforcement | 1 | ✔ | db, e2e, API pins |
| MFA | Customer policy (MFA before ordering / protected features); staff/vendor/rider MFA before protected features | 1 | ✔ | db, e2e |
| MFA | Backup authenticator | 1 | ✔ | e2e journey |
| MFA | Recovery after losing ALL factors | 1 | ⛔ owner decision | `security-privacy.md` §3 |
| Security | Rate limiting login/MFA, audited failures | 1 | ✔ | e2e |
| Security | SECURITY DEFINER hardening + parallel-connection harness | 1 | ✔ (harness proven on a stub) | db tests |
| Vendors | Onboarding, catalogue, hours, stock | 2 | ☐ | — |
| Customers | Browse (real data), cart, checkout prep, order creation | 2 | ☐ (public browse shows sample data) | — |
| Payments | Paystack test mode, webhooks, idempotency, ledger; settlement disabled | 3 | ☐ (setting `settlement_policy` code-locked to DISABLED) | db test |
| Orders | Server-side state machine, audit | 3 | ☐ (status vocabulary only) | — |
| Pickup | One-screen vendor handover, signature | 3 | ☐ (non-functional preview) | — |
| Riders | Onboarding, Go Active, capacity 5 atomic | 4 | ☐ | — |
| Location | Opt-in, freshness, map/ETA, arrival (never completes) | 4 | ☐ | — |
| Proof | Signature, optional single-use bound QR/code | 5 | ☐ | — |
| Refunds, returns, disputes | Full/partial, caps, idempotency, evidence | 5 | ☐ | — |
| Notifications, reviews, admin, hardening, pilot readiness | | 6 | ☐ | — |
| External | AFIT permission, Paystack/legal confirmations | — | ☐ (owner) | `external-approvals.md` |
