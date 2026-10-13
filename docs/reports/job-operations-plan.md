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

---

# Update 2026-10-13 (Master Prompt 1, Part 5): architecture review, scheduler decision, notification channels, recovery

## 11. Job-management architecture: what exists, what is a gap

| Requirement                       | Status in the code today                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registered job types              | Exists: three jobs, constrained by a `check` on `job_runs.job` and `app_private.job_expectations()`.                                                                                            |
| Explicit job states               | Partial: outbox items have explicit states (`pending, processing, sent, dead, suppressed`); the three jobs record only `ok` true/false per run in append-only `job_runs`.                       |
| Scheduled execution               | **Missing** (decision pending, section 12).                                                                                                                                                     |
| Bounded retries and backoff       | Exists for notifications (2^attempts minutes, dead after 5). Order expiry and location purge are naturally re-run by the next call.                                                             |
| Idempotency / duplicate execution | Exists per unit of work (conditional per-order cancel; unique delivery row; no-op deletes), tested with overlapping runners. There is no job-level lease, so two runners both execute (safely). |
| Leases / concurrency              | Notification claim uses `for update skip locked` and a 5-minute stale reclaim. No lease for expiry/purge (not needed for correctness; a lease would only save duplicate work).                  |
| Timeouts                          | **Missing** at job level (the HTTP routes rely on platform request limits).                                                                                                                     |
| Failure classification            | Partial: run failures are `ok=false` with a `detail`; notification errors are a short text. No transient/permanent classification.                                                              |
| Dead-letter handling              | Exists (`dead`), **and now controlled recovery exists** (section 14).                                                                                                                           |
| Audit events                      | Exists for the requeue (new) and settings; job runs are append-only records.                                                                                                                    |
| Health checks / monitoring        | Exists: `job_health_check()`, `GET /api/jobs/health`, `/admin/jobs` (never run, stale, failed, repeated failures, dead, stuck, backlog, write errors).                                          |
| Operational metrics               | Partial: counts only; no run durations or throughput history.                                                                                                                                   |
| Local vs production separation    | Exists: `scripts/run-jobs.mjs` refuses non-local base URLs; the sink is local only; `APP_ENV` fails closed.                                                                                     |

Not built in this stage (design only, to be built after the scheduler decision): a job-level lease (`pg_try_advisory_lock` per job name inside the job function so a second concurrent invocation returns "already running" and is recorded as skipped), run duration in `job_runs.detail`, and a transient/permanent failure class on notification errors. None changes existing behaviour.

## 12. Scheduler decision (investigation only; nothing scheduled, nothing enabled)

