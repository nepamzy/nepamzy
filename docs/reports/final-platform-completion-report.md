# Final platform completion report

Prepared 2026-10-17. Branch `claude/afit-market-phase-0-asm8xd`, draft PR #1. Final implementation commit: `0e1f24d` (the commit holding this report follows it). Starting point: `dfb296a`, working tree clean.

Status words used below: **COMPLETE AND VERIFIED**, **IMPLEMENTED BUT NOT FULLY VERIFIED**, **BLOCKED BY EXTERNAL DEPENDENCY**, **REQUIRES OWNER DECISION**, **NOT COMPLETE**.

## 1. Executive summary

Everything in this campaign that could be completed safely within the existing approved scope was completed and verified locally (test-mode and fakes only). The rider direct delivery-fee payment is now connected to checkout through a trusted server-side decision and is **switched OFF by default** (a platform administrator turns it on, with an audited reason). Rider bank account numbers are encrypted at rest. Account erasure, receipt-check rate limiting and a strict 18+ declaration were added. A provisional blue/gold/red/white palette was applied through tokens, and every page was captured before and after at desktop and mobile with a gallery, inventory, contact sheets and a PDF.

**The platform is NOT production-ready.** Real Paystack, real notifications, real bank verification, AFIT authorisation and branding, legal approval, an independent security audit and several owner decisions remain (section 17/18). Nothing was deployed; no real money, credential or bank was touched.

## 2. Branch and commit

`claude/afit-market-phase-0-asm8xd`, HEAD at the time of the test runs below: `0e1f24d`. New migrations (all additive, none destructive): `20261020000001_delivery_fee_collection_decision`, `20261020000002_age_gate_strict`, `20261020000003_bank_encryption`, `20261020000004_account_erasure`.

## 3. Features completed

| Item                                                                      | Status                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Trusted checkout decision for delivery-fee collection (`direct_to_rider`) | COMPLETE AND VERIFIED (locally; OFF by default)                    |
| Duplicate delivery-charge prevention                                      | COMPLETE AND VERIFIED                                              |
| Strict 18+ declaration on public sign-up                                  | COMPLETE AND VERIFIED (self-declaration only; age is not verified) |
| Rider bank-number encryption at rest, backfill and rotation tooling       | COMPLETE AND VERIFIED locally; key custody REQUIRES OWNER DECISION |
| Account erasure that keeps financial records                              | COMPLETE AND VERIFIED; retention periods REQUIRE LEGAL ADVICE      |
| Rate limiting of the public receipt check                                 | COMPLETE AND VERIFIED (shared database limiter)                    |
| Colour system (provisional) applied via tokens, contrast-tested           | COMPLETE AND VERIFIED                                              |
| Full-platform screenshots, inventory, gallery, PDF                        | COMPLETE AND VERIFIED                                              |

## 4. Rider-payment activation

**Decision source.** A new platform setting `delivery_fee_collection_mode` (`paystack` default, or `direct_to_rider`) can be changed only through `set_platform_setting`: platform administrator at aal2, a reason of 10 to 500 characters, validated enum, old and new value written to the audit trail. `create_order` reads it inside the order transaction; the browser sends only fulfilment, delivery point and an idempotency key, so a customer, vendor or rider cannot choose the mode, and `orders.delivery_fee_collection` is immutable after creation (trigger) and checked against the total (`orders_total_matches`). Each order's audit event records the mode and `decided_by: platform_setting`.

**When it applies.** Only delivery orders with a fee greater than zero, created while the mode is `direct_to_rider`. The cart quote shown at checkout comes from the same function (`pay now` total without the fee, and the amount owed to the rider). Pickup orders, zero fees and every order created earlier stay `paystack`; historical orders are never switched.

**Lifecycle (verified end to end in `tests/db/delivery-fee-collection.test.ts`, with real rider journey, proof of delivery and fake-Paystack payment):** quote -> `create_order` (marker plus total excluding the fee) -> Paystack test payment of exactly the items total -> vendor and rider steps -> delivery completed -> rider adds bank details -> customer opens the payment (snapshot) -> customer reports -> rider confirms or disputes -> one receipt -> audit and dashboards. The UI side is covered by `tests/e2e/delivery-fee-checkout.spec.ts` (administrator changes the setting through the real settings page; checkout and order page wording; no payment requested before delivery) and `tests/e2e/delivery-fee.spec.ts`.

