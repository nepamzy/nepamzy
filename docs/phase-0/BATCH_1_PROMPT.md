# PROMPT — AFIT Market Implementation Batch 1 (Phases 1 + 2) — v3 (consolidated)

> Self-contained and final once approved. Use ONLY after the owner explicitly approves this version. Implement Phases 1 and 2 only, then stop and report. Do not restart the project, create a new roadmap, skip phases, or begin Phase 3.
> Revision history: v1 Phase 0 → v2 review round 1 → **v3** review round 1 follow-up (this file; see `docs/review-log.md`).

## 0. Project context

AFIT Market is a mobile-first campus marketplace for the approved AFIT (Air Force Institute of Technology, Nigeria) community: customers order from approved vendors, choose pickup or delivery, track riders live, and confirm handover with a mandatory electronic signature plus optional QR/in-app code. Roles: customer, vendor (owner/staff), rider, support agent, finance admin, platform admin. Requirements: `docs/handoff/` (read all nine files; `DECISIONS_AND_OPEN_GATES.md` is the decision register; keep the originals unmodified) and `docs/phase-0/PHASE_0_REPORT.md` (including §S). You act as architect, designer, full-stack engineer, security engineer and QA. Never claim a feature works without executed evidence. Do not remove or weaken any handoff requirement to make implementation easier.

---

# PART 1 — PHASE 0 CORRECTIONS (binding; apply to everything below)

### 1.1 Architecture (retain; do not redesign)

Next.js App Router + React + TypeScript (strict) + Tailwind; Supabase PostgreSQL / Auth / Row Level Security / Realtime / private Storage where appropriate; modular monolith; mobile-first PWA first; PostgreSQL functions for critical atomic business rules; Paystack test mode or mocks only; local-first implementation and testing; pnpm, Vitest, Playwright + axe, Supabase CLI local stack. No microservices; no integration-middleware platforms (Nango, Composio, Pipedream, Make, Zapier); no paid services. Redesign only if a **verified technical blocker** requires it — then report the blocker, propose the change, and wait for approval.

### 1.2 Authentication and MFA policy

- Public visitors may browse public products without registering.
- Registered customers must complete **TOTP MFA before placing orders or accessing protected account features**.
- Vendors, riders and privileged staff (support, finance admin, platform admin) must complete MFA before any protected operational feature.
- Enforce through supported **server-side and database-side** mechanisms (server guards + restrictive RLS / function checks requiring `aal2`). Never UI-only.
- **Verify current Supabase documentation AND actual local behavior** (not assumptions) for: the `aal` claim; TOTP enrollment and challenge; session updates after a successful challenge (including JWT refresh timing); factor removal and the `aal2` requirement for unenrolling a verified factor; session revocation after factor changes; recovery options and their security limitations. Do not assume any experimental feature is production-ready.
- Already confirmed from Supabase docs during Phase 0 review (re-check, record in `docs/review-log.md`): `auth.jwt()->>'aal'` is the supported claim, with a documented `RESTRICTIVE` policy pattern for `aal2`; unenrolling a verified factor needs an aal2 session; verifying a factor logs out other sessions and promotes the current session to aal2; Supabase offers no standard TOTP recovery codes and recommends a backup TOTP factor; an experimental recovery-codes factor exists (`auth.experimental.recoveryCodes`).

### 1.3 MFA recovery (clarified policy — decision gate)

