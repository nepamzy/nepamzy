# Owner review and next steps

**Prepared 2026-10-13 from repository HEAD `f36871207b697c411315a329ed06051fa7b56a27`; decision-gate update (sections 6 to 11) made on top of `645f9caa23a2b3a17a9da01e164825e2468cdbf2`** (branch `claude/afit-market-phase-0-asm8xd`, clean working tree, identical to `origin`). This stage changed documentation only: no application code, test, token, layout, crest, policy, authorization or migration was touched. **Nothing here is an approval; every decision below is still the owner's.**

## 1. Current state (evidence, not assumption)

| Topic                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                    | Level                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Features of the six batches | Code exists (accounts and MFA, marketplace, payments in test mode against a local fake, orders, riders and location with synthetic data, delivery proof, refunds/returns/reports with a fake provider, notifications with a local sink, reviews and moderation, administration, settings, job-health)                                                                                       | Implemented                             |
| Local tests                 | Full independent run on `3b91801`: lint, typecheck, build, secret scan, DB lint, `pnpm audit --prod` pass; unit 264, DB 313, Playwright 176 passed; restore drill matched (`docs/reports/post-batch-6-verification.md`). **Not repeated on `f368712`**                                                                                                                                      | Locally verified (for `3b91801`)        |
| CI                          | #27 `342ba44` passed; **#29 `babd63a` failed** (the job-monitoring E2E test only; kept on record); #31 `888710a` passed; #33 `3b91801` passed; #35 `f368712` passed. A pass proves the adjusted test passes, not what caused the #29 failure                                                                                                                                                | CI verified per SHA                     |
| Visual audit                | 50 page routes, all captured at 360x800 and 1440x900; 93 states, 186 PNGs; admin side implemented and working; reviewed by the engineer only. Not captured: Paystack screens, live GPS tracking, populated rider-offer list, filed review reports, pending applications, loading skeletons, executed refunds. Files verified present this stage: 186 PNGs, PDF (3.9 MB), CSV/MD inventories | Engineer-reviewed; owner review pending |
| Accessibility               | axe + scripted keyboard/focus/320 px checks pass; no screen-reader, real-device or person-led review; drawn signature has no keyboard path                                                                                                                                                                                                                                                  | Partly verified                         |
| Everything external         | Real Paystack (K19, K29, K30), Android background GPS (K34), independent security audit, AFIT authorisation, crest and colours: **none verified or obtained**                                                                                                                                                                                                                               | Unverified / blocked                    |

**Still not pilot-ready.** Reasons, in order of weight: no AFIT authorisation; no approved delivery points, zones, rider/vendor terms or rider verification; payments and refunds only ever exercised against local fakes; no accessible proof alternative; retention, privacy, incident-response and support arrangements undecided; jobs not scheduled and nobody alerted; no independent security review; background GPS unverified. See `docs/pilot-readiness.md`.

## 2. Decision register: items 28 to 31 (from `docs/owner-decisions.md`, faithfully summarised)

Wording note: the audit report and earlier hand-off described "four interface improvements"; the register's item 30 lists **five** (it also includes the empty desktop landing hero). All five are covered below.

### 28. Visual identity direction

- **Decision required:** keep the current teal-green palette, or adopt an AFIT-inspired blue/gold/red/white palette. The report's palette is illustrative, not sampled and not official.
- **Current:** brand `#0b5551` (teal-green) with burnt-orange accent; no crest or logo; no AFIT colour in use.
- **Options:** (a) keep as is; (b) tokens-only change to an AFIT-inspired palette once the official crest/brand spec is in hand (see 29); (c) a neutral palette unrelated to AFIT.
- **Advantages / trade-offs:** (a) zero risk, already measured as AA for text; no institutional look. (b) institutional look, small code change (tokens in `src/app/globals.css`, plus the PWA `theme_color` in `manifest.ts` and `layout.tsx`), but status colours must stay distinguishable from a blue primary and gold can only carry dark text (white on `#e6b422` is 1.92:1). (c) avoids permission questions.
- **Implications:** accessibility (contrast must be re-measured); no security or operational impact.
- **External dependency:** using AFIT's identity depends on AFIT authorisation (decision 1, external approval #3).
- **Blocked until decided:** any colour-token change and the before/after comparison.

