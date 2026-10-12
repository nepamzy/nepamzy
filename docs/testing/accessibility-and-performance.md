# Accessibility and performance notes (Batch 6)

## Accessibility: what was checked, and how

**Automated (axe-core, WCAG 2.0/2.1 A and AA, serious/critical impact fail the test; each page also fails on horizontal overflow), run at mobile-360 and desktop by Playwright:**

- Earlier batches: public pages, sign-in/MFA, marketplace, cart/checkout, vendor and rider screens, order pages, help/report pages, delivery-proof panel.
- Batch 6 (`tests/e2e/engagement.spec.ts`): `/notifications`, order page with review form, vendor page with reviews, `/admin` (overview), `/admin/reviews`, `/admin/jobs`, `/admin/refunds` (filtered).

**Keyboard checks (scripted, real key presses, not just labels):**

- `/notifications`: the "Mark all as read" button takes focus and activates with Enter.
- Report-a-review disclosure: the `<details>` summary takes focus and opens with Enter; Tab moves into the reason select, then the note, then the submit button.
- Admin list filter: Status select → Tab → search box → type → Enter submits the GET form and the URL changes.
- Earlier batches: tab order and activation of the main sign-in and checkout flows; focus management in dialogs.

**Patterns used in the new screens:** every control has a visible label (no placeholder-only fields); status and error messages use `role="status"` / `role="alert"`; the star rating is announced as "N out of 5" and the visual stars are not the only carrier of meaning; list filters are plain GET forms (work without JavaScript); pagination is a `nav` with "Newer / Older" links and a page number; touch targets use the shared 44 px `touch-target` class; no information is conveyed by colour alone (badges carry text).

**Not done — do not read the above as an accessibility sign-off (K11):**

- No screen-reader testing (NVDA, VoiceOver, TalkBack).
- No browser zoom / text-size / high-contrast / reduced-motion review by a person.
- No real-device testing.
- The **drawn signature has no keyboard path** (K27). The typed-acknowledgement alternative exists but is disabled pending an owner/legal decision.
- Plain-language wording was reviewed by the engineer only; no campus user has read it.

## Performance and boundedness review (no load test was run)

There was **no load or soak testing**. What was reviewed is whether any request can return or process an unbounded amount of data.

- **Database lists:** every staff list takes `limit` (clamped to 50–100) and `offset` (clamped to 5,000–10,000) and filters by validated status; search uses `position()` (no pattern injection, no wildcard scans). A catalog test (`security-regression.test.ts`) pins the 12 remaining list functions that have no `LIMIT` and the reason each is naturally bounded; a new unbounded list fails the test. The one open-ended staff queue found (`list_rider_issues`) was capped at 100 in this batch.
- **Pages:** notifications (20/page), reviews (10/page), admin refunds and cases (25/page), review reports (20/page) paginate; page numbers from the URL are clamped to 1–500.
- **Jobs:** the notification worker claims at most 20 rows per call (database cap 50); the claim uses `for update skip locked` so workers do not block each other.
- **Indexes:** notification lists use `(user_id, created_at desc)` and a partial unread index; the outbox has partial indexes for pending and stuck rows; reviews are indexed by shop for published rows; open review reports have a partial index. These were chosen from the query shapes; `EXPLAIN` on realistic volumes has **not** been done because no realistic volume exists.
- **Polling:** customer tracking polls every 10 s per open tab (rate limited to 40/min per user). No Realtime (K37).
- **Not measured:** response times under concurrency, database size growth, connection limits of a hosted plan, build size budgets.
