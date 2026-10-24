# Batch 1 Completion Report — Phases 1 and 2

Date: 2026-10-10 · Branch `claude/afit-market-phase-0-asm8xd` · PR #1 (draft) · Prompt version: `docs/phase-0/BATCH_1_PROMPT.md` v3 (owner-approved).

**Completion status: CONDITIONALLY COMPLETE.** Every acceptance criterion passed with evidence except the one the prompt told me to stop on: **MFA recovery after losing all authenticators is deliberately not implemented and needs an owner decision** (criterion 7, recovery part). Details in §N.

---

## A. Executive summary

Batch 1 delivers a working, tested foundation: a mobile-first Next.js PWA with a design system and four role-specific shells; Supabase auth with email confirmation; mandatory TOTP two-step sign-in enforced **both in the application and in the database**; roles with audited, administrator-only grants; an append-only audit trail; rate limiting; and an automated test suite (53 unit, 30 database, 110 browser tests) that exercises both permitted and forbidden actions against a real local Supabase stack.

Most of the screens are still previews with sample data and say so on the page. The marketplace itself (catalogue, cart, orders, payments, riders, proof, refunds) is not built; it is Batches 2–6. Nothing is deployed, no external service is used, no real data or money is involved.

Two things need you:

1. **Decide how lost-authenticator recovery should work** (or accept "contact support, account stays locked until a designed process exists"). Findings are in §F and `docs/security-privacy.md` §3.
2. **Decide whether to require a backup authenticator for privileged roles** and whether to force MFA enrolment at sign-up (see §L).

## B. Requirements coverage

Legend: **IV** implemented and verified · **INV** implemented, not fully verified · **P** partial · **NI** not implemented · **B** blocked on owner.

| #   | Requirement (Batch 1)                                                                                                        | Status                                                                                                                                                     | Evidence                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Environment gate: local Supabase stack runs                                                                                  | IV                                                                                                                                                         | Docker daemon started locally; stack up; `docs/review-log.md`                                    |
| 2   | Clean install, `lint`, `typecheck`, `test`, `build`                                                                          | IV                                                                                                                                                         | Run from a fresh `git clone` (§G)                                                                |
| 3   | `supabase db reset` from scratch + DB lint                                                                                   | IV                                                                                                                                                         | Applied cleanly; "No schema errors found"                                                        |
| 4   | Shells render at 360px and desktop, no horizontal scroll, keyboard usable, axe serious/critical = 0                          | IV for automated checks; **manual a11y not done**                                                                                                          | `public-and-a11y.spec` (18 tests x 2 viewports, incl. every role shell and the skip link)        |
| 5   | RLS/function tests (allowed and denied) incl. customer/role/aal cases, hardened functions, harness                           | IV                                                                                                                                                         | 30 DB tests                                                                                      |
| 6   | Server guard tests (anon / wrong role / aal1 rejected; correct role + aal2 passes)                                           | IV                                                                                                                                                         | unit matrix + e2e matrix (HTTP 403)                                                              |
| 7a  | MFA flows on local stack: enrol, sign-out, challenge, wrong code, factor removal needs aal2, session behavior, backup factor | IV                                                                                                                                                         | e2e + API-behavior pins                                                                          |
| 7b  | **Recovery after losing all factors**                                                                                        | **B**                                                                                                                                                      | Owner decision gate                                                                              |
| 8   | Secret scan; service-role key absent from client bundle                                                                      | IV                                                                                                                                                         | `check:secrets`, unit boundary test                                                              |
| 9   | No geolocation / payment / map provider calls                                                                                | IV by inspection and grep (no code references; CSP `connect-src 'self'`; Permissions-Policy denies geolocation); not covered by a dedicated automated test | —                                                                                                |
| P1  | Design system and components                                                                                                 | IV                                                                                                                                                         | `/design` + axe                                                                                  |
| P1  | Role shells with mock data; Go Active preview without geolocation                                                            | IV                                                                                                                                                         | e2e                                                                                              |
| P1  | PWA basics incl. offline fallback                                                                                            | IV (SVG-only icon is a placeholder)                                                                                                                        | e2e offline test                                                                                 |
| P1  | Security headers + nonce CSP                                                                                                 | IV                                                                                                                                                         | e2e header test                                                                                  |
| P1  | CI workflow                                                                                                                  | INV                                                                                                                                                        | Written; **not executed on GitHub in this session**                                              |
| P2  | Core tables, RLS everywhere, audit append-only, role grants audited                                                          | IV                                                                                                                                                         | DB tests                                                                                         |
| P2  | Auth (email+password, confirmation, session refresh, sign-out)                                                               | IV                                                                                                                                                         | e2e journey with a real confirmation email via the local sink                                    |
| P2  | `requireAuth`, route behavior (login / 403 / MFA pages)                                                                      | IV                                                                                                                                                         | unit + e2e                                                                                       |
| P2  | Rate limiting (login, MFA) + audited failures                                                                                | IV                                                                                                                                                         | e2e                                                                                              |
| P2  | Redacting logger, request IDs                                                                                                | P                                                                                                                                                          | Logger unit-tested; request ID set by proxy but not yet propagated into log lines                |
| P2  | Seed of synthetic users                                                                                                      | INV                                                                                                                                                        | `scripts/seed-local-users.mjs` written; not run in the final session (e2e creates its own users) |
| P2  | Email verification locally                                                                                                   | IV                                                                                                                                                         | custom sink + forwarder                                                                          |

