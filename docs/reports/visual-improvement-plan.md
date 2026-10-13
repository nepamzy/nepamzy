# Visual improvement plan (PLAN ONLY: nothing here has been applied)

Prepared 2026-10-13 against HEAD `f368712`. **No colour, layout, typography, component, crest or landing-page change has been made.** Every implementation step below waits for the owner's decisions 28, 29 and 30 (`docs/owner-decisions.md`). The 186 screenshots in `docs/reports/afit-market-visual-audit/` are the permanent "before" reference; do not overwrite or regenerate them in place.

## 1. Current visual design and token inventory (source: `src/app/globals.css`, `manifest.ts`, `layout.tsx`)

| Role                  | Tokens                              | Values                                                                                         |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Brand                 | brand-50 / 100 / 600 / 700 / 800    | `#e8f3f2` `#cde5e3` `#0f6b66` `#0b5551` `#083f3c`                                              |
| Accent                | accent-50 / 600 / 700               | `#fdf1e4` `#a84a07` `#8a3b05`                                                                  |
| Text                  | ink / muted                         | `#16211f` / `#475653`                                                                          |
| Surfaces and lines    | surface / card / line / line-strong | `#f5f6f2` / `#ffffff` / `#cfd6d0` / `#8c9a94`                                                  |
| Status (text on tint) | success / warning / danger / info   | `#17673a` on `#e5f4ea`; `#7a4f00` on `#fff3d6`; `#a3211a` on `#fdebe9`; `#1a4a8a` on `#e6eefa` |
| Focus ring            | brand-600                           | 3 px, 2 px offset                                                                              |
| PWA                   | theme / background                  | `#0b5551` / `#f5f6f2`                                                                          |

Radius 0.875 rem (cards) and 0.625 rem (controls); one shadow; system font stack; no dark mode (K12).

## 2. The existing palette

Teal-green brand plus a burnt-orange accent, white cards on a warm grey page. One design language across public, customer, vendor, rider and admin shells. Text pairs measured at 5.76 to 16.5:1 (all AA). The only measured shortfall is the box/input border (`line-strong` 2.93:1 on white, 2.70:1 on the page surface).

## 3. Status of official AFIT colours

**Unconfirmed.** The AFIT website was not reachable from the sandbox; no brand guide was found; no colour was sampled; the only statement is the preliminary visual description (blue, gold/yellow, red, white). The palette in the audit report is illustrative and must not be labelled official. If a crest or guide is obtained later, record: source URL or file, date, version of the asset, sampled values marked "estimate" unless a guide specifies them, and the permission terms.

## 4. The five observed improvements (decision 30)

| #   | Observation                                                                                                                                 | Where in code                                                                                                                                                                                      | Risk if fixed                                 | Effort           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------- |
| 1   | Input/box border 2.93:1 (target 3:1)                                                                                                        | token `--color-line-strong` (12 files use `border-line-strong`)                                                                                                                                    | Very low; slightly darker outlines everywhere | Tiny (one token) |
| 2   | Phone header wraps wordmark and "Sign out"                                                                                                  | `src/components/shells/app-shell.tsx` (wordmark, "Notifications" link, email, sign-out in one row at 360 px)                                                                                       | Low                                           | Small            |
| 3   | Vendor dashboard says order handling "arrives in the next release ... you can see incoming orders but not act on them"; order actions exist | `src/app/vendor/page.tsx` lines ~82-85                                                                                                                                                             | None (copy only)                              | Tiny             |
| 4   | Admin phone navigation shows 5 of 16 sections                                                                                               | `BottomNav` in `src/components/shells/nav-links.tsx` renders `items.slice(0, 5)`; admin has 14 navigation items (`ADMIN_NAV`; 16 sections exist), vendor has 6 (its "Returns" item is also hidden) | Medium: touches every role's phone navigation | Small to medium  |
| 5   | Empty right half of the desktop landing hero                                                                                                | `src/app/(public)/page.tsx`                                                                                                                                                                        | Cosmetic; tied to the crest decision          | Small            |