Sources: web search results quoting Supabase documentation pages (the documentation site itself could not be fetched from this environment, so **every detail below is unverified against the primary pages** and must be re-checked against the owner's actual plan before relying on it):

- Supabase hosted projects offer **Supabase Cron**, a dashboard layer over the Postgres `pg_cron` extension; jobs can run SQL, call database functions, or call Edge Functions/webhooks, with schedules in cron syntax (and, per the module page, intervals down to seconds).
- Calling an HTTP endpoint from `pg_cron` uses the `pg_net` extension (`net.http_post`); the docs recommend keeping the project URL and tokens in **Supabase Vault**.
- Third-party guides disagree on whether `pg_cron` is enabled by default on every plan. **Plan, quota and extension availability are unconfirmed**; do not assume it is free or available.
- Not available in the local sandbox stack (the plan for this project already noted that); local testing stays with `scripts/run-jobs.mjs`.

**Candidate (needs owner approval):** `pg_cron` in the hosted project calling (a) the expiry and location-purge **SQL directly** where possible (no HTTP, no secret), and (b) the notification-processing route over HTTP via `pg_net` with the bearer secret read from Vault (the sink delivery happens in the application, so this job must go through the app). Required: the two extensions enabled in the hosted project, a Vault secret, a monitor that notices "the scheduler stopped" (the existing health check already reports `stale` and `never_run`), a documented rotation procedure for `JOBS_SECRET`, and an alert recipient (section 13). If the scheduler stops, jobs go stale; `/api/jobs/health` returns 503 and `/admin/jobs` shows the problem, but **nobody is alerted until a recipient and an external check exist**. Duplicate executions are safe by the per-unit idempotency above; a lease (section 11) would only avoid wasted work. Do **not** create a live scheduled job against any real project until the target environment, plan, secret handling and operating procedure are approved.

## 13. Notification channels

| Channel                     | What it is                                                                                                      | Status here                                                                                      | Notes / honest limits                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app notification         | A row shown in the Notifications page while signed in, with an unread count                                     | Implemented                                                                                      | Seen only when the user opens the app.                                                                                                                                                                                                                                                                                                                                      |
| Dashboard alert             | A banner or counter inside a staff dashboard (for example `/admin/jobs` problems, `/admin` counters)            | Implemented for jobs and counters                                                                | Staff see it only while looking at the console; nobody is pushed.                                                                                                                                                                                                                                                                                                           |
| Browser/system notification | A pop-up from the browser or operating system via the Notification/Push API with the user's explicit permission | **Not implemented**; proposal only (needs a service worker push subscription and a push service) | Works only where the browser supports it and the user allowed it; behaviour with the app closed differs by browser, Android vendor battery settings, and network. **Not guaranteed on every Android device.** Web Push uses the browsers' own push services (no per-message fee), but a server key pair and storage of subscriptions (personal data) need a privacy review. |
| Email                       | A message to the user's address                                                                                 | Local sink only (writes a delivery row); real provider **not configured**                        | The owner has a Brevo account; **no credentials were added and no email was sent**. Needs consent (already opt-in per user), a verified sender, an unsubscribe/consent path and a privacy review. Delivery to an inbox is never guaranteed.                                                                                                                                 |
| WhatsApp / paid SMS         | -                                                                                                               | Not added                                                                                        | Excluded by the owner unless approved.                                                                                                                                                                                                                                                                                                                                      |

Messages stay generic (no money, codes, tokens or locations), as the existing tests enforce. All external delivery remains disabled.

## 14. Dead-notification recovery: implemented (local sink only)

Migration `20261017000001_notification_requeue.sql`, `tests/db/requeue.test.ts` (7 tests), admin UI section on `/admin/jobs`.

- **Who:** platform administrator at aal2 only (`require_staff`), for listing and requeueing; support, finance, customers, aal1 and anonymous are refused (tested).
- **Reason:** mandatory, 10 to 500 characters.
- **Eligibility (re-checked fresh on every call):** item is `dead` (under a row lock, so a second call is refused); at least 10 minutes old; the notification is less than 7 days old; no delivery already recorded; recipient still exists and still has the optional channel enabled; fewer than 2 earlier requeues. A refusal is recorded in the audit trail with the blocking reason and nothing changes.
- **Effect:** the item returns to `pending` with `attempts = 3` (at most two more tries) and `next_attempt_at = now()`; the normal worker, back-off and the unique delivery row apply (a requeued item is delivered at most once; tested).
- **Records:** append-only `notification_requeues` (actor, reason, prior status, attempts and error, time) and an `audit_events` row. Dead rows are never deleted. Message text is never returned by the listing or logged.
- **No bulk operation:** one item per call; the listing is capped at 20.
- **Not covered:** the 10-minute, 7-day and 2-requeue limits are engineering defaults chosen for safety, **not owner-approved policy**; the owner may change them.

## 15. Proposed operating procedure (placeholders; nothing here is assigned to a person)

| Topic              | Proposal                                                                                                                            | Owner input needed               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Alert recipient    | `[ALERT RECIPIENT: TO BE PROVIDED]` (a role mailbox, not a person's own address)                                                    | Who and which channel            |
| First responder    | `[ROLE: TO BE ASSIGNED]` checks `/admin/jobs` when alerted, within `[RESPONSE TIME: TO BE DECIDED]`                                 | Role and hours                   |
| Who may requeue    | Platform administrators only (as built); high-impact or repeated recovery needs a second administrator's approval `[TO BE DECIDED]` | Approval rule                    |
| Retry limits       | 5 attempts then dead; at most 2 requeues; changes need owner approval                                                               | Confirm or change                |
| Escalation         | A job stale or failing for more than `[THRESHOLD: TO BE DECIDED]` becomes an incident                                               | Threshold and escalation contact |
| Incident recording | Record in an incident log (date, jobs affected, cause, action, who) kept with the audit trail                                       | Location of the log              |
| Safe recovery      | Run the job again (idempotent); requeue only after the cause is fixed; never edit rows by hand                                      | Approve                          |
| Periodic review    | Weekly look at `/admin/jobs`, dead items and requeue history while in pilot                                                         | Who and how often                |