### 29. Obtaining the official AFIT crest and brand specification

- **Decision required:** who obtains the official crest file and any brand guide, so colours can be sampled and recorded as official or estimated.
- **Current:** nothing held. The AFIT website was unreachable from the sandbox, so no colour was sampled and no hex is official.
- **Options:** the owner asks AFIT directly; or proceed without AFIT identity (decision 28c).
- **Trade-offs:** an official file gives defensible colours; without it any AFIT-coloured design is guesswork.
- **Implications:** none for security; licence and permission terms for the crest must be recorded with the file (external approval #33).
- **External dependency:** AFIT supplies the asset and permission.
- **Blocked until decided:** adding the crest, sampling colours, any claim that a colour is official.

### 30. Small visual and content fixes found by the audit

Five items; each is small, none is approved. Details and a plan are in `docs/reports/visual-improvement-plan.md`.

1. Input/box border contrast 2.93:1 (target 3:1) - token `--color-line-strong`, used in 12 files.
2. Phone header wraps "AFIT Market" and "Sign out" onto two lines - header in `src/components/shells/app-shell.tsx` (the "Notifications" link added in Batch 6 contributes to the crowding).
3. Vendor dashboard sentence "Order handling ... arrives in the next release. For now you can see incoming orders but not act on them." (`src/app/vendor/page.tsx`) - **inaccurate**: order actions exist.
4. Admin phone navigation shows 5 of 16 sections - the bottom bar renders `items.slice(0, 5)` of 14 navigation items (Delivery points and Categories have no navigation item and are reachable only from the `/admin` cards); it also hides the vendor "Returns" item, 6th of 6.
5. Empty right half of the desktop landing hero (no crest or imagery).

- **Advantages:** fixes a measured accessibility shortfall and misleading copy at very low risk. **Trade-offs:** item 4 needs a small navigation design choice (a "More" sheet or scrolling bar); item 5 is cosmetic and tied to the crest question. **Implications:** accessibility (items 1, 2, 4), clarity (3). No security or operational impact. **External dependency:** none (item 5 only if a crest is used). **Blocked until approved:** all five.

### 31. Accessible delivery-proof alternative

- **Decision required:** which accessible way, if any, recipients who cannot draw may complete delivery proof. Options are in `docs/accessibility-signature-proposal.md` and compared technically in section 4 of this report.
- **Current:** drawn signature mandatory; typed acknowledgement disabled; no keyboard path; the only alternative is "Get help from support" and the support exception path.
- **Advantages / trade-offs:** see section 4. **Implications:** security and legal (it can change the strength of the proof), accessibility. **External dependency:** owner + AFIT + counsel (extends decision 10). **Blocked until decided:** any alternative proof path; the current policy stays in force.

## 3. Recommended priority order

### A. Safe to prepare now (no approval needed; changes nothing approved)

- This package and the three plans (visual, proof accessibility, job operations).
- Test plans and a before/after capture procedure (reusing the existing `playwright.audit.config.ts`).
- Read-only investigation (for example confirming how the header and bottom bar render).
- A requeue-tool and scheduler design on paper (no code), and the manual accessibility checklist (exists).
- Re-running the full suite on the latest commit if you want that evidence (non-destructive on a freshly reset local database).

### B. Requires your approval first

- Colour-token changes (decisions 28/29).
- The five small fixes (decision 30). **Recommended first approval: items 1, 3 and 2** (contrast token, stale sentence, header wrapping) because they are measured or factual, tiny, and independent of branding; item 4 second; item 5 only with the crest decision.
- Any delivery-proof accessibility design (decision 31).
- Any new business or operational policy (retention, review rules, support limits).
- Building the dead-notification requeue tool (it adds a privileged database function and an admin action; see the job plan).

### C. Requires external approval or infrastructure

- Official AFIT crest and brand authorisation (AFIT).
- Real Paystack verification (owner-controlled test credentials, an approved procedure, then separate legal/financial approval for live use).
- Android background-GPS verification (real devices, `docs/testing/android-background-location-test.md`).
- Automated scheduling and alerting (hosting or CI platform choice, an alert recipient, possibly cost).
- Independent security audit (a commissioned third party).
- Person-led, screen-reader and real-device accessibility review (people and devices).

**Why the categories differ:** A cannot change behaviour or policy, so the risk is nil. B changes what users see or what counts as valid proof or policy, which only the owner may decide and which needs regression evidence afterwards. C depends on parties, credentials, hardware or money that are outside this repository, so no amount of coding can complete them.

## 4. Technical comparison for delivery-proof accessibility (decision 31)

The mandatory drawn signature stays in force until you decide. All options must keep: the one-time hashed proof token, binding to the order and the current assignment, expiry, account-holder-only completion, the token hidden from the rider, no QR, and no weakening of server checks.

| Option                                                                                                                                                                                               | Keyboard-only                                                                 | Screen-reader                                                                          | Touch / mouse / stylus    | Evidence recorded                                       | Changes proof strength?                                                                                       | Approval                           | Testing without real deliveries                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **A. Keep drawn signature; strengthen the exception path** (support-assisted release with a recorded reason)                                                                                         | Not applicable (the pad stays pointer-only); the recipient uses the help link | Link and messages are readable; the pad is announced as an image with a hint           | Unchanged                 | Existing exception audit; no new proof type             | No (unchanged)                                                                                                | Owner; operational staffing        | Existing DB/e2e tests of the exception path; add a staffing runbook                                                                 |
| **B. Keyboard-operable drawing in the same canvas** (arrow-key pen, switch access)                                                                                                                   | Focusable pad; arrows move a pen, Space toggles ink, Enter confirms           | Needs a live region describing pen state and a clear "signature captured" announcement | Pointer drawing unchanged | Same PNG evidence                                       | Arguably weaker: a keyboard-made stroke carries less personal characteristic                                  | Owner + counsel (evidential value) | Component tests with key events; Playwright keyboard path; DB tests unchanged because the PNG contract is unchanged                 |
| **C. Second proof type for opted-in recipients** (for example a one-time code shown only in the recipient's own authenticated session, confirmed by an explicit act, recorded as a different method) | Fully operable with a keyboard                                                | Plain text and form controls                                                           | Same                      | A new capture method value plus the confirmation record | **Yes: changes the meaning of proof**; the rule "typed acknowledgement is not a substitute" must be revisited | Owner + AFIT + counsel             | New DB tests (token one-time/expiry/binding, method allowlist), Playwright flow, negative tests that the rider cannot see or use it |
| **D. Assisted signing** (a named helper signs for the recipient)                                                                                                                                     | Helper uses the pad                                                           | As today                                                                               | As today                  | Helper identity and authority recorded                  | Yes: adds a third party to the proof                                                                          | Owner + AFIT + counsel             | Tests of the helper record and of audit entries                                                                                     |

No option is recommended before your decision; if you want a direction, the lowest-risk first step is A (document and staff the exception path) while counsel considers C or B.

## 5. Concise lists

**Owner decisions required before implementation:** 28, 29, 30 (five items), 31; plus the earlier open register items that block the pilot (see `docs/owner-decisions.md`: 1 to 13, 15, 18, 20 to 22, 25).

**Work that can safely proceed after approval:** token-only colour change and before/after capture (28/29 approved, crest in hand if used); the five small fixes (30); the requeue tool and a scheduler proof of concept on free infrastructure (18 and the job plan); the accessible-proof option chosen in 31 with new DB/e2e tests.

**External prerequisites and blocked tasks:** official crest and permission (blocks AFIT-coloured design and the crest); Paystack test credentials and approved procedure (blocks K19/K29/K30); real Android devices (K34); a scheduler/alert platform and recipient (blocks monitored jobs); an independent auditor (blocks any security-assurance claim); accessibility reviewers and devices; AFIT approvals for places, terms and authorisation; legal, privacy and payment review.

---

# Decision-gate update (2026-10-13, documentation only)

Nothing below is an approval, and no application file was changed. Source facts were re-read for this update (`nav-config.ts`, `nav-links.tsx`, `app-shell.tsx`, `src/app/vendor/page.tsx`, `src/app/globals.css`, `src/app/rider/layout.tsx`, `src/app/(public)/page.tsx`).

## 6. Repository verification

Branch `claude/afit-market-phase-0-asm8xd`; HEAD at the start of this update `645f9caa23a2b3a17a9da01e164825e2468cdbf2`, identical to `origin/claude/afit-market-phase-0-asm8xd`; working tree clean. `645f9ca` is a documentation-only commit; only format and lint ran on it. CI evidence is per commit: #35 passed on `f368712`; #29 (`babd63a`) failed and stays on record; no CI result is recorded for `645f9ca` or this update. The full local suite was last run on `3b91801` (unit 264, DB 313, Playwright 176) and has **not** been rerun since.

## 7. Task A: status of decisions 28 to 31

The only owner-choice record in the repository is `docs/owner-decisions.md`. Its last change is `645f9ca`, which added only an engineering note (section "2026-10-13": items 28 to 31 "None is decided") and, in the register, the four rows. No owner message approving any option is stored in the repository. The record has **not** changed since the previous report (no new owner choice appeared).

| #   | Decision                                  | Status                      | Evidence                                                           |
| --- | ----------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| 28  | Palette direction                         | **AWAITING OWNER DECISION** | `docs/owner-decisions.md` row 28 (current palette kept, unchanged) |
| 29  | Official AFIT crest / brand specification | **AWAITING OWNER DECISION** | row 29; external approval #33 open                                 |
| 30  | Five small fixes                          | **AWAITING OWNER DECISION** | row 30 ("Not changed"); no per-item approval exists                |
| 31  | Accessible delivery-proof alternative     | **AWAITING OWNER DECISION** | row 31; drawn signature remains the only path                      |

Consequence: none of the work in section 8 may start.

## 8. Task B: implementation-ready checklist for the five Decision 30 fixes (not implemented)

Common rules for all five: change only what is listed; no new permission, route removal or role-guard change; run `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm build`, the Playwright suite (axe, keyboard and 320 px specs) and a new audit capture into a **new** directory (the committed 186 screenshots stay as the "before" reference). Manual review by the owner on a phone-width and a desktop viewport after each fix. Rollback for each: revert the single commit; nothing else depends on it.

### Fix 1: input and box border contrast

- **Affected:** token `--color-line-strong` (`src/app/globals.css:13`, `#8c9a94`), used through `border-line-strong` in 12 files (inputs, selects, textareas and bordered boxes on every shell).
- **Verified current behaviour:** WCAG contrast computed from the token: 2.93:1 on white cards, 2.70:1 on the page surface `#f5f6f2`; the target for control boundaries is 3:1.
- **Minimal change:** change only the value of this one token; do not touch other colours. Candidate computed now: `#6f7f78` = 4.21:1 on white and 3.88:1 on the surface; the lightest tidy alternative that passes both is about `#7a8a83` (3.63 and 3.34). The owner picks the strength; either is a one-line change.
- **Must keep working:** every form on every role (sign-in, checkout, vendor catalogue, admin filters, settings); focus ring unchanged (brand-600, 3 px).
- **Checks:** mobile 360 and desktop 1440 captures of sign-in, checkout, vendor catalogue and admin settings before and after; recompute all text pairs (none may fall below 4.5:1).
- **Tests to add/update:** a unit test that computes the contrast of the token against white and the surface and fails below 3:1; axe runs already exist.
- **Dependency:** none on 28/29 if only this token changes. If 28 later changes the palette, this token is re-derived there (do not do both separately).

### Fix 2: crowded phone header

- **Affected:** `src/components/shells/app-shell.tsx` header (shared by every shell that uses `AppShell`).
- **Verified current behaviour:** one flex row (`justify-between gap-3`, `px-4`) holds the wordmark link (shown below `md`), the `Notifications` link (added in Batch 6), the signed-in email (`hidden sm:inline`, so absent at 360 px) and the `Sign out` button. At 360 px the wordmark, the Notifications text link and the button compete for roughly 328 px; none has `whitespace-nowrap`, so the wordmark and the button label wrap (as captured in the audit).
- **Minimal change:** keep every element; prevent wrapping (`whitespace-nowrap` on the wordmark and button), tighten the gap below `sm` (`gap-2`), and allow the wordmark to shrink its font size one step on phones. If it still does not fit at 320 px, let the header wrap as a whole (two tidy rows) rather than breaking words. Do **not** remove or hide Notifications.
- **Must keep working:** sign-out form action, the Notifications link for all roles, tab order (wordmark, Notifications, Sign out), touch targets of at least 44 px, no horizontal scroll at 320 px.
- **Checks:** 320, 360 and 390 px captures for each role; desktop unchanged.
- **Tests:** a Playwright assertion at 360 px that the wordmark and the Sign out label each occupy one line (height equals one line) and no horizontal overflow; keep the focus-order spec.
- **Dependency:** none (the wordmark text is not a crest).

### Fix 3: inaccurate vendor sentence

- **Affected:** `src/app/vendor/page.tsx`, the paragraph at about lines 82 to 85.
- **Existing text (quoted):** "Order handling (accept, prepare, hand over) arrives in the next release. For now you can see incoming orders but not act on them."
- **Verified:** vendor order actions exist (`src/app/vendor/orders/page.tsx`, with the Handover and Returns sections in the vendor navigation).
- **Proposed replacement:** "Manage incoming orders on the Orders page: accept, prepare and hand over. Use Handover to confirm collection by a rider, and Returns for return requests." If the owner prefers brevity: "Manage your orders on the Orders page."
- **Minimal change:** replace the paragraph text only; do not touch order logic, actions, or guards.
- **Must keep working:** the pause/resume form above it; vendor home for approved and unapproved shops.
- **Checks/tests:** text assertion in the vendor home e2e that the stale phrase "arrives in the next release" is absent and the new sentence present; search the repository for the same phrase elsewhere before changing.
- **Dependency:** none.

### Fix 4: admin and vendor mobile navigation

- **Affected:** `BottomNav` in `src/components/shells/nav-links.tsx` (`items.slice(0, 5)`), fed by `nav-config.ts`; rider navigation is inline in `src/app/rider/layout.tsx` (4 items, fits).
- **Verified current behaviour on phones:** customer 5 of 5 shown; rider 4 of 4; vendor 5 of 6 (**Returns hidden**); admin 5 of 14 (items 6 to 14, Payments onward, hidden).
- **All destinations to keep reachable.** Admin (14 nav items): Home `/admin`, Applications `/admin/applications`, Vendors `/admin/vendors`, Riders `/admin/riders`, Rider issues `/admin/rider-issues`, Payments `/admin/payments`, Refunds `/admin/refunds`, Reports `/admin/cases`, Returns `/admin/returns`, Reviews `/admin/reviews`, Jobs `/admin/jobs`, Settings `/admin/settings`, Audit `/admin/audit`, Roles `/admin/roles`. Plus two destinations with **no navigation item**, reachable only from the `/admin` cards: Delivery points and Categories (their routes are listed in `docs/reports/afit-market-visual-audit/route-inventory.md`; the plan must add them to the menu list without changing their guards). Vendor (6): Home `/vendor`, Orders `/vendor/orders`, Catalogue `/vendor/catalogue`, Shop `/vendor/profile`, Handover `/vendor/handover`, Returns `/vendor/returns`.
- **Proposed responsive pattern (do not implement):** below `md`, show the first four items plus a fifth **"More"** link. Preferred form: a real page (for example `/admin/menu`, `/vendor/menu`) listing every destination as ordinary links, because it needs no new dialog behaviour and works with keyboard and screen readers; a native `<details>` disclosure is the alternative. Apply only to shells whose item count exceeds five (admin, vendor). Customer and rider stay exactly as they are. Desktop sidebar unchanged.
- **Constraints:** no route removed, no role-guard or permission change (server guards still decide; a link a role cannot open remains harmless); `aria-current` preserved; 44 px targets; no horizontal scroll at 320 px; `More` is active when the current page is not one of the four shown.
- **Checks:** each admin role (platform admin, support agent, finance admin) and vendor on 360 px: every destination reachable in at most two taps; sidebar unchanged on desktop.
- **Tests:** new unit/e2e test that for each nav config every item appears either in the bar or in the More list; keyboard reachability; the existing role-matrix specs must still pass.
- **Dependency:** none on 28/29. Needs the owner's choice of pattern (More page versus disclosure).

### Fix 5: empty desktop landing hero

- **Affected:** the hero section of `src/app/(public)/page.tsx` (line ~19: a single `bg-brand-800` block with left-aligned content).
- **Verified current behaviour:** on desktop the content occupies the left part and the right half is empty. No crest or imagery exists.
- **Minimal change (once approved):** layout only, no brand asset: constrain text width and either centre the block or add a neutral, non-branded supporting element (for example a short three-step "how it works" list that already exists as content elsewhere on the page). **No crest, AFIT colour, logo or imagery.**
- **Must keep working:** the call-to-action links, "open now" section below, mobile layout unchanged.
- **Checks/tests:** desktop capture 1440; mobile capture identical in structure; axe and heading order unchanged.
- **Dependency:** **blocked by 28 and 29.** If the owner will use a crest or an AFIT palette, the hero should be designed once with them; doing it earlier risks rework. Recommended: implement last, or only after the crest decision.

### Recommended approval order (unchanged from section 3): 1, 3, 2; then 4; then 5 with 28/29.

## 9. Task C: separation of work

**A. Implementable after owner approval (code tasks; nothing starts before then)**

1. Decision 30 fixes 1, 3, 2, 4 (independent of 28/29); fix 5 after 28/29.
2. Palette token change and crest placement, only after 28 and 29 and AFIT authorisation.
3. The accessible proof option chosen under 31, with new DB and e2e tests (option A needs only documentation and staffing; B, C, D change code and evidential meaning and need counsel).
4. Explicitly approved job-operations implementation (section 10): scheduler proof of concept, local alert receiver, requeue function and admin action.

**B. External blockers (code cannot close these)**

AFIT written authorisation and the crest with permission terms; approved delivery points, zones and hours; vendor and rider terms and the rider verification process; live Paystack verification (owner credentials, approved procedure, then legal/financial approval); real-device Android background GPS; retention and privacy decisions (counsel); incident-response ownership; scheduler environment and alert recipient; independent security audit; person-led accessibility review (screen reader, real devices); pilot participants and acceptance criteria.

## 10. Task D: minimum decisions before implementing job operations

Source: `docs/reports/job-operations-plan.md`. No paid service, credential, live scheduler or real notification is part of any of these; `pnpm jobs:once` stays a local-only command.

| Topic                          | Minimum owner decision needed                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling                     | Platform (hosting scheduler, GitHub Actions, `pg_cron`, other) and who owns the schedule and the `JOBS_SECRET` rotation; cadence per job                             |
| Job-health alerts              | Who is alerted, by what channel, response time; whether a real channel is allowed at all (item 19); dedup rule (one alert per incident plus recovery)                |
| Dead-letter monitoring         | Threshold that counts as an incident (for example any dead row) and who reviews it                                                                                   |
| Controlled requeue             | Whether to build it; who may use it (platform admin at aal2 proposed); reason mandatory; minimum age before requeue (proposed 10 min); batch limit (proposed 20)     |
| Retry limits / duplicates      | Confirm the existing limits (dead after 5 attempts, back-off 2^n minutes) or change them; confirm reset value on requeue (proposed 3); the unique delivery row stays |
| Operational audit logging      | Confirm that every requeue and manual recovery writes an audit event; retention of those records                                                                     |
| Recovery and incident handling | Recovery targets, who is on call, incident record location, breach-notification path                                                                                 |

Local-only parts that could be built after approval with no external dependency: the requeue function and its tests, and a local alert receiver exercised by a loop runner.

## 11. Task E: pilot-readiness summary

No status in `docs/pilot-readiness.md` changed: this update produced documentation only and no new test or external evidence. The system is **not pilot-ready**. Open owner decisions: 28, 29, 30, 31 and the earlier register items. External evidence still absent: AFIT authorisation, real Paystack, real-device GPS, an independent audit, person-led accessibility review.
