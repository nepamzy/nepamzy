# Batch 6 report: Phases 11–12 (notifications, reviews, administration; security regression, reliability, pilot readiness)

**Verified code commit: `dc44d70938548557d366de0f20679949d4259016`.** The final commit on the branch only adds this report and the README status line (documentation); `pnpm lint` and `pnpm format:check` were re-run after it (section G). Nothing was deployed. No real payment, message, coordinate, account, paid service or production data was involved.

## A. Executive summary

- **Phase 11 built:** in-app notifications written by database triggers in the same transaction as the event (generic text only), an outbox with retry/back-off/dead-letter whose only channel is a **local sink**, user opt-in; reviews with eligibility rules, reports and a moderation queue (hide, never delete); a role-scoped admin overview, a job-health page, a settings page, bounded and filterable staff lists.
- **Phase 12 built:** a catalog-wide security regression suite, failure-injection tests, a rate-limit and endpoint-authentication coverage test, a health endpoint, a capped rider-issues queue, a local backup/restore rehearsal script (run and recorded), a jobs inventory, a data inventory, accessibility/performance notes, and the pilot-readiness checklist.
- **Not done / not claimed:** nothing schedules or monitors any job; no real notification channel; retention periods undecided; no manual accessibility review; no independent security audit; real Paystack behaviour still unverified. **The system is not pilot-ready and not production-ready** (`docs/pilot-readiness.md`).
- **Result:** every required command exits 0 on `dc44d70` (section G). Counts: unit 187 (+26), DB 295 (+53), Playwright 166 executions = 83 tests × 2 viewports (+14).

## B. Repository, commits and CI

| Item            | Value                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Branch / PR     | `claude/afit-market-phase-0-asm8xd`, draft PR #1                                                                          |
| Starting commit | `87a20d5` (Batch 5 report) on top of `52340e5` (Batch 5 implementation)                                                   |
| Batch 6 commits | `920b3ac` Phase 11 DB, `4c416bc` Phase 11 app, `03d40eb` Phase 12, `dc44d70` tidy; then the documentation commit (report) |
| Changed files   | `git diff --stat 87a20d5..dc44d70`: 59 files, 4,658 insertions, 95 deletions                                              |

**Batch 5 CI (verified this session through the GitHub API, per job).** `87a20d5`: push run #25 and pull-request run #26 both `success`; in run #25 job `checks` (lint, typecheck, test, build, check:secrets) and job `db-and-e2e` (db:start, make-env-local, test:db, Playwright install, Playwright) every step `success`, artifact upload skipped (only on failure). `52340e5` had **no CI run of its own** (it was pushed together with `87a20d5`, so CI ran once for the pair, on `87a20d5`). I did not read job logs, only step conclusions.

**Batch 6 CI:** reported for the exact final SHA in the pull request after the push (see the PR comment / section N at the time of writing: **pending at the time this file was written**; the result for the pushed SHA is stated in the hand-off message and PR, never assumed from the local run). The CI workflow now also runs `pnpm format:check`.

**Batch 5 regression gate:** the full Batch 1–5 suites (unit, DB, Playwright) ran inside the totals below with no test removed, skipped or loosened. Test edits: lists in `schema-hygiene.test.ts` (anon allowlist gained `get_vendor_reviews`) and `delivery.test.ts` (function catalogue gained `admin_overview`, `create_review`, `my_order_review`) were extended consciously; `helpers.ts` purge covers the new tables.

## C. Requirements traceability

See `docs/requirements-checklist.md` "Batch 6 additions" (every prompt item → status → evidence). Decisions recorded, not invented: review eligibility/immutability/caps (K58); notification retention (K57, undecided); settings without reason text (K59).

## D. Database changes

Migrations `20261015000001_notifications_reviews_admin.sql` and `20261015000002_bound_rider_issues.sql` (details: `docs/database.md`, "Batch 6 additions").

- Tables: `notifications`, `notification_preferences`, `notification_outbox`, `notification_deliveries`, `notification_errors`, `job_runs`, `reviews`, `review_reports` (RLS + restrictive aal2 policy; SELECT-only grants to `authenticated` on own-data tables; no API access to outbox/deliveries/errors/job_runs).
- Functions: user (`list_my_notifications`, `notification_mark_read`, preference get/set, `create_review`, `my_order_review`, `report_review`), public (`get_vendor_reviews`), staff (`admin_overview`, `admin_job_health`, `staff_list_review_reports`, `moderate_review_report`, `unhide_review`), service role only (`notification_outbox_claim/complete`, `record_job_run`). Replaced with bounded versions: `staff_list_refunds`, `staff_list_cases`, `list_returns`, `list_rider_issues`.
- Triggers: notification triggers on `order_status_history`, `refund_events`, `case_events`, `case_statements`, `return_requests`; `reviews_guard`.
- `supabase db lint --local --level warning`: no schema errors (an earlier run showed three "never read variable" notes; fixed in `dc44d70`).

