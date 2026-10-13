# Owner review and next steps

**Prepared 2026-10-13 from repository HEAD `f36871207b697c411315a329ed06051fa7b56a27`** (branch `claude/afit-market-phase-0-asm8xd`, clean working tree, identical to `origin`). This stage changed documentation only: no application code, test, token, layout, crest, policy, authorization or migration was touched. **Nothing here is an approval; every decision below is still the owner's.**

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
