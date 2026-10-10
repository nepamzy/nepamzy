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

## Batch 1 implementation notes (2026-10-10)
- **Versions pinned:** Next 16.4.0, React 19.3.0, Tailwind 4.3.3, Supabase JS 2.117.3 / SSR 0.12.7, zod 4.6.5, Vitest 5.0.3, Playwright 1.64.0, **TypeScript 5.9.3** (TypeScript 7.0.2 was current; the stable 5.9 line was chosen because the Next/ESLint ecosystem is validated against it) and **ESLint 9.39** (ESLint 10 was current; `eslint-config-next` plugins target 9).
- **Next 16 conventions used:** `proxy.ts` (renamed middleware) for session refresh + nonce CSP; async `cookies()/headers()`; `forbidden()` with `experimental.authInterrupts` for HTTP 403. All pages are dynamic (the nonce CSP requires per-request rendering).
- **No root `loading.tsx`:** it makes Next start streaming before layouts run the guard, which turned 403/404 into HTTP 200. Found by the e2e suite and fixed by removing it.
- **Server-only Supabase access:** the browser never calls Supabase; cookies are HttpOnly; no `NEXT_PUBLIC_` variables.
- **No change to the approved architecture.** Local-stack workarounds (image registry, mail sink/forwarder) are development-only and documented in `scripts/`.