## 5. Existing admin navigation structure

`ADMIN_NAV` has 14 items: Home, Applications, Vendors, Riders, Rider issues, Payments, Refunds, Reports, Returns, Reviews, Jobs, Settings, Audit, Roles. The audit counted 16 admin sections because **Delivery points and Categories have no navigation item at all** and are reachable only from the cards on `/admin`. Desktop shows all items in a left sidebar (role-filtered by the pages' own guards: items a role may not open show a 403 page). On phones only the first five appear in the fixed bottom bar; the rest are reachable from the cards on `/admin`. The home page is about 10,800 px tall at 360 px.

## 6. Proposed mobile-navigation improvement (needs approval; smallest change that solves it)

Keep the five-item bottom bar, but make the fifth slot a **"More" control** that opens a plain list of every remaining section (a native disclosure or a page at `/admin/menu` rather than a custom dialog, so it is keyboard- and screen-reader-friendly by default). Apply the same component to every role, so the vendor "Returns" item stops being hidden. Requirements: items are real links; `aria-current` preserved; 44 px touch targets; no horizontal scrolling; no change to role guards (a link to a page a role cannot open stays harmless because the server guard decides). Alternative: a horizontally scrollable bar (rejected as the default because off-screen items are easy to miss and awkward for keyboard and screen-reader users).

## 7. If the owner approves a palette change: token-only approach

1. Change values in `@theme` in `src/app/globals.css` (and `theme_color` in `manifest.ts` and `layout.tsx`); introduce no new component styles.
2. Keep token names; keep status colours distinguishable from the new primary.
3. Fix the border token to at least 3:1 against both white and the page surface (about `#6f7f78` gives 4.21:1 on white).
4. Rule for gold (if used): dark text only (white on gold is 1.92:1).
5. Recompute every foreground/background pair (script: the contrast table in the audit) and fail the change if any text pair is below 4.5:1 or any UI boundary below 3:1.
6. Do not change layout, spacing, typography or component structure in the same change.

## 8. Before-and-after screenshot comparison plan

- "Before" = the committed screenshots from this audit (immutable reference, HEAD `f368712`).
- "After" = rerun `pnpm exec playwright test -c playwright.audit.config.ts` into a **new** directory (add an output-directory option or copy the `docs/reports/afit-market-visual-audit` folder first), then `python3 scripts/build-visual-audit-report.py`.
- Compare the same 93 states at both viewports; produce a side-by-side contact sheet per role (before left, after right); list any state that appears, disappears or reflows; record any page whose height changes by more than 5 %.
- Seed data differs between runs (random shop names and ids), so compare layout and colour, not text content; keep fixture names deterministic if a pixel diff is wanted.

## 9. Regression tests to run after any approved visual change

`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm check:secrets`, `pnpm audit --prod`, `pnpm test:db` (unaffected but part of the standard gate), the full Playwright suite (includes axe on every shell and the scripted keyboard/zoom specs in `accessibility-keyboard.spec.ts`), then the audit capture for the comparison. A navigation change additionally needs a new test that the "More" list contains every item for each role and that each link is keyboard-reachable.

## 10. Accessibility and contrast requirements

Text >= 4.5:1 (large text >= 3:1); UI component boundaries and focus indicators >= 3:1; visible focus kept (3 px ring); touch targets >= 44 px; no information by colour alone (badges carry text); no horizontal scroll at 320 px; `prefers-reduced-motion` honoured. Contrast must be measured from token values, not judged from screenshots. A person-led review is still outstanding and is not replaced by these checks.

## 11. Prerequisites

- Owner answers to 28, 29, 30.
- If AFIT's identity is used: written AFIT authorisation for its name and crest (external approvals #3 and #33), the official crest file with its permission terms, and sampled colours recorded as estimates unless a guide specifies them.
- No crest is added and no colour is called official until those exist.
