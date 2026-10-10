# PROMPT — AFIT Market Implementation Batch 1 (Phases 1 + 2) — REVISED (review round 1)

> Self-contained. Use only after the owner explicitly approves THIS revised prompt. Do **only** this batch, then stop and report. Revision history: v1 (Phase 0) → v2 (incorporates independent review round 1; see `docs/review-log.md`).

## 1. Project context
AFIT Market is a mobile-first campus marketplace for the approved AFIT (Air Force Institute of Technology, Nigeria) community: customers order from approved vendors, choose pickup or delivery, track riders live, and confirm handover with a mandatory electronic signature plus optional QR/in-app code. Roles: customer, vendor (owner/staff), rider, support agent, finance admin, platform admin. Requirements are in `docs/handoff/` (read all nine files first; `DECISIONS_AND_OPEN_GATES.md` is the decision register) and the Phase 0 report `docs/phase-0/PHASE_0_REPORT.md` (including §S). You act as architect, designer, full-stack engineer, security engineer and QA. Never claim a feature works without executed evidence; classify every test as passed / failed / not run / blocked by credentials / manual / external approval.

## 2. Confirmed architecture (owner-approved in principle; unchanged)
Modular monolith: Next.js App Router + React + TypeScript (strict) + Tailwind, mobile-first PWA; Supabase Postgres / Auth (TOTP MFA) / RLS / Realtime / private Storage; pnpm; Vitest; Playwright + axe; Supabase CLI local stack. Atomic, security-critical rules live in PostgreSQL functions; ordinary orchestration and presentation logic stays in the server application (do **not** push all logic into SQL). Money = integer kobo. Providers behind adapters with mocks. No microservices; no integration-middleware platforms (Nango, Composio, Pipedream, Make, Zapier). No paid service. Paystack test mode/mocks only in later batches. No deployment.

## 3. Existing implementation
Repo contains only `docs/` and the root `README.md` placeholder. No application code exists. Check the repository state and name (the owner may have renamed it `afit-market`) before starting; report any access problem.

