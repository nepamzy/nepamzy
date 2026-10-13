# Accessibility implementation plan (Master Prompt 1, Part 12)

Prepared 2026-10-13 against HEAD `daee8a4`. **No accessibility change was applied in this stage.** The delivery-proof policy is unchanged: the **drawn signature remains mandatory**, the typed acknowledgement stays disabled, and no PIN, QR code, photograph or other method was introduced. The signature pad is **not keyboard-accessible today**; this is disclosed, not hidden (K27, K65; `docs/accessibility-signature-proposal.md`).

## 1. What has actually been checked (evidence, not assumption)

- Automated axe checks on public pages and on each authenticated shell page (`tests/e2e/public-and-a11y.spec.ts`), keyboard focus order, visible focus, accessible names and 320 px reflow on the main screens plus the MFA challenge (`tests/e2e/accessibility-keyboard.spec.ts`), and a test that pins the signature limitation exactly as documented and checks the way out is keyboard-reachable. These ran in earlier stages; **they were re-run in this stage only as part of the final suite** (see the implementation report for the result).
- Contrast of the colour tokens was computed from the token values (text pairs 5.76 to 16.5:1; the only measured shortfall is the input border at 2.93:1, proposed fix in `visual-improvement-review.md`).
- **Not done:** any person-led review, any screen-reader use, any real-device or real-keyboard-only session. Automated tests establish only the issues they can detect; they do not establish accessibility.

## 2. Improvements that can be made WITHOUT changing delivery-proof policy (after owner prioritisation)

| Area                              | Proposed improvement                                                                                                                                                       | Notes                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Keyboard focus / dialogs / menus  | Audit `ui/dialog.tsx` and `ui/tabs.tsx` for focus trap, focus return, Escape and roving focus; apply the same checks to the proposed "More" navigation                     | Part of approved navigation work                                                    |
| Labels and accessible names       | Systematic review of icon-only and emoji-prefixed controls (navigation icons are `aria-hidden`; confirm every control has a text name); `aria-describedby` for field hints | Mostly in place via `ui/fields.tsx`                                                 |
| Error identification              | Ensure each form error is associated with its field (`aria-invalid`, `aria-describedby`) and announced; error summary focus on submit                                      | Action forms use a status/alert region today; per-field association to be verified  |
| Screen-reader announcements       | Confirm status changes (order status, saved, refund decision) use `role="status"`/`aria-live` politely; avoid duplicate announcements                                      | Toast/status components exist                                                       |
| Mobile navigation                 | The five-item bottom bar and "More" proposal (see the visual review)                                                                                                       | Needs owner approval (decision 30)                                                  |
| Form validation                   | Native `required`/`minLength` plus server validation (already used); ensure messages are specific and not colour-only                                                      | The new 18+ checkbox on sign-up is a native required checkbox with an error message |
| Zoom and reflow                   | Keep the 320 px reflow test; add 200 % and 400 % zoom checks on forms and checkout                                                                                         | Scripted only                                                                       |
| Contrast                          | Apply the approved border token; recompute all pairs in CI with a unit test                                                                                                | Needs owner approval (decision 30)                                                  |
| Order-status changes              | Verify the timeline conveys status by text, not colour only (it carries text today)                                                                                        |                                                                                     |
| Notifications                     | Browser notifications (future) must respect user permission and offer an in-app equivalent; in-app list is keyboard operable                                               | No push implemented                                                                 |
| Signature instructions / recovery | Improve the **instructions and error messages** around the drawn signature (what to do, how to redraw, how to contact support) without changing the requirement            | Wording only; test by a person                                                      |

## 3. Improvements that REQUIRE OWNER APPROVAL (policy or visible design)

- The five visual fixes (border token, header, vendor sentence, navigation, hero).
- Any **alternative delivery-proof path** (decision 31; options A to D in `owner-review-and-next-steps.md` §4). Keyboard-operable drawing (option B), a second proof type (C) and assisted signing (D) change proof strength and need counsel.
- Any change to what counts as valid proof, including enabling the existing typed acknowledgement.

## 4. Issues that need a person-led review

Screen-reader reading order and announcements on checkout, tracking and the delivery-proof screens; whether instructions make sense to a first-time user; cognitive load on long admin lists; meaning of icons and emoji labels; usability with switch devices and voice control; comprehension of error messages.

## 5. Cannot be validated automatically

Meaningful link and heading text, logical reading order, sufficient error guidance, keyboard traps in custom widgets, drawing-surface alternatives, time limits that matter to a person (for example the 20-minute proof token), motion preferences beyond `prefers-reduced-motion` styles.

## 6. Real-device and assistive-technology tests still required

Android TalkBack and iOS VoiceOver on the PWA; NVDA/JAWS on desktop; keyboard-only on real hardware; real Android background-location behaviour and notification-permission flows; browser zoom and text-size settings on real phones.

## 7. Claims explicitly NOT made

That the application is accessible, that automated tests prove accessibility, or that the drawn signature is keyboard-operable (it is not).