## E. Notifications, reviews and administration: design

**Notifications.** A trigger on each existing event table calls `app_private.notify(user, kind, title, body, link, event_key)`. Wording is fixed per event; links are relative and checked by a pattern constraint; `(user_id, event_key)` is unique, so a repeated event cannot duplicate. `notify` catches its own errors and records them (a test makes the insert raise: the order still moves). The outbox row is created `pending` only when the user opted in to the local sink, otherwise `suppressed`. The worker route claims at most 20 rows with `for update skip locked`, logs a line (the "send"), and completes each row; failures retry after 2^attempts minutes and become `dead` after five attempts; rows stuck in `processing` for 5 minutes are reclaimed. **No email/SMS/push provider exists in the code.**

**Reviews.** One per order, by the order's customer, only for `COMPLETED` / `PARTIALLY_REFUNDED`; shop members cannot review their own shop; rating 1–5; comment 3–500 characters or empty; 10 a day; immutable; no deletion. Public output: rating, comment, date, average (tenths) and count, computed at read time. Reports (one per reporter and review, 10 a day) feed a queue; support or a platform administrator hides with a ≥ 10-character reason; a decider cannot be the review's author or the reporter; only a platform administrator can restore. Hiding never touches orders, ledger or refunds (tested).

**Administration.** `/admin` shows counters per role (support: reports, returns, review reports, rider issues, deliveries; finance: refunds and flags; administrator: all plus applications and notification queue). `/admin/jobs` (administrator) shows last run, last success, failures in 24 h per job and the notification queue. `/admin/settings` (administrator) edits the known numeric/policy settings through `set_platform_setting`, which validates and audits; `mock_payments_enabled` and `settlement_policy` stay locked. Refunds/cases lists have status filter, order/case-number search and paging. `/admin/reviews` is the moderation queue. The access matrix is extended (`docs/access-matrix.md`).

## F. Security review (nothing here was reviewed independently)

- **Catalog regression** (`security-regression.test.ts`, 11 tests): every callable function checks the caller except six pinned public reads; callers read via `auth.uid()` also demand aal2 except three identity read-backs; anonymous callers reach only the published reads; an aal1 account runs nothing beyond a pinned set (public reads, three read-backs, `cart_clear`/`cart_quote` which the cart policy allows at aal1); an aal2 plain customer calling every function with empty arguments gets only a pinned list of self-scoped reads; append-only tables are pinned with the verbs they block (ledger, audit, status history, refund/case events and others block update and delete); forged JWT claims (`app_metadata` roles) grant nothing; direct writes to ledger, orders, audit, notifications, reviews, job log, roles and refunds are refused with 42501; other users see no one else's notifications/refunds/cases; the 12 list functions without a `LIMIT` are pinned with a reason.
- **Failure injection** (`failure-injection.test.ts`): a failure when the handover-evidence row is written leaves status, ledger, session and notices untouched and the same token still completes afterwards; a failure inside refund creation leaves no refund, event or audit row; a failing audit write rolls a privileged setting change back. Provider-timeout reconcilability is covered by the Batch 5 `outcome_unknown` tests (not repeated).
- **Replay / forgery / race re-tests:** the Batch 4–5 concurrency suites (delivery completion 5 layers, refund cap 3 layers, rider capacity, tokens, webhooks) ran unchanged and pass; Batch 6 adds the notification claim race with control removal (8 workers; removing the lock produces duplicates, proving the test has power).
- **Endpoints:** a unit test requires every API route to authenticate in code (bearer secret with constant-time compare, webhook HMAC, or the central access check); only `/api/health` is public by design (ok/not ok, rate limited, nothing else).
- **Rate limiting:** reviewed (list in `docs/security-privacy.md` §5d). Added limiters: order tracking polling (40/min/user) and health (60/min/address). Review actions are limited in the application (10/hour) and in the database (10/day). Staff-only actions are not rate limited (role gated, audited). Weakness unchanged: IP keys trust `X-Forwarded-For` (S-limitations).
- **Dependencies:** `pnpm audit`: 1 high advisory (`braces`, development-only chain through eslint tooling; no patched version); `pnpm audit --prod`: none. Nothing upgraded.
- **Headers/CSP, input limits, error and log leakage, secrets:** reviewed, unchanged except as noted (details in `security-privacy.md` §5d). `pnpm check:secrets` passes (316 tracked files, 31 client-bundle files, 2 secret values checked). No new environment variable; nothing `NEXT_PUBLIC_`.
- **Residual risk (not removed):** jobs unscheduled/unmonitored (K56); retention undecided (K57); settings without reason text (K59); no manual or independent review.
- **Earlier invariants re-asserted by the existing suites (all green):** drawn signature mandatory and typed acknowledgement disabled; only the account holder completes delivery; riders cannot complete; refund cap and idempotency; support approval limit ₦0 and separation of duties; rider cap five and one active rider per order; placeholder rider terms refused; pickup code separate from the proof token; GPS never completes an order.