## C. Files changed

All paths are new unless noted (repo previously held only a profile `README.md`, removed at the owner's request).

- **App:** `src/app/**` (routes: public, auth, MFA, account, orders, vendor, rider, admin, design, offline, forbidden, 404, error, manifest), `src/proxy.ts` (session refresh + nonce CSP), `next.config.ts`.
- **Design system:** `src/components/ui/*` (button, fields, card, badge, states, tabs, dialog, toast, timeline, table, money), `src/components/domain/order-status.tsx`, `src/components/shells/*`, `src/components/auth/*`, `src/app/globals.css` (tokens).
- **Identity & access module:** `src/server/modules/identity-and-access/{policy,guard,security,actions,admin-actions}.ts`.
- **Lib:** `src/lib/{env,money,logger}.ts`, `src/lib/supabase/{server,service}.ts`, `src/mocks/data.ts`.
- **Database:** `supabase/migrations/20261010000001_core_identity.sql`, `supabase/config.toml` (TOTP on, email confirmation on, password policy, local SMTP), `supabase/templates/confirmation.html`, `supabase/seed.sql` (no users).
- **Scripts:** `scripts/{dev-db,db-reset,mail-forwarder}.sh`, `mail-sink.mjs`, `check-secrets.mjs`, `seed-local-users.mjs`.
- **Tests:** `tests/db/{helpers,rls,schema-hygiene,concurrency}`, `tests/e2e/{helpers,public-and-a11y,auth-guards,customer-journey,admin-roles,mfa-api-behavior}.spec.ts`, `tests/unit/guard-coverage.test.ts`, `src/**/*.test.ts`.
- **Tooling:** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `postcss.config.mjs`, `.prettierrc`, `.gitignore`, `.env.example`, `.github/workflows/ci.yml`.
- **Docs:** `README.md` (rewritten), `docs/{adr/0001-architecture,database,environment,testing,security-privacy,known-issues,requirements-checklist,review-log,external-approvals}.md`, `docs/phase-0/*`, this report. `docs/handoff/` unchanged.
- **Removed:** `src/app/loading.tsx` (caused HTTP 200 on 403/404; see §I).
- **Secrets:** none committed. `.env.local` is git-ignored; the local-stack demo keys never appear in tracked files (scanned).

Size: ~126 files, ~5,500 lines added (excluding lockfile and handoff docs).

## D. Frontend review

- **Screens:** home, vendor list/detail (sample), sign-in, sign-up, MFA enrol, MFA challenge, account, security (authenticators), customer orders (sample), vendor home/orders/catalogue/handover (sample/preview), rider home (Go Active preview with consent text)/jobs/profile, admin home/applications (sample)/audit (**real** data via RLS)/roles (**real** form), design reference, offline, 403, 404, error.
- **Components:** Button, IconButton, ButtonLink, Input, Select, Textarea, Checkbox, Radio, Card, PageHeader, Badge, Tabs (arrow-key), Dialog (native `<dialog>`), Toast, Skeleton/Loading, EmptyState, ErrorState, RetryButton, OfflineBanner, Timeline, Table (focusable scroll region), Money (₦ from kobo), BottomNav, Sidebar, order-status pills for all 23 handoff states.
- **Responsive:** 360px mobile uses a bottom navigation; ≥768px uses a sidebar. Automated check: no horizontal overflow on any page.
- **Accessibility:** WCAG 2.1 A/AA axe scan found and I fixed one real defect (table scroll region not keyboard-focusable). Skip link, labelled controls, 44px targets, visible focus, `prefers-reduced-motion`, live regions for toasts. **Not done:** screen-reader and real-keyboard walkthroughs, zoom/large-text checks, colour-blind review.
- **States:** loading skeleton component, empty, error (with retry), offline banner + service-worker offline page. There is no route-level `loading.tsx` on purpose (§I).
- **Known UI defects/limits:** sample-data pages are static; no dark mode; icon is a single SVG (no PNG sizes); Go Active and vendor handover are non-functional previews, labelled as such; no i18n.

## E. Backend and database review

- **Server operations:** sign-up, sign-in, sign-out, MFA start/verify/challenge/remove, role change (admin), email-confirm route. All are server actions/route handlers.
- **Schema, functions, policies:** see §E-detail below and `docs/database.md`.
- **Transactions/atomicity:** `stub_claim_slot` uses `SELECT … FOR UPDATE`; 12 parallel connections on a capacity-5 slot produce exactly 5 successes (Tested). It is a stub that proves the harness; the real rule arrives in Batch 4.
- **State transitions:** none yet.

### E-detail: schema, RLS and security-function summary

- Tables (all RLS): `profiles`, `role_assignments`, `audit_events`, `platform_settings`, `vendors`_, `vendor_staff`_, `rider_profiles`_, `stub_order_placements`_, `stub_capacity_slots`*, `app_private.rate_limit_events` (*stub).
- Grants: `anon` has nothing. `authenticated` can only SELECT (through RLS) and UPDATE `profiles.display_name`.
- Permissive policies grant self/ownership/staff reads; RESTRICTIVE policies on every exposed table require `mfa_satisfied()` (aal2 for anyone holding a non-customer role); profile edits and stub orders require aal2 for everyone.
- Functions: `grant_role`, `revoke_role`, `set_platform_setting`, `stub_place_order`, `stub_claim_slot`, `my_roles` (authenticated); `rate_limit_hit`, `record_security_event` (service role only); internal `audit_write`, triggers. All SECURITY DEFINER functions set `search_path`, revoke EXECUTE from PUBLIC/anon, check identity/role/aal inside.
- Audit: triggers reject UPDATE/DELETE/TRUNCATE for every role including the owner.

## F. Security review

- **Authentication and MFA:** password + emailed confirmation; TOTP via Supabase Auth. Policy and enforcement per §1 of `docs/security-privacy.md`. Verified Supabase behaviors (local GoTrue v2.197.0), pinned by tests: `aal` claim; aal2 required to unenroll or to add a factor once one is verified; first verified factor revokes other sessions; password/email change needs aal2; **TOTP replay inside the 30 s window is accepted**; **no server-side limit on wrong TOTP guesses** (we add one); experimental recovery-code factor is unavailable; admin-API factor deletion leaves other sessions alive; removing the last factor leaves password-only.
- **Recovery:** backup authenticator implemented and tested; lost-all-factors recovery **not implemented** (gate). The only technically available admin route would downgrade the account to password-only and not revoke sessions; a safe design needs owner/AFIT decisions on identity proof and approvals (details in `security-privacy.md` §3).
- **Authorization checks:** central policy table + guard-coverage test; every protected layout calls `enforceRoutePolicy`; server actions re-check; database independently enforces. A captured admin server-action request replayed by a support agent and a plain customer was refused by the action itself and changed nothing (Tested).
- **Secrets:** service-role key server-only; scan clean; no `NEXT_PUBLIC_`.
- **Input validation:** zod on every action input; `next` redirect target sanitised (open-redirect test).
- **Abuse prevention:** DB-backed rate limits (fail closed); generic error messages; hashed identifiers in audit.
- **Known weaknesses:** S1–S8 in `security-privacy.md` §4 (TOTP replay window, first-factor enrolment at aal1, deliberate lockout, spoofable IP header without proxy, `unsafe-inline` styles, sign-out is per-session, scanner-consumed links, experimental `forbidden()`).
- **Findings from my own adversarial review of the diff** (all dealt with or recorded): trigger functions were executable by PUBLIC (found by the catalog test, fixed); root `loading.tsx` turned 403/404 into 200 (found by e2e, fixed); form reset cleared the email on failed sign-in (fixed); table scroll region not keyboard-accessible (fixed).

## G. Test report (exact commands and actual results, final run on the committed code)

| Command                                                                                                                        | Result                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `pnpm lint`                                                                                                                    | exit 0, no warnings                                                   |
| `pnpm typecheck`                                                                                                               | exit 0                                                                |
| `pnpm format:check`                                                                                                            | all files conform                                                     |
| `pnpm test`                                                                                                                    | **53 passed** (5 files)                                               |
| `pnpm test:db`                                                                                                                 | **30 passed** (3 files) against the local Postgres                    |
| `pnpm build`                                                                                                                   | success; all routes dynamic                                           |
| `pnpm check:secrets`                                                                                                           | OK (tracked files + 18 client bundle files + 2 secret values checked) |
| `supabase db lint --level warning --schema public,app_private`                                                                 | "No schema errors found"                                              |
| `pnpm exec playwright test` (projects `mobile-360` and `desktop`)                                                              | **110 passed** (55 tests × 2 viewports)                               |
| Clean checkout (`git clone`, `pnpm install --frozen-lockfile`, lint, typecheck, test, build with placeholder env, secret scan) | all passed                                                            |

Mutation check: dropping the aal2 policy on `stub_order_placements`, the MFA policy on `vendors`, and a function's `search_path` made 4 DB tests fail; restoring made all pass.

**Not run / not covered:** DB tests and e2e in GitHub Actions (CI workflow itself never ran on GitHub); real Android/iOS devices; screen readers; production hosting; load; actual email delivery; the final e2e run was on a Chromium shipped with this sandbox. **Test-process corrections:** early e2e failures were caused by tests racing server actions (navigating before the action finished, form reset wiping input); fixed by waiting for the POST response and form reset — not by weakening assertions.

## H. What worked (demonstrably)

- Whole customer journey: sign up → real confirmation email → single-use link → sign-in → MFA required at `/orders` → TOTP enrol → sign-out/in with challenge → add backup → sign in with backup only.
- 403s are real HTTP 403 for every wrong-role case in the matrix; anonymous users are redirected with the destination remembered; open redirects ignored.
- Privileged roles cannot read even their own profile at aal1 (database); customers cannot place the stub order at aal1.
- Admin role changes: audited, self-change refused, non-admin replay refused.
- Brute-force limits on login and TOTP, with audit rows that contain no raw emails.
- Offline fallback served by the service worker; strict nonce CSP differs per request; cookies HttpOnly.

## I. Failed or incomplete work

| Item                                           | Severity          | Effect                                               |
| ---------------------------------------------- | ----------------- | ---------------------------------------------------- |
| Lost-all-factors recovery                      | High (owner gate) | Such accounts are locked; no bypass exists by design |
| CI never executed; DB/e2e not in CI            | Medium            | Regressions rely on local runs until Batch 2         |
| Manual accessibility / device testing not done | Medium            | Automated checks only                                |
| Request ID not yet in log lines                | Low               | Observability gap                                    |
| Seed script not run in final session           | Low               | Manual-testing convenience                           |
| Stub tables and mock screens                   | Info              | Replaced in Batches 2–4                              |

## J. Technical debt

Stub tables (`vendors`, `vendor_staff`, `rider_profiles`, `stub_*`) will be migrated/replaced; `style-src 'unsafe-inline'`; experimental `forbidden()`; rate-limit tables have no purge job; sample data lives in `src/mocks`; Docker/registry/mail workarounds are sandbox-specific; Prettier pass reformatted many files in one commit.

## K. Costs and dependencies

No paid service used. **Runtime deps:** next, react, react-dom, @supabase/supabase-js, @supabase/ssr, zod, server-only. **Dev deps:** typescript 5.9.3, tailwindcss + postcss plugin, eslint 9 + next config, prettier, vitest, playwright + axe, supabase CLI, pg, otpauth, smtp-server + mailparser (local mail sink only), type packages. Version choices and why (TypeScript 5.9 rather than 7.0; ESLint 9 rather than 10) are in the ADR. Future recurring costs (all **estimates, unverified**): Supabase Pro for the pilot, hosting, Paystack per-transaction fees, map provider (Batch 4), domain.

## L. Decisions and assumptions needing owner approval

1. MFA recovery for lost-all-factors (see §N; options: (a) none, support-assisted only after a designed process; (b) dual-admin reset with identity proof; (c) mandatory backup authenticator for privileged roles plus (a)).
2. Require a backup authenticator for privileged roles? (Currently optional/encouraged; **I did not impose it.**)
3. Force TOTP enrolment at sign-up for all customers (closes S2) versus at first order (current, matches your policy)?
4. Accept the TOTP replay window and account-scoped lockout trade-offs (S1, S3)?
5. Every account holds the default `customer` role, so vendors/riders/admins can also open customer pages (at aal2). Confirm this is intended.
6. Hosting must provide a trusted proxy setting `X-Forwarded-For` (S4).
7. Assumptions still **Unverified**: Paystack behavior; PWA GPS on Android; retention periods; AFIT approvals.

## M. Manual verification still needed

1. `pnpm db:start`, copy `.env.example` to `.env.local` with local values, `pnpm dev`, open http://127.0.0.1:3000 on a phone-sized window.
2. Sign up with any `@example.test` address; read the confirmation link at `http://127.0.0.1:54326/messages` (local sink). Confirm, sign in, open **My orders** → set up an authenticator on your real phone with the on-screen key.
3. `node --env-file=.env.local scripts/seed-local-users.mjs` for vendor/rider/admin accounts; check the 403 pages and the audit trail.
4. Screen-reader (TalkBack) and keyboard-only walkthrough; browser zoom 200%; install the PWA on an Android phone and check the offline page.
5. Review `docs/security-privacy.md` §3–§4 and answer §L.

## N. Completion assessment

**CONDITIONALLY COMPLETE.** All acceptance criteria 1–9 passed with executed evidence, except the recovery portion of criterion 7, which the approved prompt required me to stop on. The gap is non-blocking for Batch 2 (catalogue and checkout preparation) because no customer-facing recovery promise is made anywhere, but it blocks any pilot with real privileged users. It also affects launch readiness (Batch 6).

## O. Next phase prompt

See `docs/reports/batch-2-prompt.md` (complete, self-contained; corrections from this batch are at the top).

---

# INDEPENDENT REVIEW PACKAGE FOR CHATGPT

_I have not claimed any review of this implementation has taken place. Everything below is evidence for the owner to submit._

1. **Report:** this file.
2. **Changed files:** §C. Full list: `git diff --stat <initial-commit>..HEAD -- . ':!docs/handoff' ':!pnpm-lock.yaml'`.
3. **Test results:** §G. Raw logs were produced under `/tmp` in the cloud session; re-run locally with the commands above.
4. **Key decisions:** server-only Supabase access (HttpOnly cookies); restrictive RLS for aal2; central route-policy table + guard-coverage test; no custom recovery codes; rate limits fail closed; removal of root `loading.tsx` to keep real 403/404 statuses; TypeScript 5.9.3/ESLint 9 pins.
5. **Known defects and unresolved issues:** §I, §L, `docs/known-issues.md`.
6. **Security-critical excerpts:**
   - Restrictive MFA predicate (migration):
     ```sql
     create function app_private.mfa_satisfied() returns boolean language sql stable security definer set search_path = ''
     as $$ select app_private.is_aal2() or not app_private.has_privileged_role() $$;
     create policy vendors_mfa on public.vendors as restrictive for all to authenticated using (app_private.mfa_satisfied());
     ```
   - Role grant (migration): checks `auth.uid()`, `app_private.is_aal2()`, `has_role('platform_admin')`, refuses self-change, audits.
   - Access decision (`policy.ts`): privileged roles require aal2 even when a route only says aal1, except MFA setup pages.
   - Server-action recheck (`admin-actions.ts`): `checkAccess({ roles: ['platform_admin'], aal: 'aal2' })` before calling the RPC.
7. **Migration/RLS summary:** §E-detail and `docs/database.md`.
8. **Next-batch prompt:** `docs/reports/batch-2-prompt.md`.

**Suggested review questions:** (1) Is the recovery gate decision framed correctly? (2) Is relying on the `aal` JWT claim in RESTRICTIVE policies sufficient given a ≤1 h token lifetime after a factor is removed (existing aal2 token stays valid until refresh)? (3) Are the rate-limit trade-offs (account lockout vs brute force) acceptable? (4) Is enforcing MFA only at first order (not at sign-up) acceptable for customers? (5) Anything in the test design that could pass while the control is broken?
