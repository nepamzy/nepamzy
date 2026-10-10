# AFIT Market

A mobile-first campus marketplace and delivery platform for the approved community of the Air Force Institute of Technology (AFIT), Nigeria.

> **Status: planning only.** Phase 0 (discovery and architecture) is complete and has had its first independent review. **No application code has been written yet.** Everything below describes the planned product; items marked 🚧 are not built.

## Purpose
Make buying and selling easier on campus. Approved vendors (restaurants, shops, printing, souvenirs and similar) list products; community members order for **pickup or delivery**, follow the order, and confirm receipt with a signature.

## Intended users
Students, lecturers, civilian staff, military personnel and other AFIT-authorised users (customers); approved vendors and their staff; approved delivery riders; support, finance and platform administrators.

## Planned features (all 🚧 unless noted)
- Browse vendors and products without an account 🚧; registered customers use TOTP two-factor authentication before ordering 🚧
- Cart, checkout, pickup or delivery to AFIT-approved points only 🚧
- Paystack payments, **test mode only** during development; vendor settlement stays disabled until Paystack and Nigerian legal counsel confirm the arrangement (this is **not** escrow) 🚧
- Vendor order management and a one-screen pickup handover 🚧
- Riders: explicit "Go Active" before any location sharing; up to five active deliveries; live map, distance and ETA 🚧
- Mandatory recipient signature on every handover, plus optional single-use QR/in-app code; riders cannot mark orders delivered 🚧
- Full and item-level partial refunds, returns, evidence-based disputes 🚧
- Notifications, reviews, admin tools, audit trail 🚧

## Architecture (approved in principle)
Modular monolith: Next.js (App Router) + React + TypeScript + Tailwind, installable PWA; Supabase (Postgres, Auth with TOTP MFA, Row Level Security, Realtime, private Storage). Security-critical atomic rules (order state changes, rider capacity, handover tokens, refunds) live in hardened PostgreSQL functions; other logic stays in the server app. Details: [`docs/phase-0/PHASE_0_REPORT.md`](docs/phase-0/PHASE_0_REPORT.md) and [`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md).

## Local setup
Not available yet. Planned prerequisites (to be confirmed in Batch 1): Node.js LTS, pnpm, Docker (for the local Supabase stack) and the Supabase CLI. Planned flow:
```
pnpm install
cp .env.example .env.local     # placeholders only; fill with LOCAL values
supabase start && supabase db reset
pnpm dev
```
## Environment configuration
`.env.example` (to be added in Batch 1) will list placeholder variable names only. Never commit real keys. The Supabase service-role key is server-only and must never use a `NEXT_PUBLIC_` prefix. No production credentials are used in development.

## Testing (planned commands)
`pnpm lint`, `pnpm typecheck`, `pnpm test` (unit), `pnpm test:db` (RLS/function tests), `pnpm test:e2e` (Playwright + accessibility), `pnpm build`. Real-device GPS tests are manual. See `docs/testing.md` once created.

## Documentation
| Path | Content |
|---|---|
| `docs/handoff/` | Original requirements pack (unmodified) |
| `docs/phase-0/` | Phase 0 report, Batch 1 prompt, README plan |
| `docs/adr/` | Architecture decision records |
| `docs/requirements-checklist.md` | Requirement-by-requirement status |
| `docs/security-privacy.md` | Security, MFA and privacy notes |
| `docs/known-issues.md` | Open issues and risks |
| `docs/review-log.md` | Independent review findings and responses |
| `docs/external-approvals.md` | Approvals needed from AFIT, Paystack, legal |

## Rules of the project
Local-first: no deployment, real payments, payouts, real messages or live tracking without the owner's explicit authorisation. Synthetic data only. No real or sensitive AFIT locations. Launch requires written AFIT permission.
