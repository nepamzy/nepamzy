# PROMPT — AFIT Market Implementation Batch 1 (Phases 1 + 2)

> Self-contained. Paste into Claude Code in the AFIT Market repo. Do **only** this batch, then stop and report.

## 1. Project context
AFIT Market is a mobile-first campus marketplace for the approved AFIT (Air Force Institute of Technology, Nigeria) community: customers order from approved vendors, choose pickup or delivery, track riders live, and confirm handover with a mandatory electronic signature plus optional QR/in-app code. Roles: customer, vendor (owner/staff), rider, support agent, finance admin, platform admin. Full requirements are in `docs/handoff/` (read all nine files first; `DECISIONS_AND_OPEN_GATES.md` is the decision register) and the Phase 0 report in `docs/phase-0/PHASE_0_REPORT.md`. You act as architect, designer, full-stack engineer, security engineer and QA. Never claim a feature works without executed evidence.

## 2. Confirmed architecture (approved at Phase 0 — verify the user approved before starting)
Modular monolith: Next.js App Router + React + TypeScript (strict) + Tailwind, PWA; Supabase Postgres/Auth(TOTP MFA)/RLS/Realtime/private Storage; pnpm; Vitest; Playwright + axe; Supabase CLI local stack. Atomic/tamper-sensitive rules live in `SECURITY DEFINER` SQL functions (fixed `search_path`, actor from `auth.uid()`); direct INSERT/UPDATE/DELETE on sensitive tables is revoked from `authenticated`. Service-role key is server-only. Money = integer kobo. Providers behind adapters with mocks. No microservices, no integration-middleware platforms (Nango, Composio, Pipedream, Make, Zapier). No paid service enabled.

## 3. Existing implementation
Repo contains only `docs/`. Nothing else exists. (The GitHub repo may have been renamed `afit-market` by the owner.)

## 4. Batch 1 scope

### Phase 1 — Foundation and design system
- Scaffold Next.js + TS strict + Tailwind + ESLint + Prettier + Vitest + Playwright; scripts: `dev, build, start, lint, typecheck, test, test:db, test:e2e, format`. Create `.env.example` with placeholders only; `.gitignore` excluding env files; env validation module (zod) that fails fast and never prints values; `server-only` guard on service-role client.
- Folder structure per Phase 0 §D. Create empty module folders only as needed.
- Design system (distinct, modern, trustworthy, not a clone of another product): tokens (type scale, colour with WCAG AA contrast, spacing, radius, elevation, motion with `prefers-reduced-motion`), light/dark if cheap; components: Button, IconButton, Input, Select, Textarea, Checkbox/Radio, Card, Badge/StatusPill, Tabs, Dialog, Toast, Skeleton/Loading, EmptyState, ErrorState, OfflineBanner, Retry, Stepper/Timeline, Money (₦ from kobo), BottomNav, Sidebar, Table. 44px minimum touch targets, visible focus, labelled controls, plain-language copy (no jargon such as "webhook", "token", "RLS" shown to users).
- Four role shells with navigation and **mock data only**: customer (home, vendor list placeholder, cart placeholder, orders, account), vendor (dashboard, orders, catalogue, handover), rider (go-active placeholder with consent copy, jobs, profile — **no geolocation calls in this batch**), admin (dashboard, applications, audit). Status vocabulary component showing all order states from the handoff.
- PWA basics: manifest, icons placeholders, offline fallback page. No push, no location.
- Security headers + strict CSP in `next.config`; no secrets in client bundle (add a CI/script check).
- `pnpm` scripts + a GitHub Actions workflow running lint, typecheck, unit tests, build (no secrets, no deploy).