**Not claimed.** Confirmation by customer and rider is two parties' statements, not bank verification; no provider is approved. No rider payout, no split payment, no automatic delivery-fee refund, vendor commission untouched. The local "test pay" button records no ledger entry, so a direct order paid that way is simply never eligible; the Paystack/fake path records the ledger and is what the tests use.

## 5. How duplicate delivery charges are prevented

1. The marker is decided server-side from a persisted setting, immutable, and tied to the total by a database check. 2. Eligibility is a pure function of persisted records: `paystack` marker -> not applicable (never asked again); marker `direct` with no fee recorded, or Paystack money received above the payable total -> **ambiguous: no charge, listed for administrators**; unpaid, undelivered or no rider bank details -> not ready; an order that is cancelled, refunded, disputed, returned or otherwise not `COMPLETED`/`PARTIALLY_REFUNDED` -> not ready. 3. One payment record per order (unique), opening is idempotent, report/respond calls are idempotent and a disputed record cannot be overwritten. 4. A later setting change never alters existing orders. All of this is asserted by the DB tests above.

## 6. 18+ enforcement and limits

The database rejects (at commit, on `auth.users`) any Auth-service insert that is unconfirmed, not invited, not SSO/anonymous and lacks `adult_declared` as the **JSON boolean `true`** (strings, numbers, arrays and `false` are refused; this strictness is new). Proven against the real Auth API (`tests/e2e/age-gate-api.spec.ts`: missing, `false`, `"no"`, `1`, `"true"`, `[true]` rejected; `true` accepted and timestamp stored; administrator-created confirmed accounts and invitations still work; unconfirmed administrator-created accounts are refused), at database level (`tests/db/rls.test.ts`) and in the UI (`customer-journey.spec.ts`). The sign-up page states the 18+ rule and that age and identity are **not** checked. A strict-logic defect (three-valued NULL) was caught by the tests and fixed. Email confirmation stays required (pinned by `tests/unit/auth-config.test.ts`). Existing accounts were **not** given a declaration they never made. The terms and privacy notice are unpublished drafts, and the page says so. **Limit: a self-declaration does not establish anyone's age; no identity provider was added.**

## 7. Banking-data encryption

AES-256-GCM, application level (`src/server/security/field-crypto.ts`), cipher format `v1.<keyId>.<iv>.<ct+tag>`; the database stores only the cipher and the last four digits; the old plaintext function was removed so the API cannot store a plain number. Only the paying customer's own pay screen decrypts (server-side); staff and riders see masked numbers; errors and logs carry codes only. Keys are environment-only (`BANK_DATA_KEYS`, `BANK_DATA_KEY_ID`), never committed; `pnpm check:secrets` now also scans for them. Without a key the app fails closed. Legacy plaintext rows are preserved and handled by `scripts/encrypt-bank-details.mjs` (idempotent, dry-run, rotation, counts only); `admin_bank_encryption_status()` shows what remains. Tests: crypto unit tests (round trip, tamper, wrong or missing key, rotation, no leakage), script/app interop, DB tests (cipher-only API, masked staff view, snapshot copy). Runbook for rotation and recovery: `docs/operations/bank-data-encryption.md`. **Remaining dependency:** production key custody (secret manager, offline backup) and a KMS decision; the backfill must be run on any environment that already has rows.

## 8. Account erasure and financial records

`admin_erase_account` (platform administrator, aal2, reason) turns the account into an anonymous tombstone, removes personal data and bank details, scrubs bank snapshots, anonymises receipt names (receipts stay verifiable), keeps orders, payments, ledger, refunds, settlement lines, audit trail, disputes and append-only notes, refuses while any obligation is open (open orders, refunds, reports, returns, unresolved delivery-fee payments, active deliveries, an active shop, staff roles) and is idempotent; an append-only `account_erasures` record is written. A UI for it sits on `/admin/data-requests`. Tests: `tests/db/account-erasure.test.ts` (customer, rider, receipts, blockers, authorisation, idempotency). Runbook: `docs/operations/account-erasure.md`. **No retention period was invented**: how long financial records and retained free text must be kept needs qualified Nigerian legal and tax advice.

