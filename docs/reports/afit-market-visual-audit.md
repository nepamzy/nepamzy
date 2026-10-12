# AFIT Market: visual audit of the existing application

**Audit date:** 2026-10-12 · **HEAD:** `3b9180190651ab46395a300a076deddd34188360` (branch `claude/afit-market-phase-0-asm8xd`) · **Environment:** local Supabase stack + local production build (`pnpm build && pnpm start`), SYNTHETIC data only, driven by Playwright/Chromium. Nothing was deployed; no real payment, message, location or person was involved.

> **Status: observation and proposal only. No colour, layout, typography or component styling has been changed.** The only code added for this audit is the capture tooling (`tests/visual-audit/`, `playwright.audit.config.ts`) and the report builders (`scripts/build-visual-audit-report.py`, `scripts/render-report-pdf.mjs`).
>
> **WAIT FOR OWNER REVIEW BEFORE APPLYING COLOUR OR DESIGN CHANGES.**

Deliverables: [`afit-market-visual-audit.pdf`](afit-market-visual-audit.pdf) (102 pages, one page per state, mobile left and desktop right; long pages show the top portion and name the full PNG), [`afit-market-visual-audit/route-inventory.csv`](afit-market-visual-audit/route-inventory.csv), [`route-inventory.md`](afit-market-visual-audit/route-inventory.md), and the original full-page PNGs under `afit-market-visual-audit/{public,customer,vendor,rider,admin}/`.

## 1–3. Environment, route discovery and counts