## G. Exact commands and results (this sandbox, commit `dc44d70`, from a script that records each command's own exit status)

| Command                                                                               | Result                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                           | exit 0                                                                                                                                                                                                      |
| `pnpm typecheck`                                                                      | exit 0                                                                                                                                                                                                      |
| `pnpm format:check`                                                                   | exit 0                                                                                                                                                                                                      |
| `pnpm test` (unit)                                                                    | exit 0; **187 passed**, 14 files (Batch 5: 161, 13 files)                                                                                                                                                   |
| `pnpm build`                                                                          | exit 0                                                                                                                                                                                                      |
| `pnpm check:secrets`                                                                  | exit 0 (316 tracked files, 31 client bundle files, 2 secret values)                                                                                                                                         |
| `bash scripts/db-reset.sh`                                                            | exit 0 (before and after the DB tests)                                                                                                                                                                      |
| `pnpm exec supabase db lint --local --level warning`                                  | exit 0; "No schema errors found"                                                                                                                                                                            |
| `pnpm test:db`                                                                        | exit 0; **295 passed**, 22 files (Batch 5: 242, 16 files). New: `notifications` 16, `notification-concurrency` 4, `reviews` 11, `admin` 8, `security-regression` 11, `failure-injection` 3 = 53             |
| `pnpm exec playwright test` (mobile-360 + desktop)                                    | exit 0; **166 passed** in 12.3 min = 83 tests × 2 (Batch 5: 152 = 76 × 2). New: 7 tests in `engagement.spec.ts`                                                                                             |
| `bash scripts/db-restore-drill.sh` (`pnpm db:restore-drill`), run after the e2e suite | exit 0; "restored database matches the source" (fingerprint: 53 tables all with RLS, 303 constraints, 174 functions, 42 triggers, 99 policies, 128 indexes, identical function ACL hash and row-count hash) |

Notes: DB tests ran immediately after a reset. The drill must run on data created through the application, not after the DB suite (see K61 and `recovery.md`; the first attempt against a post-suite database failed on 7 foreign-key errors from test-helper orphan rows, which is the drill working as designed). After the report commit: `pnpm lint` and `pnpm format:check` re-run (results in the hand-off message).

## H. Accessibility

**Automated** (axe WCAG A/AA, serious+critical fail; horizontal-overflow check; mobile-360 and desktop): `/notifications`, order page with review form, vendor page with reviews, `/admin` overview (support), `/admin/reviews`, `/admin/jobs`, `/admin/refunds` filtered, `/admin/settings`. One real defect found and fixed by this check: long setting names overflowed the 360 px viewport by 47 px. **Scripted keyboard checks** (real key presses): mark-all-as-read button; report disclosure opens with Enter and Tab reaches reason → note → submit; admin filter form (focus, type, Enter submits). **Manual and screen-reader/zoom/real-device review: not done** (K11); drawn signature still has no keyboard path (K27). Details: `docs/testing/accessibility-and-performance.md`.

## I. What failed or is incomplete

- Not built: real notification channel; scheduling/monitoring/alerting; retention and purge for notifications and audit data; data-subject export/deletion; reason text for settings changes; shop replies, community rules, rider ratings; manual accessibility review; incident response plan; rate-limit table clean-up job.
- During the batch: moderation e2e first failed because a short reason is blocked by the form's own `minLength` (test fixed; the short-reason case is covered at the database layer); the first restore drill failed on test-orphan rows (documented, script now says so); the first catalogue test run exposed that cart functions are intentionally usable at aal1 (pinned and explained).