- Do **not** introduce a custom recovery-code table, and no weaker alternative login mechanism, as a workaround. Do not assume the experimental recovery-codes feature is safe or production-ready.
- Investigate secure **backup-factor enrollment and recovery**. Test the recovery process for the roles that are required to use it under the approved policy.
- Do **not** silently require every customer to enroll a second authenticator factor. Every registered customer must still satisfy the mandatory MFA policy (1.2). Any requirement for an _additional_ factor (for example for privileged roles) is proposed to the owner, not silently imposed.
- Recovery must never bypass primary authentication; attempts rate-limited and audited; administrator-assisted recovery must never let one administrator take over an account (if used at all: two distinct aal2 administrators, neither the account holder, notification to the holder, delay, full audit — and only if implementable with Supabase's supported APIs).
- If a secure recovery process cannot be verified: document the limitation in `docs/security-privacy.md` and **STOP for the owner's decision before implementing recovery**. Other batch work may continue meanwhile. Never weaken authentication to make acceptance tests pass.

### 1.4 Database security

Use PostgreSQL functions for rules needing atomic enforcement, locking or trusted database-side validation; keep ordinary orchestration in the server app (do not move all logic into SQL). For **every** `SECURITY DEFINER` function: fixed `search_path` (e.g. `set search_path = ''` with schema-qualified names); `EXECUTE` revoked from `public`/`anon` and granted only where needed; identity (`auth.uid()`) and authorization (role + aal) validated **inside** the function; no dynamic SQL from input; direct writes to sensitive tables revoked from `authenticated`; **allowed and denied** tests; **concurrency tests** where atomicity matters. Use `RESTRICTIVE` RLS policies where a rule must hold regardless of other policies (for example the aal2 requirement) and test them under realistic roles (`anon`, `authenticated` at aal1 and aal2, each app role). Critical rules across the project: order-state transitions, rider delivery limits, handover validation, refund limits, location checks (built in later batches; Batch 1 builds the harness and pattern, and tests it on stubs). Run Supabase DB lint/advisors and record results.

### 1.5 Rider location (applies from Batch 4; do not implement now)

PWA first. No claim of reliable background tracking until tested on real Android devices. Location collection begins only when a rider explicitly taps Go Active and stops when inactive. Handle stale, inaccurate and unavailable data explicitly. GPS arrival detection never completes an order. If the PWA cannot meet the required tracking behavior, **stop and report the evidence; do not begin a native app without owner approval.**

### 1.6 Handover proof (applies from Batches 3 and 5; do not implement now)

Mandatory recipient signature. A rider can never complete an order by pressing Delivered. The server validates order, assignment, required evidence and completion conditions. Optional QR/code tokens: unpredictable, single-use, expiry-controlled, assignment-bound; reassignment invalidates old tokens. Proof and completion events are auditable.

### 1.7 Payments and deployment

Mocked or test-mode payments only; no real charges, refunds or payouts. Settlement stays disabled until Paystack and qualified Nigerian legal counsel confirm the arrangement; never call it escrow without that confirmation. No production deployment or live credentials without explicit authorization. **If Docker or the local Supabase stack cannot run, STOP and report the blocker. Do not silently switch to a remote database, Supabase branch, or paid service.**

### 1.8 Documentation

Preserve the original handoff documents. Maintain the root `README.md`, `docs/adr/0001-architecture.md`, `docs/requirements-checklist.md`, `docs/security-privacy.md`, `docs/review-log.md`, `docs/known-issues.md`, `docs/external-approvals.md`. Use the status vocabulary **Planned / Implemented / Tested / Unverified** consistently; never state an unfinished feature works; never include real credentials.

---

# PART 2 — MANDATORY PRE-WORK (before any application code)

1. Inspect the repository and documentation (state, name — the owner may have renamed it `afit-market` — remotes, branch).
2. Verify the toolchain: Node, pnpm, Docker **daemon**, Supabase CLI. In the Phase 0 environment the Docker client and `dockerd` were installed but the daemon was **not running**. You may try to start the local daemon and the Supabase local stack (free, local). If it cannot run → **BLOCKED**: stop and report (see 1.7).
3. Check current package versions and supported Supabase APIs (docs search + local stack). Record versions used and anything deprecated.
4. Run the **MFA verification spike** (1.2, 1.3) on the local stack; write findings to `docs/review-log.md` and the recovery proposal/limitations to `docs/security-privacy.md`.
5. Resolve prerequisites that can be verified locally. Stop and report blockers needing an owner decision. Do not proceed past a blocker that affects a security-critical requirement.

---

# PART 3 — PHASE 1: FOUNDATION AND DESIGN SYSTEM

- Scaffold Next.js + TS strict + Tailwind + ESLint + Prettier + Vitest + Playwright. Scripts: `dev, build, start, lint, typecheck, test, test:db, test:e2e, format`. `.env.example` with placeholders only; `.gitignore` excluding env files; zod env validation that fails fast and never prints values; `server-only` guard on the service-role client.
- Folder structure per Phase 0 §D.
- Design system (distinct, modern, trustworthy; not a clone of another product): tokens (type scale, WCAG AA colour, spacing, radius, elevation, motion honoring `prefers-reduced-motion`); components: Button, IconButton, Input, Select, Textarea, Checkbox/Radio, Card, Badge/StatusPill, Tabs, Dialog, Toast, Skeleton, EmptyState, ErrorState, OfflineBanner, Retry, Stepper/Timeline, Money (₦ from kobo), BottomNav, Sidebar, Table. 44px touch targets, visible focus, labelled controls, plain-language copy (no "webhook", "token", "RLS" in user text).
- Role shells with **mock data only**: public (browse mock vendors/products without login), customer (home, orders, account), vendor (dashboard, orders, catalogue, handover), rider (Go Active **placeholder with consent copy; no geolocation calls**), admin (dashboard, applications, audit). Order-status vocabulary component covering all handoff states.
- PWA basics: manifest, placeholder icons, offline fallback. No push, no location.
- Security headers + strict CSP; automated check that no secret/service-role value reaches the client bundle.
- GitHub Actions workflow: lint, typecheck, unit tests, build (no secrets, no deploy).

---

# PART 4 — PHASE 2: SUPABASE SCHEMA, AUTH, ROLES, MFA

- `supabase init`; explicit SQL migrations only.
- Tables (RLS enabled on **every** table; explicit policies): `profiles`, `role_assignments`, `audit_events` (append-only), `platform_settings`, plus stubs needed to test policies (`vendors`, `vendor_staff`, `rider_profiles`) and one stub protected table/function representing "order placement" to test the customer aal2 rule. **No custom recovery-code table.** Do not build later-batch tables; keep keys compatible with Phase 0 §F.
- Helper functions (hardened per 1.4): `has_role`, `is_aal2` (reads `auth.jwt()->>'aal'`), `is_vendor_member`.
- Profile auto-creation trigger; users cannot write their own roles; role grants only by `platform_admin` through an audited function requiring aal2; every grant/revoke writes `audit_events`. Append-only enforcement on `audit_events` (triggers + no UPDATE/DELETE grants for anyone).
- Auth: email + password via Supabase Auth with `@supabase/ssr` cookies; email verification (local); session refresh middleware; sign-out; re-authentication for sensitive actions.
- MFA per 1.2: enrollment (QR + manual secret), verify, sign-in challenge, factor list, factor removal (aal2), session upgrade, session behavior after factor changes — implemented according to the verified docs/behavior. Recovery per 1.3 (may end in a documented STOP for the owner).
- Single server utility `requireAuth({ roles, aal })` used by every protected route/action. Behavior: unauthenticated → login; wrong role → 403; aal1 on a protected resource → MFA enroll/challenge page.
- Seed: synthetic users/roles only, clearly fake, local only.
- Rate limiting for login and MFA/recovery attempts (document the mechanism's limits).
- Redacting structured logger with request IDs; never log passwords, tokens, secrets or TOTP codes.

---

# PART 5 — ACCEPTANCE CRITERIA AND TESTING

For every requirement report: relevant files, implementation, applicable tests, exact commands, actual results, successful **and** unsuccessful authorization tests, untested behavior and why, and what is only manually verified or assumed. A UI existing is not completion.

Acceptance:

1. Environment gate passed (local Supabase stack runs) or batch reported BLOCKED.
2. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass from a clean checkout.
3. `supabase db reset` applies migrations + seed from scratch; DB lint/advisors reviewed.
4. Shells render at 360px and desktop, no horizontal scroll, keyboard navigable; axe shows no serious/critical violations on shell pages.
5. DB/RLS/function tests (allowed **and** denied), run as the relevant roles: customer cannot read another profile; user cannot edit own role; non-admin cannot grant roles; admin at aal1 cannot grant roles; nobody can UPDATE/DELETE `audit_events`; anon cannot read protected data; vendor-A member cannot read vendor-B rows; rider cannot read other riders' rows; registered customer at aal1 is denied the stub order-placement operation while aal2 succeeds; every `SECURITY DEFINER` function has fixed `search_path` and restricted `EXECUTE` (asserted via `pg_proc`/privilege queries); parallel-connection harness exists and is exercised on a stub atomic function.
6. Server guard tests: anon, wrong role and aal1 are rejected on protected routes; correct role + aal2 passes.
7. MFA verified on the local stack: enroll → sign out → sign in requires code → wrong code rejected → factor removal requires aal2 → session behavior after factor change as observed. Recovery tests per the approved 1.3 outcome; if blocked, report BLOCKED with the limitation. Backup-factor behavior tested for the roles that need it under policy.
8. Secret scan clean; service-role key absent from the client bundle (automated).
9. No geolocation API calls; no payment/map provider calls; no network calls to external services other than the local Supabase stack.

Tests: unit (money formatting, guard logic, env validation); DB (above); integration (auth-guard matrix from a permission table); E2E Playwright mobile viewport (public browse, sign-up, sign-in, MFA, role-shell access); axe on every shell. Classify each as passed / failed / not run / blocked by credentials / manual / external approval. Do not claim untested behavior passes.

---

# PART 6 — REQUIRED REPORT

At the end of Batch 1 provide: (1) executive summary; (2) requirements coverage (implemented+verified / implemented not verified / partial / not implemented / blocked); (3) exact files changed; (4) frontend and backend implementation summary; (5) database schema, migrations, RLS policies and security-function summary; (6) authentication and MFA behavior, including recovery limitations; (7) test commands and results; (8) what worked; (9) what failed or remains incomplete; (10) security concerns and technical debt; (11) dependencies, cost implications and external-service requirements; (12) decisions/assumptions needing owner approval; (13) manual verification still needed; (14) completion status — COMPLETE / CONDITIONALLY COMPLETE / INCOMPLETE / BLOCKED, with justification; (15) the complete, self-contained proposed prompt for **Batch 2 (Phases 3+4)** with any corrections discovered during Batch 1 placed **at the beginning**.
Also a separate **INDEPENDENT REVIEW PACKAGE FOR CHATGPT**: report, relevant diffs/code excerpts, migration and RLS summaries, test results, unresolved defects, proposed next-batch prompt. Self-review your diff as an independent engineer first and fix in-scope defects. Do not claim ChatGPT or the owner has reviewed the implementation until evidence has been submitted and that review has taken place.

---

# PART 7 — STOP CONDITIONS

Stop and report (do not bypass) if: the local Docker/Supabase stack cannot run; a security-critical requirement cannot be implemented safely; secure MFA recovery cannot be verified (stop before implementing recovery); a verified technical blocker requires an architecture change (propose, wait for approval); any step would need a remote database, paid service, real credential, deployment, real payment, live tracking, or real AFIT location data. Local-first, synthetic data only. Do not begin Phase 3 or later. **Stop after Batch 1 and wait for the owner's explicit approval before Batch 2.**