- **Route discovery:** every `page.tsx` under `src/app` (route groups removed) = **50 page routes**, cross-checked against the access policy in `src/server/modules/identity-and-access/policy.ts`. API/webhook/job endpoints and the receipt PDF render no interface and are listed separately, not screenshotted.
- **Captured:** **50 of 50 routes captured at both viewports** (360x800 and 1440x900); none missing. **93 page states** captured x 2 viewports = **186 original PNG files** (31 MB). **0 failed captures** (every attempt, including redirects and 403 pages, is in the inventory).
- **Caution on "captured":** a route counts as captured if at least one real rendered state exists. States that were _not_ captured are listed in section 9. The 320 px viewport was not captured separately (360 is the project's smallest supported viewport; 320 px reflow is covered by an automated check).
- **Sign-in was real:** each role signed in through the normal login screen and TOTP challenge (test authenticators created through the local Auth API). No authorisation was bypassed. Access-denied pages (403) and anonymous redirects were captured as states of their own.

## 4. Admin-interface finding

**ADMIN INTERFACE: IMPLEMENTED AND WORKING (not a placeholder).**

1. There is no separate admin sign-in: staff use the same sign-in; the role is granted by an administrator and TOTP (aal2) is required.
2. Admin pages exist and render: `/admin` (overview with role-scoped counters), `/admin/applications`, `/vendors`, `/delivery-points`, `/categories`, `/riders`, `/rider-issues`, `/payments`, `/refunds`, `/cases` (+ detail), `/returns`, `/reviews`, `/jobs`, `/settings`, `/audit`, `/roles` — **16 pages + 1 detail page, all captured at both viewports.**
3. Roles: platform administrator (all), support agent (reports, returns, rider issues, review reports, refunds, audit), finance administrator (payments, refunds). Observed: support sees only support counters and gets a 403 on `/admin/settings`; finance gets a 403 on `/admin/cases`; a customer gets a 403 on `/admin`; an anonymous visitor is redirected to sign-in.
4. Guarding: pages are guarded by server layouts and every action re-checks in the database (verified by the automated suites, not by screenshots).
5. Data: pages show real local records (counters, queues, case, refund requests, audit rows), not placeholder content.
6. Incomplete or limited: `/admin/jobs` shows "never run" for all three jobs because nothing schedules them (accurate, K56); on a phone the bottom bar offers only 5 of the 16 sections (the others are reached from home cards); no user-management page beyond roles and applications.

## 5. Role-by-role screenshot index (original images; mobile / desktop pairs share a name apart from the suffix)

| Role folder             | States captured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/` (20 states)   | landing; vendor list; search with and without results; vendor menu; product detail; 404; login (empty, wrong password); sign-up (empty, validation error); MFA enrolment, challenge and wrong-code error; signed-in-without-factor home; offline fallback; design-system page; anonymous redirects for orders, admin and cart                                                                                                                                                                                                                           |
| `customer/` (31 states) | empty and populated cart; checkout; product detail; order history; completed order with review form and after publishing; paid order waiting for the shop; delivery en route (no location yet); help (refund and report forms) and after submitting each; reports list and detail; arrived order -> confirm receipt -> signature box (empty) -> missing-signature error; notifications (with and without unread); account; account security; vendor and rider application forms; 403 pages for vendor, rider and admin; empty orders/notifications/cart |
| `vendor/` (11 states)   | dashboard; incoming orders; catalogue; new product; edit product; shop profile and hours; pickup handover; returns; notifications; account; 403 for a non-vendor                                                                                                                                                                                                                                                                                                                                                                                        |
| `rider/` (6 states)     | dashboard (active shift and inactive); jobs (with an arrived delivery, and inactive/no offers); profile; notifications                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `admin/` (25 states)    | all 16 admin pages as platform administrator; case detail; refunds with a filter; notifications; support-agent overview and cases; finance overview and refunds; 403 for support on settings and for finance on cases                                                                                                                                                                                                                                                                                                                                   |

(Exact files: see `route-inventory.md`/`.csv`.) No other roles exist in the code (roles are customer, vendor owner/staff, rider, support agent, finance admin, platform admin).

## 6. Desktop / mobile comparison

- Desktop gets a left sidebar (rider/vendor/admin/customer shells) and a two-column landing; phones get a bottom navigation bar and single-column cards. Both use the same cards, buttons and badges, so the roles look like one product.
- Phone header at 360 px is cramped: the "AFIT Market" wordmark and the "Sign out" button each wrap onto two lines beside the "Notifications" link (every signed-in role).
- Desktop landing: the right half of the green hero is empty (no crest, logo or imagery).
- Full-page phone captures show the fixed bottom bar part-way down; this is a capture artefact (fixed to the viewport).
- Admin overview is about 10,800 px tall on a phone (16 section cards plus 14 counters).

## 7. Current colour tokens (source: `src/app/globals.css`, `manifest.ts`, `layout.tsx`)

| Role                                           | Tokens                           | Values                                                                             |
| ---------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Brand (buttons, links, hero, PWA theme colour) | brand-50/100/600/700/800         | `#e8f3f2` `#cde5e3` `#0f6b66` `#0b5551` `#083f3c` (teal-green)                     |
| Accent                                         | accent-50/600/700                | `#fdf1e4` `#a84a07` `#8a3b05` (burnt orange)                                       |
| Text                                           | ink, muted                       | `#16211f`, `#475653`                                                               |
| Surfaces / lines                               | surface, card, line, line-strong | `#f5f6f2`, `#ffffff`, `#cfd6d0`, `#8c9a94`                                         |
| Status (text on tint)                          | success, warning, danger, info   | `#17673a`/`#e5f4ea`; `#7a4f00`/`#fff3d6`; `#a3211a`/`#fdebe9`; `#1a4a8a`/`#e6eefa` |
| Focus ring                                     | brand-600                        | 3 px `#0f6b66`, 2 px offset                                                        |
| PWA                                            | theme / background               | `#0b5551` / `#f5f6f2`                                                              |

## 8. AFIT official visual references: what could and could not be confirmed

- **Sources named in the brief:** https://afit.edu.ng/ and https://afit.edu.ng/home/amp/afitlogo/. **Date of attempt:** 2026-10-12.
- **Result: BLOCKED.** From this sandbox the outbound proxy refused the connection (HTTP 403 on CONNECT) and the fetch tool could not resolve the host. The crest/logo image was therefore **not inspected and no colour was sampled**. No second source was substituted.
- **Officially specified colours: none found** (no brand guide was reachable; the preliminary research also found none). **Sampled estimates: none.** The only statement available is the preliminary visual finding recorded in the hand-off: the published crest visibly uses blue, gold/yellow, red and white. That is a description, not a value; it is not repeated here as a hex code.
- **Ambiguities that will matter when sampling later:** crest versions, JPEG compression, antialiasing at the edges of gold/yellow areas, transparent backgrounds, and whether the website renders the crest differently from the print crest.

## 9. Not captured, blocked or unavailable

Blocked: AFIT website/crest (above). Not captured states (each needs setup that would change data in ways this audit avoided, or hardware): Paystack redirect and return screens, live tracking card with a GPS fix, populated rider-offer list, a filed review report in the moderation queue, pending vendor and rider applications, loading skeletons, offline-in-use, executed refund states, the vendor accepting/preparing an order (pages captured, actions not driven). Not screenshotted: API/webhook endpoints, receipt PDF. **No page failed to render.**

## 10. Comparison with AFIT branding (preliminary; see section 8 for the limits)

- The app is a consistent **teal-green + burnt-orange** product. The brand colour does **not** correspond to the blue/gold/red/white the crest is described as using, and **no crest or logo appears anywhere** (text wordmark only).
- White cards and red error states loosely agree with the reference; the green/orange identity looks intentional and has strong contrast, so it is a branding choice, not an accessibility defect.
- Whether AFIT's name, crest and colours may be used is an open external approval (#3). Until then a neutral identity is the lower-risk state.

## 11. Layout and consistency observations

- Consistent component language across all roles and both viewports (cards, pill badges, outlined secondary buttons, dark-green primary buttons).
- **Stale wording:** the vendor dashboard says order handling "arrives in the next release", although order handling exists.
- Admin phone navigation exposes 5 of 16 sections; long pages rely on home cards.
- Synthetic leftovers ("Shop shop-xxxx") appear in the public vendor list because the shared test database holds data from earlier suites; not a design defect.
- Plain, friendly wording on MFA, signature, refund and report screens; error messages are visible and specific ("Please sign in the box before confirming.").

## 12. Readability and contrast (measured with the WCAG 2.x formula from the token values; screenshots were not used for measuring)

| Pair                                | Foreground | Background | Ratio   |
| ----------------------------------- | ---------- | ---------- | ------- |
| ink on surface                      | `#16211f`  | `#f5f6f2`  | 15.22:1 |
| ink on card                         | `#16211f`  | `#ffffff`  | 16.52:1 |
| muted on surface                    | `#475653`  | `#f5f6f2`  | 7.10:1  |
| muted on card                       | `#475653`  | `#ffffff`  | 7.71:1  |
| white on brand-700 (primary button) | `#ffffff`  | `#0b5551`  | 8.63:1  |
| white on brand-600                  | `#ffffff`  | `#0f6b66`  | 6.33:1  |
| brand-700 link on card              | `#0b5551`  | `#ffffff`  | 8.63:1  |
| brand-700 link on surface           | `#0b5551`  | `#f5f6f2`  | 7.95:1  |
| brand-700 on brand-50               | `#0b5551`  | `#e8f3f2`  | 7.62:1  |
| white on accent-600                 | `#ffffff`  | `#a84a07`  | 5.76:1  |
| accent-700 on accent-50             | `#8a3b05`  | `#fdf1e4`  | 6.97:1  |
| success-700 on success-50           | `#17673a`  | `#e5f4ea`  | 6.08:1  |
| warning-700 on warning-50           | `#7a4f00`  | `#fff3d6`  | 6.46:1  |
| danger-700 on danger-50             | `#a3211a`  | `#fdebe9`  | 6.54:1  |
| info-700 on info-50                 | `#1a4a8a`  | `#e6eefa`  | 7.52:1  |
| line-strong border on card (UI 3:1) | `#8c9a94`  | `#ffffff`  | 2.93:1  |
| line border on card                 | `#cfd6d0`  | `#ffffff`  | 1.48:1  |
| focus ring brand-600 on surface     | `#0f6b66`  | `#f5f6f2`  | 5.84:1  |

- All text pairs pass AA (>= 4.5:1). **Measured shortfall:** the input/box border `line-strong` is 2.93:1 on white and 2.70:1 on the page surface, below the 3:1 recommended for UI component boundaries (WCAG 1.4.11). The soft `line` (1.48:1) is decorative card edging.
- Visual impressions of readability (font sizes, line length) are estimates from the screenshots and are labelled as such.

## 13. Proposed palette and direction (PROPOSAL ONLY: not applied, not sampled from AFIT)

These are _illustrative_ values chosen to show that a blue / gold / red / white scheme can meet contrast targets. They are not official AFIT colours.

| Role           | Illustrative value               | Use                                       |
| -------------- | -------------------------------- | ----------------------------------------- |
| Primary (blue) | `#1f3d8c`, dark `#17306f`        | buttons, links, header, hero              |
| Accent (gold)  | `#e6b422`                        | highlights and badges, **dark text only** |
| Danger (red)   | `#a3211a` (unchanged)            | errors, destructive actions               |
| Surfaces       | `#ffffff`, `#f5f6f2` (unchanged) | cards, page                               |
| UI border      | `#6f7f78`                        | input outlines (fixes the 3:1 shortfall)  |

| Pair                                   | Foreground | Background | Ratio   |
| -------------------------------------- | ---------- | ---------- | ------- |
| white on proposed blue #1f3d8c         | `#ffffff`  | `#1f3d8c`  | 9.98:1  |
| white on blue #24408e darker #17306f   | `#ffffff`  | `#17306f`  | 12.44:1 |
| blue #1f3d8c link on white             | `#1f3d8c`  | `#ffffff`  | 9.98:1  |
| blue link on surface #f5f6f2           | `#1f3d8c`  | `#f5f6f2`  | 9.19:1  |
| ink on gold #e6b422                    | `#16211f`  | `#e6b422`  | 8.59:1  |
| gold #e6b422 on blue #17306f           | `#e6b422`  | `#17306f`  | 6.46:1  |
| white on gold #e6b422 (avoid)          | `#ffffff`  | `#e6b422`  | 1.92:1  |
| danger #a3211a on white                | `#a3211a`  | `#ffffff`  | 7.53:1  |
| proposed UI border #6f7f78 on white    | `#6f7f78`  | `#ffffff`  | 4.21:1  |
| current line-strong #8c9a94 on #f5f6f2 | `#8c9a94`  | `#f5f6f2`  | 2.70:1  |

Gold must not carry white text (1.92:1). Success/warning/info colours would need review so they stay distinguishable from a blue primary. **A colour swap alone would not fix** the header wrapping, the empty desktop hero, the stale vendor sentence or the admin phone navigation; those are layout/content decisions.

## 14. Functional errors observed during capture

None blocked a capture. Findings: stale vendor-dashboard sentence; phone header wrapping; fixed bottom bar overlapping long pages only in full-page images (artefact). The audit tooling itself needed several corrections (a form locator, action timeouts, stable file names, the MFA enrolment capture); these affect the tooling only.

## 15. Recommended next steps (NOT implemented)

1. Owner decision on identity: neutral, or AFIT's blue/gold/red with permission (external approval #3). If AFIT's identity is wanted, obtain the official crest file from AFIT and sample it properly, recording values as estimates unless a guide exists.
2. If approved: a tokens-only colour change first; then fix the input-border contrast, header wrapping and the stale vendor sentence; then re-run `pnpm exec playwright test -c playwright.audit.config.ts` and the report builder for a before/after comparison.
3. Decide whether phones should expose all admin sections and whether the hero needs a crest/logo area.

**Approval questions:** (a) AFIT identity yes/no and who obtains permission; (b) approve the contrast fix; (c) approve the header/copy fixes; (d) approve a crest placeholder; (e) admin phone navigation scope.

## How to reproduce

`pnpm db:start && bash scripts/db-reset.sh`, then `pnpm exec playwright test -c playwright.audit.config.ts` (builds and starts the app, seeds synthetic data, writes screenshots and `inventory-*.json`), then `python3 scripts/build-visual-audit-report.py` and `node scripts/render-report-pdf.mjs /tmp/afit-audit.html "$PWD/docs/reports/afit-market-visual-audit.pdf"`.
