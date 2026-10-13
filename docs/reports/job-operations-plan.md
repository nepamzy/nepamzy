# Job monitoring and recovery plan (PLAN ONLY)

Prepared 2026-10-13 against HEAD `f368712`. Facts below come from `supabase/migrations/20261015000001`, `20261016000002`, the three job routes under `src/app/api/jobs/`, `scripts/run-jobs.mjs` and `docs/operations/jobs.md`. **No scheduler, alerting service, credential or requeue tool is added by this document.** Detection exists; automatic running, alerting and recovery do not.

## 1. Existing jobs and how they are triggered

| Job                     | Trigger today                                                                       | What it does                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `expire-orders`         | `POST /api/jobs/expire-orders` with `Bearer $JOBS_SECRET`; locally `pnpm jobs:once` | Cancels unpaid orders past `expires_at` (max 500 per call) and releases stock          |
| `process-notifications` | `POST /api/jobs/process-notifications`; locally `pnpm jobs:once`                    | Claims up to 20 outbox rows, writes a log line (the local sink), completes each row    |
| `purge-location`        | `POST /api/jobs/purge-location`; locally `pnpm jobs:once`                           | Deletes rider location history past the configured retention and ended-shift positions |
| (monitor)               | `GET /api/jobs/health` with the bearer secret; `/admin/jobs` for administrators     | Reads `job_health_check()`; HTTP 200 when clean, 503 with problems                     |

Delivery-proof and pickup-code expiry are enforced when a token or code is used and have no job (expired rows are never deleted). Reconciliation is manual. Nothing calls any of these on a schedule in any real environment.

## 2. Retry, dead state, idempotency

- **Notification outbox:** `pending` -> `processing` (claimed with `for update skip locked`, lock time recorded) -> `sent`, or back to `pending` with back-off 2^attempts minutes, or `dead` after 5 attempts. Rows stuck in `processing` for more than 5 minutes are reclaimed or marked dead. Completion is conditional on the row still being `processing`, and a unique `(outbox id)` delivery row prevents a second delivery, so a repeated or concurrent completion is harmless (tested with 8 workers and a control-removal test).
- **Expiry:** per-order conditional cancel; four overlapping runners cancel each order once and release stock once (tested).
- **Purge:** deleting already-deleted rows is a no-op; the current position of an active shift is never deleted (tested).
- **A `dead` notification stays dead.** No code path moves it back.

## 3. Detection that exists

`job_health_check()` reports: `never_run`; `stale` (no success within 15 / 5 / 180 minutes for expiry / notifications / purge); `last_run_failed`; `repeated_failures` (3 or more in 24 h); `notifications_dead`; `notifications_stuck` (>5 min); `notifications_backlog` (oldest pending >15 min); `write_errors` (24 h). Every run is recorded in `job_runs` (append-only). A never-run job is a problem, not a clean bill of health.

## 4. Current manual recovery

| Situation                     | What an operator does today                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A job has not run or is stale | Run `pnpm jobs:once` (or `curl -X POST` with the secret) against the app; check `/admin/jobs`                         |
| A run failed                  | Read the failed run on `/admin/jobs`; fix the cause; run again (idempotent)                                           |
| Stuck `processing` rows       | The next worker call reclaims them after 5 minutes                                                                    |
| **A dead notification**       | **Manual database action by someone with database access** (there is no tool; any hand edit bypasses the audit trail) |
| Alerting                      | None. A person must look                                                                                              |

**Limitation of `pnpm jobs:once`:** it is an on-demand command for a local app; it is not a scheduler, it does nothing when nobody runs it, it refuses non-local targets, and a clean exit shows the state only at that moment.

## 5. Proposed local test approach (no paid service)