## J. Technical debt

Admin lists show no totals and a possibly empty last page (K60); `set_platform_setting` accepts unknown keys from a direct database caller (K63); the DB test helpers leave orphan rows by design (K61); CI does not run the restore drill or `supabase db lint`.

## K. Dependencies and cost

No new dependency, no paid service, no new environment variable. `pnpm audit` finding as in §F.

## L. Unresolved owner decisions (none were decided here)

MFA recovery/backup authenticator; TOTP enrolment policy; pickup-code reissue/unlock; signature storage/retention and typed acknowledgement; job scheduling and alerting; AFIT-approved points/coordinates/zones; approved rider terms; rider identity/vehicle verification (K46); unsafe-batch rules (K45); refund fee share and partial-refund policy; return policy per category; mapping provider; stock policy; repository rename; pilot caps and pricing; legal/privacy/payment approvals; **new:** notification retention, review policy and community rules, real notification channel, backup storage and recovery targets, incident response, change-control for settings.

## M. External approvals and operational blockers

`docs/external-approvals.md` items 1–26 (new: 20–26). Operational blockers: no scheduler, no monitoring, no hosted environment, no backups beyond the local rehearsal, no support staffing, no incident plan.

## N. Deployment and pilot status

**Not deployed. Not production-ready. Not pilot-ready.** No live credentials were used; Paystack was only ever the local fake; no real email/SMS/push was sent; coordinates are synthetic; no real accounts or transactions exist. Checklist with honest statuses: `docs/pilot-readiness.md`.

## O. Final recommendation

**CONDITIONALLY COMPLETE.** The Phase 11–12 scope is implemented and tested locally and every required command passes on `dc44d70`. It is conditional on: owner review of the decisions recorded as defaults (K58, K59), CI results for the pushed SHA, and the open items in sections L and M, none of which more code can close.

---

## INDEPENDENT REVIEW PACKAGE FOR CHATGPT

1. **Commits:** `87a20d5..dc44d70` plus the documentation commit; list with `git log --oneline 87a20d5..HEAD`; files with `git diff --stat 87a20d5..HEAD`.
2. **Migrations:** `supabase/migrations/20261015000001_notifications_reviews_admin.sql`, `20261015000002_bound_rider_issues.sql`.
3. **Security-critical functions to read first:** `app_private.notify` and the `notify_*` triggers; `notification_outbox_claim`, `notification_outbox_complete`; `create_review`, `report_review`, `moderate_review_report`, `unhide_review`, `reviews_guard`; `admin_overview`, `admin_job_health`; `staff_list_refunds`, `staff_list_cases`, `list_returns`; the grants/RLS block at the end of the first migration.
4. **RLS and grants:** end of migration 1; catalog tests `tests/db/schema-hygiene.test.ts` and `tests/db/security-regression.test.ts`; matrix `docs/access-matrix.md` ("Batch 6").
5. **Application code:** `src/server/modules/engagement/{queries,actions}.ts`, `src/app/api/jobs/process-notifications/route.ts`, `src/app/api/health/route.ts`, `src/app/api/orders/[id]/tracking/route.ts` (new limiter), pages under `src/app/notifications`, `src/app/admin/{reviews,jobs,settings}`.
6. **Tests:** DB `notifications`, `notification-concurrency`, `reviews`, `admin`, `security-regression`, `failure-injection`; unit `endpoint-coverage`; e2e `engagement.spec.ts`.
7. **Operations/privacy docs:** `docs/operations/jobs.md`, `docs/operations/recovery.md`, `docs/privacy/data-inventory.md`, `docs/pilot-readiness.md`, `docs/testing/accessibility-and-performance.md`.
8. **CI:** Batch 5 per-job result in §B; Batch 6 result for the pushed SHA is reported on the PR.
9. **Known issues:** K56–K64 added; K54 revised; all earlier ones unchanged and visible (including K19/K30, K34, K45, K46).
10. **Failed / skipped / not run:** nothing skipped. Not run: manual accessibility, real-device tests, real Paystack, load tests, hosted restore, independent audit.
11. **Reproduce:** `pnpm install`; `pnpm db:start`; `bash scripts/make-env-local.sh`; then the commands in §G in that order (reset before `test:db`, reset again before Playwright, drill last).
