# Frontend redesign, MASTER CHANNEL 1 report

Date: 2026-10-28. Branch: `feature/frontend-redesign-ch1` (draft PR #5). Starting commit: `6453e93` (the earlier shell/design-system work, itself branched from `2c8e03e`). Ending commit: the commit that contains this report (see `git log`). **Status: STOPPED for owner approval. Master channel 2 has not been started.**

## 0. Scope declared (two master channels)

The directive required exactly two master channels and did not say where to split them. The split used, stated up front:

| Master channel      | Content                                                                                                                                                                            | Status                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **1 (this report)** | Design system v2 from the owner's reference palette; public pages; Customer experience; Administrator experience; backend for the pages that had none; tests; screenshots; gallery | Built and verified locally; remote CI result for the last commit is listed in section 6 |
| **2 (NOT started)** | Vendor experience, Rider experience, final regression and acceptance                                                                                                               | Waits for owner approval                                                                |

## 1. Reference files inspected

The owner's pack (boards 01 to 04, master prompt, 23-page blueprint PDF) was inspected before any work. Nothing was reported missing. Palette tokens were taken from the PDF: navy `#073B7A`, action blue `#1261B0`, gold `#FFC928`, red `#D92D3A`, pale `#F3F7FC`. Text red stays the darker `danger-700` because `#D92D3A` on white is below 4.5:1; this is the one deliberate deviation and it is for contrast.

## 2. What was built

**Design system v2** (`src/components/ui/*`, `src/app/globals.css`): tokens, icon set, logo, product card with branded no-photo tile, data table (cards on phones), section, stepper, confirm dialog, bar chart, list controls, status badge, metric card, alert, breadcrumbs, search field.

**Public pages**: landing, item browse (`/products`: search, shop category, price cap, sort, paging), item detail, shop list and shop page, About, FAQ, Contact (working form), Terms, Privacy, Refunds, Delivery, Payments; footer with Company/Help columns; header search.

**Customer**: cart (quantity steppers, remove), checkout with step indicator and saved-place pre-selection, orders list with filters, order detail, account home, profile, wishlist, saved places, notifications and reports as before inside the new shell.

**Administrator**: dashboard (live counts, 14-day chart, recent orders, work queues, quick actions), Users directory + user detail + suspend/reinstate with reason, Orders directory + detail, Catalogue moderation (hide/show an item with reason), Reports (7/30/90 days), Messages inbox (contact form), Audit log with filter; the earlier queue pages (applications, vendors, riders, payments, settlements, refunds, cases, returns, reviews, rider issues, delivery points, categories, jobs, settings, roles, data requests) sit in the new shell with new page headers and breadcrumbs. **They keep their previous table/form internals; they were not individually redesigned** (declared in K87-adjacent notes below).

## 3. Backend added (real, validated, authorised, persisted, tested)

Three migrations, NOT applied to the hosted database (K91):

| Migration                                       | Adds                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261030000001_public_catalogue_contact`       | `browse_products` (public, active items of approved shops, sort/filter/page), `contact_messages` table (service-role writes only), staff list/triage functions                                                                           |
| `20261030000002_customer_wishlist_saved_places` | wishlist (toggle/list/contains), saved places (max 5, only open approved delivery points, one default)                                                                                                                                   |
| `20261030000003_admin_directories_reports`      | `admin_list_users`, `admin_user_detail` (audited view), `admin_set_user_suspended` (reason, not self, not staff, ends sessions), `admin_set_product_visibility`, `admin_dashboard`, `admin_report`, order directory through existing RLS |

Nothing is simulated. Where the boards show data the system does not have (product photos, item ratings, item categories) the pages show a branded no-photo tile, shop reviews only, and shop categories (K88).

## 4. Tests (evidence)

| Check                                                           | Result                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint, typecheck, prettier                                       | clean                                                                                                                                                                                                                                                                    |
| Unit tests (`pnpm test`)                                        | 358 passed (20 files)                                                                                                                                                                                                                                                    |
| Database tests (`bash scripts/db-reset.sh` then `pnpm test:db`) | 394 passed (35 files); includes the new `tests/db/redesign-backend.test.ts` (6 tests: browse sort/filter/page, catalogue moderation and audit, user directory/suspension rules, dashboard/report role gating, wishlist and saved places limits/ownership, contact inbox) |
| Production build                                                | succeeds                                                                                                                                                                                                                                                                 |
| Playwright e2e, full suite, local                               | 242 passed (desktop and 360 px) on the commit before the final small fixes; the specs changed afterwards were re-run and pass                                                                                                                                            |
| Visual audit capture                                            | 136 pages/states x 2 viewports = 272 screenshots, 0 capture failures                                                                                                                                                                                                     |

New tests also cover: security allowlists (anon-callable functions, unbounded list functions, customer-callable snapshot) updated consciously, route-guard coverage for the new admin prefixes, endpoint coverage.

## 5. Bugs found and fixed during verification

1. **Dashboard/report SQL** raised "subquery uses ungrouped column" (caught by the new DB test); rewritten as two grouped joins.
2. **Cart controls unusable**: the no-photo tile kept `w-full`, filled the row, and pushed the quantity and Remove buttons underneath the order summary, so they could not be clicked. Fixed (found by the cart e2e).
3. **Admin queues** hid zero-count items, losing the per-role view; now all queues the role may see are listed, empty ones dimmed.
4. Warning-style notice on the settings page was announced as an alert and masked real results; it is now a plain notice.
5. Several specs referenced renamed copy (checkout button, delivery-point label clash, item search moved to `/products`).
6. **Remote CI** showed horizontal overflow at 320/360 px (admin home, checkout) that did not reproduce locally; layouts were hardened (explicit single-column tracks, wrapping metric values, constrained form controls). The CI run on that commit is the proof (section 6).

## 6. Remote CI status

CI first failed (`db-and-e2e`) on commits `5d131ca` to `2252f7c`: first the DB/spec fixes this report describes, then three horizontal-overflow cases at 320/360 px that did not reproduce locally. A first hardening attempt (`e0537fc`) did not change the result, so the cause was found by reproduction rather than guessing: the CI runner falls back to a wider system font than the development container (which resolves `system-ui` to Inter). Forcing a wide font locally reproduced the exact CI numbers (6 px on admin home at 320 px, 32 px on checkout at 360 px). Real causes: the screen-reader-only table inside the bar chart (`sr-only` does not clip a table element) and the checkout stepper. Fixed in `023b1e4`.

**Result: CI is green on `023b1e4`** (`checks` and `db-and-e2e` both succeeded, push and pull-request runs). This report's own commit only changes documentation.

## 7. Screenshots

`artifacts/afit-market-ui-audit/redesign-m1-after/{desktop,mobile}/<role>/...png` (136 each), before set in `redesign-before` (114 each, from the earlier baseline), gallery `artifacts/afit-market-ui-audit/gallery.html`, inventory `page-inventory.md`, failures `capture-failures.md` (none). 22 states exist only in the after set (new pages).

## 8. Open points and owner decisions

See `docs/known-issues.md` K84 to K92 and `docs/owner-decisions.md` (2026-10-28 entry): approve channel 1; approve applying the three migrations to the hosted project; confirm the contact inbox model; legal wording of the policy pages stays draft.

## 9. Safety statement

No production deployment was made by this work (the Vercel preview of this branch builds automatically from the PR; production was not promoted). No live payment credentials were used and no real financial transaction was made; all payments in tests are Paystack test mode or the local fake. No secrets were committed. The hosted database was not changed.

## 10. What happens next

STOP. Master channel 2 (Vendor, Rider, final regression and acceptance) starts only after the owner approves this channel.