1. Run `node scripts/run-jobs.mjs loop 5` locally for a few minutes with the cadences shortened by an environment variable, and assert `job_runs` gains rows at the expected rhythm.
2. Stop the loop and assert `GET /api/jobs/health` turns 503 with `stale` once the window passes (use a short test-only window setting in a test database function parameter, or backdate `job_runs` as the existing tests do).
3. Inject a failing sink (the worker throws) and assert retries, back-off and the `dead` transition, then the `notifications_dead` problem.
4. Simulate an alert path with a **local** receiver (a tiny HTTP listener or a log file) that a monitor script calls when `/api/jobs/health` is not 200; assert exactly one alert per incident (deduplicated) and a recovery notice.
5. Run two monitor instances at once and assert no duplicate alerts.

## 6. Options for a future production scheduler and alerting (each needs owner approval; none is activated)

| Option                                                     | How it works                                                      | Pros                                    | Cons / cost                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Hosting-platform scheduler (cron calling the three routes) | Platform calls the endpoints with the secret                      | Simple, near the app                    | Depends on the unchosen host; secret stored in the platform                                                      |
| GitHub Actions scheduled workflow                          | Calls the endpoints over HTTPS                                    | Free tier, versioned                    | Best-effort timing (can be delayed), public-repo secrets handling, not for a one-minute cadence                  |
| Supabase `pg_cron` + `pg_net`                              | Database triggers the HTTP call or runs the SQL directly          | Runs next to the data; no extra service | Needs extension enabled in the hosted project; secrets in the database; not available in the local sandbox stack |
| External uptime monitor                                    | Polls `GET /api/jobs/health` and `/api/health`, alerts on non-200 | Detects "scheduler stopped" as well     | Usually paid or limited free tier; needs the secret or a dedicated read-only token                               |

Alert recipient and channel (email, chat, phone) are also open: a real channel needs a provider, a person on call and a privacy review. Operational responsibilities that must be assigned: who owns the schedule, who is alerted, response time, who may requeue, how incidents are recorded (links to decision register items 18, 20, 21).

## 7. Risks

A scheduler that calls the routes holds `JOBS_SECRET` (rotation procedure needed); a mis-set cadence can flood the database or leave expiry late; alert fatigue from never-run noise before the first run (document the expected first-run state); a monitor outage must itself be noticed; any dead-letter requeue can resend a message, so it needs the controls below.

## 8. Requeue design for dead notifications (proposal; not built)

A privileged function `admin_requeue_notification(outbox_id, reason)`:

- **Who:** platform administrator at aal2 only (the same `require_staff` pattern); not executable by anon or ordinary roles; fixed `search_path`; revoked from public.
- **State check:** under `for update`, proceed only if the row is `dead`; any other status raises (so a running or sent row cannot be duplicated); the related notification must still exist and the user must still be opted in to the sink.
- **Reason and audit:** a reason of 10 to 500 characters is mandatory; write an `audit_events` row with operator, outbox id, previous status and attempts, reason, and outcome.
- **Idempotency and duplicate side effects:** the row returns to `pending` with attempts reset to a bounded value (for example 3, so at most two more tries), `next_attempt_at = now()`; the existing unique delivery row still stops a second delivery if a send had in fact succeeded; calling it twice in a row is a no-op on the second call because the row is no longer `dead`.
- **Bounded:** an optional batch form is limited to 20 rows per call and the same checks per row; an operator can requeue only rows older than a minimum age (for example 10 minutes) to avoid fighting an in-progress incident.
- **Interface:** an admin page action with a confirmation step, not a script.
- **Tests (when approved):** authorization matrix (anon, customer, support, finance, admin at aal1/aal2); non-dead rows refused; double call no-op; audit row content; no delivery duplicates under concurrency; reason validation; opted-out user refused.
- **Risk:** a real channel in future would make a requeue resend a real message; the function must stay limited to the local sink until a real channel is approved.

## 9. Decisions that require approval

Who schedules and on what platform (item 18); who is alerted and how (items 18, 21); whether a real notification channel is ever allowed (item 19); whether to build the requeue tool and who may use it; recovery targets and backups (item 20); on-call and incident handling (item 21).

## 10. What is not claimed

The jobs are not scheduled, monitored by anyone, or alerted on; a green `/admin/jobs` means only that recent runs succeeded when someone looked.