### Phase 2 — Supabase schema, auth, roles, MFA
- `supabase init`; explicit SQL migrations in `supabase/migrations`. Verify Docker/local stack works; if not, report BLOCKED rather than using a remote project without owner approval.
- Tables (RLS enabled on **every** table, explicit policies): `profiles`, `role_assignments`, `mfa_recovery_codes`, `audit_events` (append-only), `platform_settings`, plus **stub-only** reference tables needed for policy tests (`vendors`, `vendor_staff`, `rider_profiles`) with minimal columns. Do not build later-batch tables yet, but design keys so they fit Phase 0 §F.
- Helper SQL functions: `current_roles()`, `has_role(role)`, `is_aal2()` (reads `auth.jwt()->>'aal'` — **verify against current Supabase docs**), `is_vendor_member(vendor_id)`.
- Profile auto-creation on signup via trigger; users cannot write their own roles; role grants only by `platform_admin` through an audited function that requires aal2; every grant/revoke writes `audit_events`.
- Append-only triggers + revoked grants on `audit_events` (no UPDATE/DELETE for anyone, including admin).
- Auth: email+password sign-up/in with Supabase Auth (SSR cookies via `@supabase/ssr`); email verification flow configured for local; session refresh middleware; sign-out; sensitive-action re-auth.
- MFA (TOTP): enroll with QR + manual secret, verify, challenge at sign-in, list/remove factors (removal needs aal2), session upgrade to aal2. **Recovery:** generate 10 single-use recovery codes at enrollment, store only hashes, show once, regenerate on demand (needs aal2); recovery-code login path that is rate-limited and audited; account-recovery for lost factor = request → two distinct platform admins approve (both aal2) → factor reset audited. No single support agent can reset MFA. Document that Supabase may not provide built-in TOTP recovery (verify) and what was custom-built.
- Policy: admins (platform_admin, finance_admin, support_agent), vendor roles and rider roles **must be aal2** for any privileged route/function/table policy; customers optional for browsing/ordering but required for sensitive actions (change email, remove factor, view account security). Enforce in (a) Next.js middleware/server guards, (b) RLS/SQL functions, (c) never UI-only. Provide a single `requireAuth({roles, aal})` server utility and use it everywhere.
- Protected routes: unauthenticated → login; wrong role → 403 page; aal1 on privileged → MFA challenge/enroll page.
- Seed: synthetic users/roles only (documented, local-only, obviously fake). No real coordinates, names or AFIT data.
- Rate limiting for login, MFA verify and recovery-code endpoints (DB-backed counter or in-memory with documented limitation).
- Redacting structured logger; request IDs; never log passwords, tokens, secrets.

## 5. Required docs (create/update)
`docs/adr/0001-architecture.md`, `docs/requirements-checklist.md` (every item from the 35-section brief with status), `docs/database.md`, `docs/security-privacy.md` (MFA policy, recovery design, threat table), `docs/environment.md`, `docs/testing.md`, `docs/known-issues.md`, `docs/review-log.md`, `docs/external-approvals.md`, `docs/reports/batch-1.md`, `README.md` (how to run locally).

## 6. Acceptance criteria
1. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass from clean checkout.
2. `supabase db reset` applies all migrations + seed from scratch with no errors.
3. All four role shells render at 360px and desktop; no horizontal scroll; keyboard navigable; axe reports no serious/critical violations on shell pages.
4. RLS tests (allowed **and** denied): customer cannot read another profile; user cannot edit own role; non-admin cannot grant roles; admin at aal1 cannot grant roles; nobody can UPDATE/DELETE `audit_events`; anon cannot read anything protected; vendor member of A cannot read vendor B stub rows; rider cannot read other riders' rows.
5. Server tests: privileged route returns redirect/403 for anon, wrong role, and aal1; passes for correct role + aal2 (mock or real local session).
6. MFA E2E on local stack: enroll → sign out → sign in requires code → wrong code rejected → recovery code works once and not twice → factor removal requires aal2. Mark any step that cannot be automated as "manual verification required".
7. Secret scan finds nothing; service-role key absent from client bundle (automated check).
8. No geolocation API calls anywhere; no network calls to payment/map providers.

## 7. Required tests (write as you go; report honestly)
Unit: money formatting, role/aal guard logic, recovery-code generation/hash/consume, env validation. DB: items in 6.4 plus constraint tests. Integration: auth guard matrix generated from a permission table. E2E (Playwright, mobile viewport): sign-up, sign-in, MFA flows, role shell access. Accessibility: axe on every shell. Classify every test run as passed / failed / not run / blocked by credentials / manual / external approval.

## 8. Known issues to fix or handle from Phase 0 review
- Verify (don't assume) Supabase MFA `aal` claim in RLS, TOTP recovery support, and current package versions; record findings in `docs/review-log.md`.
- Decide and document Docker availability; if unavailable, stop and ask.
- Add any corrections the independent ChatGPT review of Phase 0 produces: **[none yet — owner to insert here]**.

## 9. Constraints and prohibitions
Local-first only. No deployment, no production data, no real messages/payments/refunds/payouts, no live tracking, no real AFIT locations. No secrets committed or printed. No later-batch features (vendor catalogue, orders, payments, riders' GPS, proofs, refunds). No unnecessary dependencies; justify each new package in the report. Do not weaken or drop any requirement from the handoff pack. Preserve all previous docs.

## 10. Required reporting
Finish with the full 15-section report (A–O) from the master brief — executive summary, requirements coverage (implemented+verified / implemented not verified / partial / not implemented / blocked), files changed, frontend review, backend & DB review, security review, test report (exact commands + results), successes, failures/incomplete, tech debt, costs/dependencies, decisions/assumptions, manual verification steps, completion assessment (COMPLETE / CONDITIONALLY COMPLETE / INCOMPLETE / BLOCKED), and the **complete self-contained prompt for Batch 2 (Phases 3+4)**, plus an "INDEPENDENT REVIEW PACKAGE FOR CHATGPT" (report, changed files, test results, decisions, defects, security-critical diffs, migration/RLS summaries, next prompt). Review your own work as an independent engineer before declaring done.

## 11. Stop
**Stop after Batch 1.** Do not start Batch 2 until the owner explicitly approves.
