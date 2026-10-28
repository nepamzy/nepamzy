# AFIT Market UI audit gallery

Real screenshots of the running application with synthetic local data, taken by `tests/visual-audit/ui-audit.spec.ts`
(each role signs in through the real sign-in page, including two-step sign-in). No mock-ups.

## How to view

Open an HTML file in a browser straight from the repository checkout (images are relative links):

| File | What it shows |
| --- | --- |
| `gallery.html` | **Master channel 2 final gallery**: for every page and state, desktop (1440 px) and mobile (390 px) side by side, original "before" next to final "after", plus a 320 px section. |
| `channel2-delta-gallery.html` | Same pages, but "before" is the state at the START of master channel 2, so only the vendor/rider/payment changes show as differences. |
| `page-inventory.md`, `channel2-delta-page-inventory.md` | Table of every route, role, state, HTTP status and which screenshots exist. |
| `capture-failures.md` | Pages that could not be captured (none in the final set). |

Open with: `xdg-open artifacts/afit-market-ui-audit/gallery.html` (Linux), `open ...` (macOS), or double-click it.

## Folders

```
redesign-before/     original baseline before any redesign (114 pages x desktop, mobile)
redesign-ch1-after/  after the first (shell-only) redesign pass (114 x 2)
redesign-m1-after/   after master channel 1 (136 x 2)
channel2-final/      FINAL set for master channel 2: desktop/ (139), mobile/ (139), narrow-320/ (12)
  <viewport>/<role>/<route>__<state>.png      roles: public, customer, vendor, rider, admin
```

`channel2-final` was captured from code commit `93bd991`. The older folders are kept as evidence of earlier states.

## Limits

- Synthetic data only; payment screens use obviously fake bank details.
- Real payment-provider pages, real map tiles and a hosted file store are not captured (they are not part of the local run).
- The `before` set for pages that did not exist originally shows "not captured".
