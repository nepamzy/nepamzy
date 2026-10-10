# Requirements checklist

Legend: ☐ not started · ◐ designed (Phase 0) · ✔ implemented and verified. Nothing is ✔ yet.

| Area | Requirement | Batch | Status |
|---|---|---|---|
| Foundation | Next.js/TS/Tailwind PWA, design system, role shells | 1 | ☐ |
| Identity | Supabase Auth, roles, RLS | 1 | ◐ |
| MFA | TOTP per owner policy; server + DB enforcement | 1 | ◐ |
| MFA | Verified recovery design | 1 | ◐ (gate) |
| Vendors | Onboarding, catalogue, hours, stock | 2 | ◐ |
| Customers | Browse, cart, checkout prep, order creation | 2 | ◐ |
| Payments | Paystack test mode, webhooks, idempotency, ledger; settlement disabled | 3 | ◐ |
| Orders | Server-side state machine, audit | 3 | ◐ |
| Pickup | One-screen vendor handover, signature | 3 | ◐ |
| Riders | Onboarding, Go Active, capacity 5 atomic | 4 | ◐ |
| Location | Opt-in, freshness, map/ETA, arrival (never completes) | 4 | ◐ |
| Proof | Mandatory signature, optional single-use bound QR/code | 5 | ◐ |
| Refunds | Full/partial, caps, idempotency | 5 | ◐ |
| Returns & disputes | Return tasks, evidence, decisions | 5 | ◐ |
| Notifications, reviews, admin | In-app first | 6 | ◐ |
| Hardening | Accessibility, security, reliability, pilot readiness | 6 | ◐ |
| External | AFIT permission, Paystack/legal confirmations | — | ☐ (owner) |
