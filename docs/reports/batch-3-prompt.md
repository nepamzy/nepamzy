# PROMPT — AFIT Market Implementation Batch 3 (Phases 5 + 6)

> Self-contained. Use ONLY after the owner has reviewed the Batch 2 report and explicitly approved this prompt. Implement Phases 5 and 6 only, then stop and report with the full A–O report, an INDEPENDENT REVIEW PACKAGE FOR CHATGPT, and the complete Batch 4 prompt. Do not begin Phase 7. Do not claim any review happened until evidence is submitted.
> Version: v1, written at the end of Batch 2 (2026-10-11).

# PART 0 — CORRECTIONS AND CARRIED-FORWARD FINDINGS (binding; read first)

## 0.1 Corrections from Batch 2

1. `expire_unpaid_orders()` exists but nothing schedules it (K18): schedule it (pg_cron locally or a server route using the service role, authenticated by a secret) and test it.
2. DB and e2e tests are not in CI (K23): add a CI job (`supabase start` + Playwright) or document precisely why it is infeasible.
3. Request ID is not on every log line (K24); rate-limit tables have no purge job (K16): fix or schedule with a design note.
4. Seed data is local-only and sets `mock_payments_enabled=true`; the mock payment must be replaced by Paystack **test mode** and removed or fully gated; keep the production-mode e2e proving no test-pay button.
5. DB tests that count global rows must be leftover-tolerant (a vendor-application test was fixed this way); keep tests independent of prior e2e data.
6. Lint hygiene: run `supabase db lint --local` (via `pnpm exec supabase`) — a STABLE function with PERFORM was caught.
7. Test hygiene: wait for server-action POST + form reset; scope alert locators to `main` (Next route announcer has role=alert); after "Add to cart" assert the `/cart` URL before navigating; avoid raw POSTs to server actions.

## 0.2 Owner decisions still open (do not decide)

MFA recovery after losing all authenticators; backup authenticator required for privileged roles?; forced TOTP at sign-up; default `customer` role for all accounts; TOTP replay/lockout trade-offs; real pilot values (commission, delivery fee, expiry, caps — placeholders in `platform_settings`); one-store-per-vendor; stock reserved at order creation; anonymous carts; repository rename (owner action).

## 0.3 Engineering rules (unchanged, approved)

Next.js App Router + TS strict + Tailwind PWA; Supabase Postgres/Auth/RLS; modular monolith; atomic/security rules in hardened SECURITY DEFINER functions (fixed `search_path=''`, EXECUTE revoked from PUBLIC/anon, identity+role+aal inside, allowed/denied/concurrency tests, catalog hygiene test); browser never talks to Supabase; no `NEXT_PUBLIC_`; every protected prefix in `ROUTE_POLICIES` with `enforceRoutePolicy` in its layout; no `loading.tsx` above guards; privileged roles need aal2; money is integer kobo; Paystack **test mode only**, no live keys, no settlement/payout (settlement locked `DISABLED`); local-first; secrets never committed; `APP_ENV` fails closed. Local stack: `pnpm db:start`, `pnpm db:reset`, Docker Hub registry override, custom mail sink + forwarder.

# PART 1 — SCOPE (from `docs/handoff/PHASED_ROADMAP.md`)

## Phase 5 — Payments, webhook verification, ledger

- Read current Paystack docs first; record verified facts (initialize/verify endpoints, webhook signature `x-paystack-signature` HMAC-SHA512, event names, refund API) in `docs/review-log.md`; mark anything unverified.
- Server-side transaction initialization using the DB-computed order total; never client amounts; reference unique per attempt; amount/currency/reference checked on verify.
- Webhook endpoint: raw-body signature verification (constant time), idempotent event store (unique provider event id), replay-safe, out-of-order safe, ignores unknown events, never trusts redirect callbacks alone. Payment success moves `PENDING_PAYMENT → PAID` only through a hardened function; amount mismatch/duplicate/late-after-expiry handled and flagged for reconciliation.
- Payment event history, failed payment handling, ledger primitives (append-only entries; no payout/settlement), reconciliation report for admin, refund primitives (data model + function skeletons, no money movement beyond test mode).
- Tests: simulated and replayed webhooks (valid, invalid signature, duplicate, out-of-order, wrong amount, late payment after expiry), no live keys anywhere, secret scan passes.
- **Exit:** replayed webhook tests pass; no live keys or production payouts.

## Phase 6 — Vendor order operations and pickup handover

- Full order state machine (the 23-state CHECK exists) enforced in one hardened transition function; vendor accept/reject/preparing/ready; history append-only; illegal transitions rejected and tested.
- Simple vendor handover screen; one-time pickup QR/code (hashed at rest, single use, expiring); mandatory recipient signature captured and validated server-side; private storage for evidence; PDF receipt; token replay and wrong-order tests.
- Vendor orders page becomes actionable; customers see live status; notifications are out of scope (Phase 11).
- **Exit:** pickup cannot complete without required server-validated proof.

# PART 2 — NON-NEGOTIABLE CHECKS

RLS + denied-access tests for every new table; concurrency tests for transitions and webhook processing; `pnpm lint`, `typecheck`, `format:check`, `test`, `test:db`, `build`, `check:secrets`, `supabase db lint`, full Playwright (mobile-360 + desktop, axe, no horizontal scroll); docs, requirements checklist, known issues updated.

# PART 3 — REPORT AND STOP

Finish with the A–O report, the independent review package, exact commands/results, and the complete Batch 4 prompt (Phases 7 + 8; corrections first). Stop and wait for explicit owner approval. Stop and report if: the local stack cannot run; Paystack test mode cannot be verified; a security-critical requirement cannot be met; any step needs a live credential, real payment, deployment or remote database.
