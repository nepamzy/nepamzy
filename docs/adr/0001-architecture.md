# ADR 0001 — Architecture

Status: **Accepted in principle** (owner, review round 1). Date: 2026-10-10.

## Decision
Modular monolith. Next.js App Router + React + TypeScript + Tailwind as a mobile-first PWA. Supabase Postgres, Auth (TOTP MFA), RLS, Realtime, private Storage. Atomic and security-critical rules (order transitions, rider capacity of five, handover-token consumption, refund caps, location acceptance) in hardened PostgreSQL functions; orchestration and presentation in the server app. Paystack test mode/mocks only. Provider adapters (payments, maps, notifications) with mocks. Local-first; no deployment.

## Alternatives considered
Separate SPA + API (more moving parts, no benefit now); microservices (unjustified); all logic in app layer only (weaker guarantees for atomic rules); all logic in SQL (hard to test/maintain — rejected by review).

## Consequences
SQL migrations carry security weight, so each SECURITY DEFINER function needs fixed `search_path`, restricted EXECUTE, identity/authorization checks and allowed/denied tests. Rider location via PWA is unproven until real Android tests; failure → report evidence, owner decides next step. Settlement stays disabled pending Paystack/legal confirmation.

## Changes since Phase 0 report
None to architecture. Policy changes: customer MFA policy; custom recovery-codes proposal withdrawn (see `docs/review-log.md`).
