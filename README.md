# AFIT Market

A mobile-first campus marketplace and delivery platform for the approved community of the Air Force Institute of Technology (AFIT), Nigeria.

> **Status: Batch 2 built (vendor onboarding, catalogue, browsing, cart, checkout, order creation with a MOCK payment), awaiting owner review.** Real payments, order fulfilment, riders, delivery proof, refunds are **not built yet**. Rider screens and vendor handover show clearly labelled sample data. **Not deployed; not for real users or real money.**

**Status vocabulary:** _Planned_ (designed, not built) → _Implemented_ (code exists) → _Tested_ (automated/manual evidence recorded). _Unverified_ marks assumptions not yet checked. Full table: [`docs/requirements-checklist.md`](docs/requirements-checklist.md).

## Purpose

Make buying and selling easier on campus. Approved vendors (restaurants, shops, printing, souvenirs and similar) list products; community members order for **pickup or delivery**, follow the order, and confirm receipt with a signature.

## Intended users

Students, lecturers, civilian staff, military personnel and other AFIT-authorised users (customers); approved vendors and staff; approved delivery riders; support, finance and platform administrators.

## What exists today

| Area                                                                                                                                              | Status                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Next.js + TypeScript + Tailwind app, installable PWA shell, offline fallback page                                                                 | Implemented, Tested                              |
| Design system (tokens, buttons, forms, cards, tabs, dialog, toast, tables, timeline, empty/error/loading/offline states, order-status vocabulary) | Implemented, Tested (axe, 360px) — see `/design` |
| Role shells for customer, vendor, rider, admin (mock data)                                                                                        | Implemented, Tested                              |
| Vendor application, admin approval/suspension, shop profile/hours, catalogue with options and stock                                               | Implemented, Tested (DB + e2e)                   |
| Public browsing/search without an account; cart; checkout; order creation (pickup/delivery); test payment (local only)                            | Implemented, Tested (DB + e2e)                   |
| Email + password sign-up with emailed confirmation, sign-in, sign-out                                                                             | Implemented, Tested                              |
| TOTP MFA: enrol, challenge, backup authenticator, removal; enforced in app **and** database                                                       | Implemented, Tested                              |
| Roles and RLS; administrators grant/revoke roles (audited); append-only audit trail                                                               | Implemented, Tested                              |
| MFA recovery after losing every authenticator                                                                                                     | **Not implemented — owner decision needed**      |
| Real payments (Paystack), vendor order transitions, riders, location, handover proof, refunds, disputes, notifications                            | **Planned** (Batches 2–6)                        |

## Architecture

Modular monolith: Next.js (App Router) + React + TypeScript + Tailwind; Supabase (Postgres, Auth with TOTP MFA, Row Level Security; Realtime/Storage later). The browser never talks to Supabase: all auth and data calls run on the server and sessions are HttpOnly cookies. Security-critical rules live in hardened PostgreSQL functions and RLS; application orchestration stays in the server code. Details: [`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md), [`docs/phase-0/PHASE_0_REPORT.md`](docs/phase-0/PHASE_0_REPORT.md).

## Local setup

Prerequisites: Node 22, pnpm 10, Docker (daemon running).

```bash
pnpm install
pnpm db:start            # local Supabase stack + local mail sink (no internet services, no real email)
cp .env.example .env.local   # then fill LOCAL values from: ./node_modules/.bin/supabase status -o env
pnpm dev                 # http://127.0.0.1:3000
```

Optional synthetic accounts for manual testing (random passwords printed once): `node --env-file=.env.local scripts/seed-local-users.mjs`. Each account must enrol an authenticator app at first sign-in to reach protected areas.
`pnpm db:reset` resets the local database. If Docker or the local stack cannot run, stop and see `docs/testing.md`; do **not** point the app at a remote database.

## Environment configuration

`.env.example` lists placeholder names only. Never commit real keys. The service-role key is server-only. No `NEXT_PUBLIC_` variables are used. See [`docs/environment.md`](docs/environment.md).

## Testing

`pnpm lint` · `pnpm typecheck` · `pnpm test` (unit) · `pnpm test:db` (RLS/functions/concurrency harness) · `pnpm test:e2e` (browser: auth, MFA, guards, accessibility, PWA) · `pnpm check:secrets` · `pnpm build`. What each covers and what is untested: [`docs/testing.md`](docs/testing.md).

## Documentation

| Path                                                                       | Content                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/handoff/`                                                            | Original requirements pack (unmodified)                      |
| `docs/phase-0/`                                                            | Phase 0 report, Batch 1 prompt, README plan                  |
| `docs/reports/batch-1.md`                                                  | Batch 1 completion report, review package and Batch 2 prompt |
| `docs/adr/`                                                                | Architecture decision records                                |
| `docs/requirements-checklist.md`                                           | Requirement-by-requirement status                            |
| `docs/security-privacy.md`                                                 | Security, MFA, recovery gate, limitations                    |
| `docs/database.md`, `docs/environment.md`, `docs/testing.md`               | Schema, variables, tests                                     |
| `docs/known-issues.md`, `docs/review-log.md`, `docs/external-approvals.md` | Risks, review findings, approvals needed                     |

## Rules of the project

Local-first: no deployment, real payments, payouts, real messages or live tracking without the owner's explicit authorisation. Synthetic data only. No real or sensitive AFIT locations. Launch requires written AFIT permission.
