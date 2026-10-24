# Visual improvement review package (for owner inspection: NOTHING here is implemented)

Prepared 2026-10-13 against HEAD `daee8a4` (before this stage's commit). **No application component, token, layout or copy was changed.** Every "proposed" image below is a **static HTML mockup** in `docs/reports/visual-improvement-review/mockups/` (own CSS copy of the current tokens; it is not the application and not a working implementation). The original audit screenshots under `docs/reports/afit-market-visual-audit/` are untouched and remain the "before" reference.

How to regenerate the mockup images: open the HTML files in a browser at the stated widths (`header.html?v=cur|prop`, `nav.html?v=cur|prop&role=admin|vendor`, `hero.html?v=cur|a|b`). The PNGs here were captured at 320, 360 and 1440 px with the repository's Chromium.

Owner gate: **approve, change or reject each item (A to E) in `docs/owner-decisions.md` item 30 (and 28/29 for the hero) before any code changes.**

## A. Input and box border contrast

- **Current source:** `--color-line-strong: #8c9a94` in `src/app/globals.css:13`; used as `border-line-strong` on inputs (`ui/fields.tsx`, `ui/list-filter.tsx`), secondary buttons (`ui/button.tsx`), pager links, add-to-cart and cart quantity boxes, bordered empty states, the upcoming timeline step and the signature pad's dashed border (12 files).
- **Recalculated from the current tokens (WCAG 2.x relative luminance):**

| Value               | on white `#ffffff` | on page surface `#f5f6f2` | on brand-50 `#e8f3f2` |
| ------------------- | ------------------ | ------------------------- | --------------------- |
| `#8c9a94` (current) | 2.93               | 2.70                      | 2.59                  |
| `#84918b`           | 3.28               | 3.02                      | 2.89                  |
| `#7a8a83`           | 3.63               | 3.34                      | 3.20                  |
| `#6f7f78`           | 4.21               | 3.88                      | 3.72                  |

- **Requirement applied:** WCAG 2.1 SC 1.4.11 non-text contrast, 3:1 for the boundary that identifies a control. The inputs themselves sit on white (`bg-card`); bordered boxes also sit on the surface colour, so the surface pair is the stricter test.
- **Recommendation: `#7a8a83`.** The lightest value that reaches 3:1 on both backgrounds is `#84918b`, but it clears the surface by only 0.02; `#7a8a83` keeps a real margin (3.34 on the surface) while staying visibly lighter than the stronger `#6f7f78`. Hover/disabled states are not affected. Hue is kept; this is not a palette change and no other token changes.
- **Mockup:** `mockups/border-contrast-desktop.png` (current left, candidate right).
- **Dependencies:** none (independent of decisions 28/29). If decision 28 later changes the palette this token is re-derived there; do not do both.
- **Acceptance criteria:** token value is the approved one; a unit test computes the token against white and the surface and fails below 3:1; every text pair stays >= 4.5:1; axe still passes; audit recapture shows only outline changes.

## B. Mobile header

- **Current source:** `src/components/shells/app-shell.tsx`: one flex row (`justify-between gap-3`, `px-4`) holding the wordmark link (below `md`), a "Notifications" link (added in Batch 6), the signed-in email (`hidden sm:inline`, so absent on phones) and the "Sign out" button. None of the text has `whitespace-nowrap`.
- **Reproduced in the mockup (current):** at 320 px the wordmark wraps to two lines ("AFIT / Market") and the button label wraps ("Sign / out"); at 360 px the three elements just fit (`header-current-360.png` shows the tight fit). Reproduced layout only; the real component was not measured at other widths in this stage.
- **Proposal:** keep every element and its order (wordmark, Notifications, Sign out; keyboard order unchanged); add `whitespace-nowrap` to the wordmark and the button, reduce the gap and the wordmark size one step below `sm`. If it still cannot fit at 320 px, allow the header to wrap as two tidy rows rather than breaking words. **Notifications is not removed or hidden.**
- **Mockups:** `header-current-320.png`, `header-proposed-320.png`, `header-current-360.png`, `header-proposed-360.png`.
- **Accessibility:** touch targets stay >= 44 px (the Notifications link is a `touch-target`); no horizontal scroll at 320 px; focus order unchanged.
- **Widths to test after approval:** 320, 360, 390, 412 px and desktop.
- **Acceptance criteria:** wordmark and Sign out each render on one line at 320 and 360 px for every role shell; no horizontal overflow; Notifications visible and focusable; Playwright assertion added.

## C. Vendor dashboard wording (copy only)

- **Current text (verified in `src/app/vendor/page.tsx`, ~lines 82 to 85):** "Order handling (accept, prepare, hand over) arrives in the next release. For now you can see incoming orders but not act on them."
- **Why it is wrong:** vendor order actions exist (`/vendor/orders`, `/vendor/handover`, `/vendor/returns`; vendor navigation lists all three).
- **Proposed text (A, preferred):** "Manage incoming orders on the Orders page: accept, prepare and mark them ready. Use Handover to confirm collection and Returns to respond to return requests."
- **Proposed text (B, shorter):** "Manage your orders on the Orders page."
- **Scope:** the paragraph only. No change to permissions, transitions or logic. Search the repository for the same phrase before editing (none other found in `src/app` during this review).
- **Acceptance criteria:** stale phrase absent; new sentence present; the pause/resume form above it unchanged; e2e text assertion added.

## D. Admin and vendor mobile navigation

- **Current source:** `BottomNav` in `src/components/shells/nav-links.tsx` renders `items.slice(0, 5)`; `SidebarNav` (desktop) renders all items. Configuration in `src/components/shells/nav-config.ts` (and the rider layout).
- **Verified counts:** customer 5 (all shown), rider 4 (all shown), vendor 6 (5 shown: **Returns hidden**), admin 14 (5 shown) plus two destinations with **no navigation item**: Delivery points `/admin/delivery-points` and Categories `/admin/categories` (platform admin, aal2; reachable only from cards on `/admin`).
- **Every destination that must stay reachable.** Admin: Home `/admin`, Applications `/admin/applications`, Vendors `/admin/vendors`, Riders `/admin/riders`, Rider issues `/admin/rider-issues`, Payments `/admin/payments`, Refunds `/admin/refunds`, Reports `/admin/cases`, Returns `/admin/returns`, Reviews `/admin/reviews`, Jobs `/admin/jobs`, Settings `/admin/settings`, Audit `/admin/audit`, Roles `/admin/roles`, Delivery points, Categories. Vendor: Home `/vendor`, Orders `/vendor/orders`, Catalogue `/vendor/catalogue`, Shop `/vendor/profile`, Handover `/vendor/handover`, Returns `/vendor/returns`.
- **Proposal:** below `md`, show four primary destinations plus a fifth "More" link to a plain list of every remaining destination (a real page or a native disclosure; real links, `aria-current`, 44 px rows, no horizontal scrolling). Apply only to shells with more than five items (admin, vendor); customer and rider unchanged; desktop sidebar unchanged and gains the two missing admin items. "Hidden" never means removed: no route, role guard or permission changes (server guards still decide; a link a role cannot use stays harmless).
- **Mockups:** `nav-admin-current-360.png`, `nav-admin-proposed-360.png` (shows the More list, scrolled content cut at the capture height), `nav-vendor-current-360.png`, `nav-vendor-proposed-360.png`.
- **Roles to verify after approval:** platform admin, support agent, finance admin (pages a role cannot open must still show the existing forbidden state), vendor owner and staff.
- **Accessibility considerations:** More is a link/disclosure with an accessible name; the open list is reachable and escapable by keyboard; screen readers announce it as a navigation region; current page indicated when it is one of the More items.
- **Acceptance criteria:** a test asserts every item of each nav configuration is either in the bar or in More; each destination is reachable in two taps; keyboard reachability; existing role-matrix specs unchanged and passing.

## E. Desktop landing hero

- **Current source:** `src/app/(public)/page.tsx`, the hero section: one `bg-brand-800` block with left-aligned content; the right half is empty at desktop widths. (Content note, not a change proposed here: the hero says "approved AFIT community vendors"; AFIT's authorisation is pending, so this wording should be reviewed with the owner's branding decision.)
- **Constraints:** the official crest stays out until permission is confirmed; no AFIT colour is verified (website unreachable from the sandbox, no brand guide held); AFIT authorisation is pending; nothing may claim official brand compliance.
- **Concept A (no crest, implementable without permission):** `mockups/hero-concept-a-1440.png`: generic architecture-inspired block shapes in the existing teal palette fill the right half. Shapes are not a depiction of any real AFIT building.
- **Concept B (CONDITIONAL, proposal only):** `mockups/hero-concept-b-conditional-1440.png`: a blue/gold institutional treatment with a dashed **placeholder** where a crest would go. Blue and gold values are **illustrative, not official**, and the crest is not used. Only possible after AFIT permission and a sampled/official specification (external approval #33).
- **Current:** `mockups/hero-current-1440.png`.
- **Dependencies:** decisions 28 and 29; if the owner will adopt B later, implement the hero once (recommended: last).
- **Acceptance criteria:** no crest; any colour labelled provisional in docs; call-to-action and "open now" section unchanged; mobile layout unchanged; axe and heading order unchanged.

## What happens next

Owner marks each of A to E: approve as proposed / approve with changes / reject / defer. Only approved items are implemented, one commit each, with the regression tests listed above and a new audit capture directory for before/after comparison.
