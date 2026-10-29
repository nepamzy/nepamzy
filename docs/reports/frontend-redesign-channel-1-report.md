# Frontend redesign, Channel 1 report: baseline, visual audit, shared shell, Administrator / Customer mode

Date: 2026-10-27. Branch: `feature/frontend-redesign-ch1`. Starting commit: `2c8e03e` (the branch point; `main` also carries merged PRs #2, #3 and #4). Ending commit: `c12e54e` plus the commit that contains this report. Working tree at the end: clean after the final commit. No production deployment, no real payment and no real bank transfer happened: everything ran against the local database and the local Paystack stand-in.

## 1. What this channel delivers

1. **Baseline and before capture** (phase 1): 114 pages/states at 1440 px and 390 px (228 screenshots) before any visual change.
2. **Shared design system and shells** (phase 2): tokens, icon set, logo mark, buttons, metric cards, status badges, alerts, breadcrumbs, search field, tables, empty/error states, the signed-in shell (sidebar, header with search, cart and notification badges, account menu, phone drawer, bottom bar), the public header and footer, the split authentication frame and the 403/404 pages.
3. **Administrator / Customer mode** (phase 3): one login, a server-checked switch, an audited record of each switch, a sign-in choice, and route guards.

This channel redesigns the frame. The page content inside it (landing, listings, dashboards, tables, forms) is still the previous layout and is redesigned in channels 2 to 5 (K81). The reference boards are the target direction and are not shown in the app.

## 2. Baseline (before changes)

Run on `main` after PR #4: lint, typecheck and format clean; 335 unit tests, 388 database tests and the full Playwright suite passed in CI (db-and-e2e green on PR #4, 2026-10-27). Existing implementation reports, known issues, design tokens, bank-data encryption and account-erasure documentation were read. Working features preserved: Paystack test-mode flow, 4.5% vendor commission, rider direct-payment safeguards (disabled by default), encrypted bank data, account erasure, optional two-step sign-in, e-mail and pop-up notifications, password reset by e-mailed code.

## 3. Screenshots

Capture tool: `tests/visual-audit/ui-audit.spec.ts` (existing harness, reused) with synthetic local data; each role signs in through the real UI.

| Set                          | Desktop 1440x900 | Mobile 390x844 | Total |
| ---------------------------- | ---------------- | -------------- | ----- |
| Before (`redesign-before`)   | 114              | 114            | 228   |
| After (`redesign-ch1-after`) | 114              | 114            | 228   |

By role (both viewports, per set): public 44, customer 76, vendor 26, rider 22, admin 60. Failures: 0 (`capture-failures.md`). Pages that redirect or answer 403/404 are real rendered states and are labelled. Tablet widths were checked by the responsive layout tests rather than a separate full set (channel 6 captures the tablet set). Gallery: `artifacts/afit-market-ui-audit/gallery.html`; inventory: `page-inventory.md`. The earlier colour-change audit is kept as `gallery-visual-audit-v1.html` and `page-inventory-visual-audit-v1.md`.

Not capturable: real Paystack pages, real map tiles and any hosted file store (none are configured locally).

## 4. Changes by group

- **Tokens** (`src/app/globals.css`): navy 950/900/800/700 and a light navy text colour, a pop shadow. Contrast of white, navy text, gold on navy and white on red is asserted in `tests/unit/visual-fixes.test.ts`. The hard-coded colour guard now allows the e-mail template only.
- **UI components** (`src/components/ui`): `icons` (one 24 px line set), `logo` (our provisional "A" mark, not an AFIT crest), `metric-card`, `status-badge`, `alert`, `breadcrumbs`, `search-field`; restyled `button` (gold variant), `card`/`PageHeader` (breadcrumbs), `states` (icons), `table`.
- **Shells** (`src/components/shells`): `app-shell` (sidebar, header, cart and unread badges, account menu, mode pill and phone mode bar), `drawer`, `menu`, `nav-links`/`nav-config` (icon names, grouped admin navigation), `public-header`, `public-footer`, `auth-frame`, `mode-switch`.
- **Pages**: `/account/mode`, restyled `/design` reference page, not-found and forbidden pages, authentication layouts, the sign-in form (gold button, optional "Sign in to" choice, forgot-password link).
- **Backend**: `cartItemCount()` for the header badge; `Principal.mode`, `MODE_COOKIE`, a `switch-mode` access decision, and `switchModeAction` in the identity module.
- **Tests**: new unit tests for the mode rules, new `tests/e2e/admin-customer-mode.spec.ts`, helper updated because Sign out now lives in the account menu, and the earlier "customers must enrol an authenticator" e2e expectations were already updated in PR #4.

## 5. Administrator / Customer mode: how it works and why it is safe

- Accounts with a staff role (platform admin, finance admin, support agent) see a switch in the sidebar, the account menu and on `/account/mode`. Everyone else sees nothing to switch.
- The `afit_mode` cookie (httpOnly, SameSite=Lax, Secure in production) can only choose the lighter view. `loadPrincipal` derives `mode = admin` only when the server-loaded roles include a staff role and the cookie is not `customer`. A customer, vendor or rider forging `afit_mode=admin` still has no staff role and gets 403 (proved in e2e).
- Staff areas stay protected by role and by the authenticator code regardless of mode (unit-tested for every staff route; mode never lifts the second step).
- In Customer mode, staff areas and staff-only server actions are refused with a clear "switch mode" message or redirect (`decideAccess` returns `switch-mode`). The customer experience (cart, checkout, orders, notifications, account) works with the same login.
- Switching to Administrator mode is refused for non-staff accounts and requires the authenticator code. Each switch writes `auth.mode_switched` (with the target mode) to the audit trail; the e2e test reads it back. Sign-out clears the cookie. The switch is rate limited.
- Switching never grants vendor or rider permissions.

## 6. Backend reused or added

Reused: Supabase auth and MFA, `my_roles`, `list_my_notifications` (unread count), `cart_quote` (cart count), `recordSecurityEvent`, the central route policy. Added: no database migration in this channel (the optional-two-step and reset migrations came with PR #4). New code is confined to the identity module, one query, and the UI.

## 7. Tests (exact commands and results)

| Command                                                  | Result                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm exec prettier --check .`                           | all files formatted                                                                    |
| `pnpm lint`                                              | 0 errors, 0 warnings                                                                   |
| `pnpm typecheck`                                         | clean                                                                                  |
| `pnpm test` (unit)                                       | 340 passed, 0 failed, 0 skipped (335 at baseline; +5 for mode rules and navy contrast) |
| `pnpm test:db` (after `pnpm db:reset`)                   | 388 passed, 0 failed                                                                   |
| `pnpm exec playwright test` (full suite, both viewports) | 242 passed, 0 failed, 0 skipped, 0 flaky (includes 8 new mode tests)                   |
| `pnpm audit --prod`                                      | no known vulnerabilities                                                               |
| `node scripts/check-secrets.mjs`                         | scan ok (1523 tracked files, 34 client bundle files)                                   |
| `pnpm build` (run by the e2e web server before each run) | succeeded                                                                              |
| UI audit capture (`playwright.ui-audit.config.ts`)       | 2 passed, 228 screenshots, 0 failures                                                  |

Honest notes: an earlier full run found 6 failures, all because the Sign out button moved into the account menu (and one drawer label clashed with the menu label). I updated the helper and the drawer label, never skipped or weakened a test, and the final full run above is clean. A DB-test run done right after the e2e and capture runs showed 9 failures caused by leftover data in the shared local database; after `pnpm db:reset` the same suite passed 388/388 (the DB tests expect a fresh database).

## 8. Bugs found and fixed during the channel

1. Root `loading.tsx` made every protected page answer 200 before the access check, which would hide real 403 and redirect answers. Removed (K82).
2. Making "Customer" the default radio on the sign-in form silently switched every administrator to Customer mode; the choice is now optional and only applies when chosen.
3. A mode switch could race the next page load in tests; the test now waits for the server action response.
4. The home page said customers must set up a second sign-in step; corrected.
5. The footer linked to a receipt check page that needs a token; removed. The decorative ring on the sign-in panel rendered grey; recoloured.

## 9. Remaining defects and external dependencies

See `docs/known-issues.md` K81 to K86. In short: page content still in the old layout; no route loading files by design; admin Users/Orders/Reports/Products directories and header search are channel 5; About, Contact, FAQ and policy pages are channel 2; passkeys are not available in Supabase Auth; legal drafts remain unapproved; palette and mark remain provisional.

## 10. Owner decisions still required

`docs/owner-decisions.md` rows 40 to 42: confirm two-step sign-in stays optional for vendors and riders; confirm the mode design; approve or replace the provisional palette and mark.

## 11. Confirmations

No production deployment, no production credentials, no real Paystack transaction and no real bank transfer were used. The live Supabase project and Vercel were not changed by this channel.

## 12. Owner review checklist

1. Open `artifacts/afit-market-ui-audit/gallery.html` and compare before and after (desktop and mobile).
2. Sign in as an administrator and use the switch (sidebar, account menu, `/account/mode`); confirm the gold "Administrator mode" pill or phone strip is always visible.
3. In Customer mode, browse, add to cart and open orders; confirm `/admin` is closed until you switch back.
4. Open `/design` for the component reference.
5. Confirm or change decisions 40 to 42, then approve Channel 2.
