# PROMPT — AFIT Market Implementation Batch 4 (Phases 7 + 8)

> Self-contained. Use ONLY after the owner has reviewed the Batch 3 report and explicitly approved this prompt. The owner has said they will send corrections after reviewing Batch 3: **apply those corrections first**, ahead of everything below. Implement Phases 7 and 8 only, then stop and report with the full A–O report, an INDEPENDENT REVIEW PACKAGE FOR CHATGPT, and the complete Batch 5 prompt (Phases 9 + 10). Do not begin Phase 9. Do not claim any review happened until evidence is submitted.
> Version: v1, written at the end of Batch 3 (2026-10-11).

# PART 0 — CORRECTIONS AND CARRIED-FORWARD FINDINGS (binding; read first)

## 0.1 Corrections from Batch 3

1. **Paystack was never exercised against the real API** (paystack.com unreachable from the build sandbox); everything ran against `scripts/fake-paystack.mjs`. Facts used (HMAC-SHA512 `x-paystack-signature` over the raw body, `charge.success`, `/transaction/initialize`, `/transaction/verify/:reference`, refund fields) came from third-party summaries (K30). If network access exists, re-verify against official docs and, with an owner-supplied `sk_test_` key, run the manual check list in `docs/reports/batch-3.md` §M. Do not build refunds execution until verified.
2. CI job `db-and-e2e` was written but not yet run on GitHub (K23): check its result on the PR and fix it.
3. Handover signature lives in a database `bytea` (K26), has no keyboard alternative (K27); pickup code cannot be re-issued/unlocked (K28). Decide with the owner; build a support unlock/re-issue tool only if approved.
4. Concurrency tests prove outcomes, not lock presence (K31): where a lock is the control, add a test that fails without it (e.g. interleave using `pg_sleep`/advisory locks) or state clearly that a constraint is the backstop.
5. After a rejected form submission React clears typed fields (K33); keep this in mind for rider forms (use `defaultValue` or preserve state).
6. Test hygiene reminders: provider/event ids must be unique per run; assert the `/cart` URL after "Add to cart"; scope alerts to `main`; wait for server-action POST + form reset; never `pkill -f` a pattern that matches your own shell; `mockPaymentsAllowed`/`paystackConfig` fail closed.

## 0.2 Owner decisions still open (do not decide)

MFA recovery after losing all authenticators; backup authenticator required for privileged roles?; forced TOTP at sign-up; default `customer` role for all accounts; TOTP replay/lockout trade-offs; real pilot values (delivery fee, platform fee %, expiry, caps — placeholders in `platform_settings`); one store per vendor; stock reserved at order creation; anonymous carts; stock/ledger policies for vendor-rejected paid orders; repository rename (owner action); AFIT-approved delivery points and real coordinates (none exist; use fictional/fake only).

## 0.3 Engineering rules (unchanged, approved)

Next.js App Router + TS strict + Tailwind PWA; Supabase Postgres/Auth/RLS; modular monolith; atomic/security rules in hardened SECURITY DEFINER functions (fixed `search_path=''`, EXECUTE revoked from PUBLIC/anon, identity+role+aal inside, allowed/denied/concurrency tests, catalog hygiene test); browser never talks to Supabase; no `NEXT_PUBLIC_`; every protected prefix in `ROUTE_POLICIES` with `enforceRoutePolicy` in its layout (route handlers check access themselves); no `loading.tsx` above guards; privileged roles need aal2; money is integer kobo; Paystack test mode only, no settlement/payout; local-first; secrets never committed (`check:secrets` must pass); `APP_ENV` fails closed. Local stack: `pnpm db:start`, `pnpm db:reset`, `bash scripts/make-env-local.sh`, `pnpm dev:paystack`. Verification set: `pnpm lint`, `typecheck`, `format:check`, `test`, `test:db`, `build`, `check:secrets`, `pnpm exec supabase db lint --local`, `pnpm exec playwright test` (mobile-360 + desktop).

# PART 1 — SCOPE (from `docs/handoff/PHASED_ROADMAP.md`)

## Phase 7 — Rider onboarding, active shift, capacity-five assignment

- Rider application/approval (admin), profile; **Go Active / Go Inactive** (replaces the labelled preview); active shift record.
- Eligible order offers: delivery orders in `AWAITING_RIDER` (set by Batch 3) offered only to active, approved riders; offers visible via RLS to eligible riders only.
- **Atomic maximum of five accepted active deliveries per rider**, enforced in one hardened function; the capacity count must not be bypassable by concurrent accepts or by two riders accepting one order.
- Assignment-bound QR/code tokens (hashed at rest, single use, bound to order + rider); vendor-to-rider handover of the parcel (rider shows the assignment token to the vendor; vendor confirms) reusing the Batch 3 evidence patterns; route/order sequence; rider issue reporting.
- Orders move `AWAITING_RIDER → RIDER_ASSIGNED → PICKED_UP_BY_RIDER → EN_ROUTE` through the transition function; **riders have no action that marks an order delivered** (Phase 9).
- **Exit:** concurrency tests prove six simultaneous accepts cannot exceed five active jobs; two riders accepting one order yields exactly one assignment.

## Phase 8 — Live location, map, ETA, automatic arrival

- Location adapter interface with a **fake provider first**; real coordinates only after AFIT approval (none available: use fictional coordinates and label them).
- **Tracking is off-duty by default**: location is collected only while the rider is Active and has an assigned delivery; permission requested only on Go Active with a plain-language explanation; revoked/denied permission handled; no tracking history kept beyond the retention placeholder.
- GPS update service: freshness and accuracy checks (reject stale/inaccurate fixes), rate limit per rider, privacy access tests (customers see only their own rider's position for their active order; nobody else; vendors never).
- Live map updates (Supabase Realtime or polling — choose after verifying Realtime RLS behaviour locally; if Realtime cannot run in this sandbox use polling and say so), route distance/ETA via a provider adapter (fake), arrival geofence around approved delivery points; **arrival is never based on stale or inaccurate GPS** and never completes an order.
- Stale-location UX for customers; screen-wake-lock "keep this screen open" guidance for riders. **Do not claim background tracking works**: the owner must test on real Android devices; produce a manual test script and record the result as UNVERIFIED until evidence is supplied. If the PWA cannot work, stop and report; do not build a native app without approval.
- **Exit:** tracking off-duty by default; privacy access tests pass; arrival not based on stale/inaccurate GPS.

# PART 2 — NON-NEGOTIABLE CHECKS

RLS + denied-access tests for every new table; concurrency tests for capacity and assignment; migration lint clean; a11y (axe) and 360px checks for new pages; docs, requirements checklist, known issues updated; no secrets; no real coordinates.

# PART 3 — REPORT AND STOP

Finish with the A–O report, the independent review package, exact commands/results, and the complete Batch 5 prompt (Phases 9 + 10; corrections first). Stop and wait for explicit owner approval. Stop and report if: the local stack cannot run; a security-critical requirement cannot be met; Realtime/location cannot be tested locally; any step needs real coordinates, a paid service, deployment or a live credential.
