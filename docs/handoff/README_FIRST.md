# AFIT Market — Claude Code Handoff Pack

**Purpose:** This package is the product and implementation handoff for building AFIT Market in phases. Give `CLAUDE_MASTER_PROMPT.md` to Claude Code first, then ask it to begin Phase 0 only. Do not ask it to implement all phases at once.

## The product
AFIT Market is a campus-focused marketplace for approved AFIT community members. Customers can order from approved vendors and choose pickup or delivery. Delivery includes live rider tracking, automatically detected arrival, and auditable proof of handover.

## Files in this ZIP
- `CLAUDE_MASTER_PROMPT.md` — main instructions for Claude Code.
- `PRODUCT_REQUIREMENTS.md` — requirements and user journeys.
- `DELIVERY_PROOF_AND_DISPUTES.md` — delivery/pickup confirmation, rider batches, partial refunds, returns and disputes.
- `ARCHITECTURE_AND_SECURITY.md` — recommended stack, data design, security, location and payment boundaries.
- `PHASED_ROADMAP.md` — implementation plan with 12 phases and exit criteria.
- `RULES_DO_AND_DONT.md` — strict build rules.
- `PHYSICAL_ACTION_CHECKLIST.md` — non-coding work to do with AFIT, vendors, riders, payment provider and legal/privacy advisers.
- `DECISIONS_AND_OPEN_GATES.md` — decisions already made and matters that require approval/testing.

## Important decisions
- Database: Supabase Postgres.
- Frontend/backend: Claude Code should choose the best fit for the requirements, but must explain and record the choice before implementation. Default recommendation: Next.js App Router + TypeScript + Tailwind, Supabase Auth/Postgres/Realtime/Storage, server-side business logic, and a PWA.
- 2FA is required in V1. Prefer authenticator-app TOTP through Supabase Auth MFA, with stronger enforcement for admins, vendors and riders. Avoid paid SMS as the default second factor.
- Rider location is OFF until the rider explicitly selects **Go Active**. It must stop when the rider goes inactive and when there are no active assigned deliveries. During active deliveries, only authorized parties can see relevant location.
- Rider must never manually type coordinates or press a “delivered” button that completes an order. The app captures location and the server completes delivery only after required proof checks.
- Electronic signature is mandatory for successful handover. Customer/recipient may also choose QR or OTP as an additional verification method; these options must not require paid SMS sending. In-app QR and app-generated codes should be free of per-message cost.
- A QR token must be order-specific and bound server-side to the rider who accepted/was assigned the delivery. It must not be a reusable static QR.
- Rider capacity: up to **5 active accepted deliveries** at once, but only when each is already available/awaiting rider and the rider remains within configured capacity and routing/safety constraints. Do not force one active delivery only.
- Refunds: full refund or partial refund for specific missing/damaged items and/or relevant fees, with amount limits, reason, evidence and audit log.
- Vendor payout/settlement must not be represented as guaranteed “escrow.” Verify with Paystack and qualified Nigerian counsel whether the proposed delayed-release/marketplace settlement arrangement is supported and compliant before enabling real money movement.
- Military/security approvals and actual AFIT delivery zones must be obtained physically before launch. Do not invent or publish sensitive campus locations.

## Recommended working method
1. Open the repository and inspect existing files before changing anything.
2. Read the whole handoff pack.
3. Report current repo state and a Phase 0 plan.
4. Implement only the current phase after user approval.
5. Run tests, type checks, lint, security checks and manual test steps.
6. Stop and provide a report. Do not continue to the next phase without explicit approval.
7. Use fake/demo data locally until the user explicitly authorizes credentials, external integrations, or production deployment.
