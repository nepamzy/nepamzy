# Visual audit report (before and after the colour change)

All screenshots are of the real running application with **synthetic local data**; every role signed in through the real UI with an authenticator code. Nothing is a mockup. Capture tooling: `tests/visual-audit/ui-audit.spec.ts` with `playwright.ui-audit.config.ts`; review material built by `scripts/build-ui-audit-gallery.mjs` from the capture inventories.

| Set | Location | Viewport | Pages and states | Files | Failures |
| --- | --- | --- | --- | --- | --- |
| Before, desktop | `before/desktop/<role>/` | 1440x900, 1x | 114 | 114 | 0 |
| Before, mobile | `before/mobile/<role>/` | 390x844, 1.5x | 114 | 114 | 0 |
| After, desktop | `after/desktop/<role>/` | 1440x900, 1x | 114 | 114 | 0 |
| After, mobile | `after/mobile/<role>/` | 390x844, 1.5x | 114 | 114 | 0 |

"Before" was captured from the unmodified code of commit `dfb296a` (a clean checkout, built separately) so that it shows the original teal/orange interface. "After" was captured from the final code. Review entry points: `gallery.html` (open in a browser: page name, route, desktop and mobile, before beside after), `page-inventory.md` (114 rows, every one present in all four sets), `contact-sheet-{before,after}-{desktop,mobile}.png`, `visual-review-report.pdf`.

## What changed visually
Teal `#0b5551` and the burnt-orange accent were replaced by a provisional blue (`#174a9c`, `#10346f`), a decorative gold rule (`#f4b400`) on every header, sidebar and active navigation marker, a red for errors and disputes (`#a3211a`), white cards on a cool white page (`#f6f8fc`). **These colours are our own provisional choice, not official AFIT colours, and no AFIT crest or logo is used.** Layouts were not changed. Status is always shown with a text label as well as colour (for example "Disputed", "Confirmed by both", "Settled by administrator: not received").

## Observations
- The 14 pages added by this and the previous stage (rider payments in six states, customer pay-delivery-fee in four states, receipt list and public receipt check, admin delivery-fee payments, settlements, data requests, menus) appear in both before and after sets; "before" shows them in the old colours.
- Mobile full-page captures show the fixed bottom navigation bar part-way down the image. That is how full-page screenshots handle fixed elements, not a layout fault.
- The admin delivery-fee page lists several payments because the local database also holds rows from earlier test runs.
- Automated accessibility (axe, keyboard, 320 px reflow) passes on the final code (Playwright suite, section 15 of the platform report). This is not a manual assistive-technology review.

## Not captured
Nothing applicable was left out. Pages that need real external services (live Paystack checkout, real email, real maps) do not exist in this build and could not be captured.