## 9. Receipt-verification rate limiting

Every call to the public check page counts against a per-address ceiling (default 30 per 10 minutes, `RECEIPT_VERIFY_MAX_PER_WINDOW`), using the existing database-backed limiter, so the limit is shared by all app instances. Over the limit the page shows a generic notice; invalid and unknown tokens give the same neutral answer; the token is never echoed or logged. E2E: `delivery-fee-checkout.spec.ts`. **Limit:** the address comes from `X-Forwarded-For`, which a client can forge unless a trusted proxy sets it (already documented in `docs/security-privacy.md`); deploy behind a trusted proxy.

## 10. Remaining security risks

No independent security audit has occurred. Open: key custody and no KMS; client-forgeable address header without a trusted proxy; email confirmation is a dependency of the age gate; private file storage does not exist (so no evidence upload); MFA recovery after losing all factors (K3) and background GPS (K2) remain owner/real-device items; retained append-only notes cannot be erased by design; real Paystack was never exercised (K19/K30). Review performed this stage: authentication and sessions (unchanged, regression suites pass), RLS and function grants (catalogue-wide tests pass; new functions pinned), privileged operations (new ones are administrator-only, aal2, reason-recorded), storage (none in use), CSRF (server actions with Next's origin checks; unchanged), secrets (scan extended), information disclosure (generic errors), dependencies (`pnpm audit --prod` clean), audit logging (all new actions audited), rate limiting (receipt check added; existing sign-up/MFA limits unchanged).

## 11. Other previously unfinished items

Inventory of `docs/known-issues.md` and the placeholder register, classified: **Must fix before testing:** none found. **Fixed this stage:** K10 (CI runs DB and e2e; stale), K17/K25 (stale "preview" notes), K72, K76, K77, K78, K79, stale CI comment, viewer-specific payment wording, tokens for the last hard-coded colours. **Must fix before production / external:** real Paystack account and verification (K19, K30), real notifications and a scheduler (K18, K39, K56), AFIT authorisation, brand specification, delivery zones (K36), approved rider terms (K38), legal documents (K73), legal retention (K7, K57), bank verification (K4, K29), manual accessibility review (K11, K65), key custody (K78). **Owner decisions:** whether to switch the delivery-fee mode on (K77), age verification (37), rider cancellation/failed-delivery/tips/dispute escalation (33), MFA recovery (K3), delivery proof policy (31), return logistics (K49). **Deferred:** dark mode, Realtime, push notifications, product images.

## 12. Colour palette (PROVISIONAL, not official AFIT colours)

Blue `#174a9c` (700), `#10346f` (800), `#1d57b8` (600), `#e9f0fc` (50); gold `#f4b400` (decorative only), gold text pair `#7a5400` on `#fff4cf`; red `#a3211a` on `#fdebe9`; white `#ffffff`, surface `#f6f8fc`, ink `#131c2b`. Replaced teal `#0b5551` and the burnt-orange accent. All colours are tokens in `src/app/globals.css`; a unit test fails if a component hard-codes a hex value and checks text pairs (4.5:1), control borders and focus ring (3:1). Status is never colour-only. No crest or official asset is used. Details: `docs/design-tokens.md`.

## 13. Screenshots

Folder `artifacts/afit-market-ui-audit/`: `before/{desktop,mobile}/<role>/...png` (original UI), `after/{desktop,mobile}/<role>/...png` (final UI), `gallery.html` (page name, route, desktop and mobile, before beside after), `page-inventory.md`, `contact-sheet-{before,after}-{desktop,mobile}.png`, `visual-review-report.pdf`, `inventory.json` per capture, `visual-audit-report.md`. Capture tooling: `tests/visual-audit/ui-audit.spec.ts`, `playwright.ui-audit.config.ts`, `scripts/build-ui-audit-gallery.mjs`. Captured with synthetic local data, each role signed in through the real UI with an authenticator. Desktop 1440x900 at 1x; mobile 390x844 at 1.5x. Full-page captures show the fixed mobile bottom bar mid-page: that is a capture artefact of full-page screenshots, not a layout defect. **114 pages and states, 456 screenshot files, 0 capture failures** (before and after, desktop and mobile).

## 14. Page inventory

See `artifacts/afit-market-ui-audit/page-inventory.md` (generated from the capture inventories, 114 rows, every row captured in all four sets). Roles covered: public (landing, vendors, product, login, sign-up, MFA, offline, 404, receipts check valid and invalid, guard redirects), customer (cart, checkout, orders and all states, delivery-fee payment states, receipts, help, reports, notifications, account, security, data requests, applications), vendor (dashboard, orders, catalogue, profile, handover, returns, earnings, menu), rider (dashboard active and inactive, jobs, payments in every state, profile), administrator (all 16 admin pages plus case detail, settlements, data requests, delivery-fee payments, menu, and role-scoped views for support and finance).

## 15. Test results (exact, final code)

| Suite                                                                   | Passed                                     | Failed | Skipped / blocked  |
| ----------------------------------------------------------------------- | ------------------------------------------ | ------ | ------------------ |
| Unit (`pnpm test`)                                                      | 301 (18 files)                             | 0      | 0                  |
| Database (`pnpm test:db`, fresh reset)                                  | 371 (31 files)                             | 0      | 0                  |
| Playwright, full suite, both projects (mobile 360 and desktop), one run | 196                                        | 0      | 0 skipped, 0 flaky |
| format:check, lint, typecheck, build, check:secrets, `audit --prod`     | clean (run locally; see section 16 for CI) |        |                    |

New in this stage: 5 crypto unit tests, 1 script interop test and palette tests; DB tests for the collection mode lifecycle (8) and erasure (5) and updated payment, snapshot and age-gate tests; e2e `delivery-fee-checkout` (checkout integration through the real settings page, rate limit), extended `age-gate-api` and `delivery-fee`. One test defect (three-valued logic in the strict age gate) and one fixture assumption (order status for eligibility) were found by the tests and fixed in code, not by weakening assertions. The first DB run after a failed run can show a leftover-row failure in `notifications.test.ts`; always reset the database first (documented convention). Not run, not claimed: real Paystack, real notifications, real-device GPS, assistive-technology review, independent audit, restore drill on the new schema.

## 16. CI

Checked from GitHub for the actual commits. `c31a45d` (all new functionality, colours, runbooks): both jobs **success** (checks, and db-and-e2e with the full database and Playwright suites). `cd7bea6`: job `db-and-e2e` **success** (full DB and Playwright suites on the code used for this report); job `checks` **failed at `format:check`** because the draft of this report was not Prettier-formatted, so the later steps of that job did not run in CI; I ran lint, typecheck, unit tests, build, secret scan and audit locally (all clean). That formatting defect is fixed in the commit that carries this report. The result for that commit is reported in the hand-over summary because it cannot be known inside the commit itself. Branch protection and CI settings were not touched; the only workflow edit is a stale comment.

## 17. Remaining external dependencies

Real Paystack test and live credentials and an approved verification procedure; a bank-verification provider (or an accepted manual standard); real email/SMS/push providers and privacy review; a production scheduler and alert route; secret manager / KMS; trusted proxy; AFIT authorisation, brand specification, delivery points and zones; approved rider terms and agreements; legal documents reviewed by counsel; legal retention advice; real-device GPS tests; assistive-technology accessibility review; independent security audit; restore drill on the real platform.

## 18. Production blockers

All of section 17, plus: no live payment ever tested; direct delivery-fee mode undecided (default off); 18+ is a declaration only; owner decisions listed in section 11; keys not provisioned; a backfill run needed wherever legacy bank rows exist.

## 19. Dormant or incomplete features

Direct delivery-fee payment (wired, **off by default**); evidence upload and rider photo (no private storage); vendor and rider payouts (not built, by decision); real notifications (local sink); real refunds (fake provider); automatic erasure from the user's own screen (administrator-run); age verification (not built).

## 20. Final readiness assessment

**READY FOR DEDICATED TESTING (local, fakes only), WITH DOCUMENTED LIMITATIONS. NOT READY FOR PRODUCTION OR A PILOT.**