## 4. Mandatory pre-work (before writing application code)
1. **Environment gate.** Check Docker. The client and `dockerd` are installed in the Phase 0 environment, but the daemon was **not running**. You may try to start the local daemon and the Supabase CLI local stack (free, local). If the stack cannot run, **STOP and report BLOCKED**. Do not switch to a remote Supabase project, a Supabase branch, or any paid service, and do not run tests against a remote database.
2. **Supabase MFA verification spike** (read current docs + test on the local stack; write findings to `docs/review-log.md`). Already verified from docs in review round 1: `auth.jwt()->>'aal'` is the supported claim for RLS, with a documented `RESTRICTIVE` policy pattern requiring `aal2`; unenrolling a verified factor requires aal2; verifying a factor logs out other sessions and promotes the current session to aal2; Supabase does not return TOTP recovery codes and recommends a **backup TOTP factor**; an *experimental* recovery-codes factor exists (`auth.experimental.recoveryCodes`). Still to verify empirically: JWT `aal` refresh timing after challenge/verify; behavior of `aal` for sessions created before enrollment; whether the experimental recovery-codes feature exists and is enabled in the local CLI stack, what it guarantees, and whether recovery codes can ever yield a session without the primary authentication step; how Admin API factor deletion behaves; session revocation on factor change.
3. **Recovery decision gate.** Using the spike, write a short proposal in `docs/security-privacy.md` for MFA recovery. Rules: (a) recovery must never bypass primary authentication (password/email login still required); (b) do **not** build a separate custom recovery-code or OTP system that could be weaker than Supabase Auth; (c) recovery attempts must be rate-limited and audited; (d) administrator-assisted recovery must never let one administrator take over an account (require two *distinct* aal2 admins, neither the target nor the requester-as-approver, identity verification step, notification to the account owner, time delay, full audit; apply only if technically verified as implementable with Supabase's supported APIs); (e) preferred baseline: mandatory backup TOTP factor enrollment (a second device/app) for privileged roles, plus the verified experimental feature only if the spike shows it is safe. **If no secure design can be implemented, document the blocker, propose a verified alternative, and STOP and ask the owner before coding recovery.** Everything else in the batch may proceed meanwhile.

## 5. Batch 1 scope

### Phase 1 — Foundation and design system
- Scaffold Next.js + TS strict + Tailwind + ESLint + Prettier + Vitest + Playwright; scripts: `dev, build, start, lint, typecheck, test, test:db, test:e2e, format`. `.env.example` with placeholders only; `.gitignore` excluding env files; zod env validation that fails fast and never prints values; `server-only` guard on the service-role client.
- Folder structure per Phase 0 §D.
- Design system (distinct, modern, trustworthy; not a clone of any product): tokens (type scale, WCAG AA colour, spacing, radius, elevation, motion honoring `prefers-reduced-motion`); components: Button, IconButton, Input, Select, Textarea, Checkbox/Radio, Card, Badge/StatusPill, Tabs, Dialog, Toast, Skeleton, EmptyState, ErrorState, OfflineBanner, Retry, Stepper/Timeline, Money (₦ from kobo), BottomNav, Sidebar, Table. 44px touch targets, visible focus, labelled controls, plain-language copy (no "webhook", "token", "RLS" in user text).
- Role shells with **mock data only**: public (browse mock vendors/products without login), customer (home, orders, account), vendor (dashboard, orders, catalogue, handover), rider (Go Active **placeholder with consent copy; no geolocation calls in this batch**), admin (dashboard, applications, audit). Order-status vocabulary component covering all states in the handoff.
- PWA basics: manifest, placeholder icons, offline fallback. No push, no location.
- Security headers + strict CSP; automated check that no secret/service-role value reaches the client bundle.
- GitHub Actions workflow: lint, typecheck, unit tests, build (no secrets, no deploy).

### Phase 2 — Supabase schema, authentication, roles, MFA
- `supabase init`; explicit SQL migrations only.
- Tables (RLS enabled on **every** table, explicit policies): `profiles`, `role_assignments`, `audit_events` (append-only), `platform_settings`, plus stub reference tables needed to test policies (`vendors`, `vendor_staff`, `rider_profiles`). No custom recovery-code table unless the owner approves a verified design. Do not build later-batch tables, but keep keys compatible with Phase 0 §F.
- Helper functions (all hardened, see §6): `has_role`, `is_aal2` (reads `auth.jwt()->>'aal'`), `is_vendor_member`.
- Profile auto-creation trigger; users cannot write their own roles; role grants only by `platform_admin` through an audited function that requires aal2; every grant/revoke writes `audit_events`.
- Append-only enforcement on `audit_events` via triggers + revoked grants (no UPDATE/DELETE for anyone).
- Auth: email + password via Supabase Auth with `@supabase/ssr` cookies; email verification (local); session refresh middleware; sign-out; re-authentication for sensitive actions.
- **MFA policy (owner decision, required in V1):**
  - Public visitors browse public products without registering.
  - Registered customers must complete **TOTP MFA before placing orders or accessing protected account features**.
  - Vendors, riders, support staff, finance administrators and platform administrators must complete MFA before any protected operational/privileged feature.
  - Enforce on the server **and** in the database (restrictive RLS and function checks requiring `aal2` for protected tables/operations). Never UI-only.
  - Implement: enrollment (QR + manual secret), verify, sign-in challenge, factor list, factor removal (aal2), session upgrade; follow the verified docs, not assumptions. Recovery per §4.3.
- Single server utility `requireAuth({ roles, aal })` used by every protected route/action.
- Protected-route behavior: unauthenticated → login; wrong role → 403; aal1 on protected → MFA enroll/challenge page.
- Seed: synthetic users/roles only, clearly fake, local only.
- Rate limiting for login and MFA/recovery attempts (document limitations of the chosen mechanism).
- Redacting structured logger with request IDs; never log passwords, tokens, secrets, TOTP codes.

## 6. Database security rules (apply to every function)
Every `SECURITY DEFINER` function must: set a fixed `search_path` (e.g. `set search_path = ''` with schema-qualified names); have `EXECUTE` revoked from `public`/`anon` and granted only to the roles that need it; validate the calling identity (`auth.uid()`) and authorization (role + aal) inside the function; avoid dynamic SQL built from input; and be covered by tests for **allowed and denied** calls. Revoke direct INSERT/UPDATE/DELETE on sensitive tables from `authenticated`; clients write only through whitelisted functions or server code. Add concurrency tests where a rule requires atomicity (none are mandatory in Batch 1, but build the test harness for parallel connections because Batch 4 needs it). Run the Supabase advisors / lint (`supabase db lint` or equivalent) and record results.

## 7. Rules carried forward for later batches (do not implement now; do not contradict)
- **Rider location (Batch 4):** PWA first. Collect location only after the rider deliberately taps Go Active; stop when inactive; show stale/unavailable clearly; reject inaccurate or stale fixes for arrival; GPS arrival never completes an order. Do not claim reliable background tracking without real Android device test evidence. If tests show the PWA cannot meet requirements, **stop and report the evidence; do not start a native app project** — that is the owner's decision.
- **Handover proof (Batches 3, 5):** a rider can never complete an order by pressing Delivered; mandatory recipient signature; server validates order, assignment, token and completion conditions; QR/code single-use, expiring, assignment-bound; reassignment invalidates old tokens; all proof and completion events audited.
- **Payments (Batch 3):** mocks/test mode only; no real charges, payouts, production credentials or deployment; settlement disabled until Paystack and qualified Nigerian counsel confirm; never call it escrow.

## 8. Required docs (create/update)
`README.md` (see `docs/phase-0/README_PLAN.md`; keep unfinished features clearly labelled), `docs/adr/0001-architecture.md`, `docs/requirements-checklist.md`, `docs/database.md`, `docs/security-privacy.md`, `docs/environment.md`, `docs/testing.md`, `docs/known-issues.md`, `docs/review-log.md`, `docs/external-approvals.md`, `docs/reports/batch-1.md`. Preserve `docs/handoff/` unmodified. Never include real credentials.

## 9. Acceptance criteria
1. Environment gate passed (local Supabase stack runs) or the batch is reported BLOCKED.
2. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass from a clean checkout.
3. `supabase db reset` applies migrations + seed from scratch with no errors; DB lint/advisors reviewed.
4. Shells render at 360px and desktop with no horizontal scroll, keyboard navigable; axe shows no serious/critical violations on shell pages.
5. RLS/function tests (allowed **and** denied): customer cannot read another profile; user cannot edit own role; non-admin cannot grant roles; admin at aal1 cannot grant roles; nobody can UPDATE/DELETE `audit_events`; anon cannot read protected data; vendor-A member cannot read vendor-B rows; rider cannot read other riders' rows; a registered customer at aal1 is denied order-placement-class protected operations (use a stub protected table/function); each SECURITY DEFINER function has fixed search_path and restricted EXECUTE (asserted by a test querying `pg_proc`).
6. Server guard tests: anon, wrong role and aal1 are rejected on protected routes; correct role + aal2 passes.
7. MFA flows verified on the local stack: enroll → sign out → sign in requires code → wrong code rejected → factor removal requires aal2 → backup-factor path works. Recovery tests per the approved §4.3 design; if blocked, report as BLOCKED with the proposal.
8. Secret scan clean; service-role key absent from the client bundle (automated).
9. No geolocation API calls; no payment/map provider calls.

## 10. Required tests
Unit: money formatting, role/aal guard logic, env validation. DB: items in 9.5 plus constraints. Integration: auth-guard matrix generated from a permission table. E2E (Playwright, mobile viewport): public browse, sign-up, sign-in, MFA, role-shell access. Accessibility: axe on every shell. Real-device and manual items are listed as "manual verification required", not as passed.

## 11. Known issues / open questions to carry
- Unverified until spike: items listed in §4.2 (written to review log).
- Supabase local stack availability (Docker daemon).
- Repository rename and session repo scope (owner action).
- Add any further review corrections: **[none yet]**.

## 12. Constraints and prohibitions
Local-first only. No deployment, production data, real messages, payments, refunds, payouts, live tracking, or real AFIT locations. No secrets committed, printed or logged. No later-batch features. Justify each new package. Do not remove or weaken any handoff requirement. Preserve all prior docs.

## 13. Required reporting
Finish with the full A–O report from the master brief: executive summary; requirements coverage (implemented+verified / implemented not verified / partial / not implemented / blocked); files changed (incl. migrations); frontend review; backend & DB review; security review; test report (exact commands, results, counts, failures, fixes); successes with evidence; failures/incomplete; technical debt; costs and dependencies; decisions/assumptions; manual verification steps; completion assessment (COMPLETE / CONDITIONALLY COMPLETE / INCOMPLETE / BLOCKED); the **complete self-contained prompt for Batch 2 (Phases 3+4)**; and "INDEPENDENT REVIEW PACKAGE FOR CHATGPT" (report, changed files, test results, decisions, defects, security-critical code and migration/RLS summaries, next prompt). Self-review the diff as an independent engineer first. Do not claim that the owner or ChatGPT reviewed the implementation until evidence has been submitted and reviewed.

## 14. Stop
**Stop after Batch 1.** Do not start Batch 2 until the owner explicitly approves.
