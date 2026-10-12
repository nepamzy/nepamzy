-- Post-Batch 6 remediation (K56): a job that has stopped running, keeps failing, or is piling up work is DETECTED, not just visible.
-- Nothing here schedules anything. `job_health_check()` answers "is something wrong right now?" for a monitor that holds the job secret,
-- and `admin_job_health()` shows the same verdict to administrators.

-- How long a job may go without a SUCCESSFUL run before it counts as stale, if somebody had scheduled it at the proposed cadence
-- (twice the cadence, rounded up). These are engineering proposals pending the owner's scheduling decision (docs/operations/jobs.md).
create function app_private.job_expectations() returns table (job text, max_age_minutes int)
language sql immutable set search_path = ''
as $$ select * from (values ('expire-orders', 15), ('process-notifications', 5), ('purge-location', 180)) as v(job, max_age_minutes) $$;
revoke all on function app_private.job_expectations() from public, anon, authenticated;

-- The verdict. Problems:  never_run | stale (no success within max age) | last_run_failed | repeated_failures (>= 3 in 24 h)
--                         notifications_dead | notifications_stuck | notifications_backlog (oldest pending > 15 min) | write_errors (24 h)
create function app_private.job_problems() returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(p order by p ->> 'job', p ->> 'kind'), '[]'::jsonb) from (
    select jsonb_build_object('job', e.job, 'kind', 'never_run') p
      from app_private.job_expectations() e where not exists (select 1 from public.job_runs r where r.job = e.job)
    union all
    select jsonb_build_object('job', e.job, 'kind', 'stale', 'last_ok_at', (select max(r.finished_at) from public.job_runs r where r.job = e.job and r.ok))
      from app_private.job_expectations() e
     where exists (select 1 from public.job_runs r where r.job = e.job)
       and coalesce((select max(r.finished_at) from public.job_runs r where r.job = e.job and r.ok), '-infinity'::timestamptz) < now() - make_interval(mins => e.max_age_minutes)
    union all
    select jsonb_build_object('job', e.job, 'kind', 'last_run_failed')
      from app_private.job_expectations() e
     where (select r.ok from public.job_runs r where r.job = e.job order by r.finished_at desc, r.id desc limit 1) is false
    union all
    select jsonb_build_object('job', e.job, 'kind', 'repeated_failures', 'failures_24h', f.n)
      from app_private.job_expectations() e
      cross join lateral (select count(*) n from public.job_runs r where r.job = e.job and not r.ok and r.finished_at > now() - interval '24 hours') f
     where f.n >= 3
    union all
    select jsonb_build_object('job', 'process-notifications', 'kind', 'notifications_dead', 'count', n)
      from (select count(*) n from public.notification_outbox where status = 'dead') d where n > 0
    union all
    select jsonb_build_object('job', 'process-notifications', 'kind', 'notifications_stuck', 'count', n)
      from (select count(*) n from public.notification_outbox where status = 'processing' and locked_at < now() - interval '5 minutes') d where n > 0
    union all
    select jsonb_build_object('job', 'process-notifications', 'kind', 'notifications_backlog', 'oldest_seconds', extract(epoch from now() - min(created_at))::int)
      from public.notification_outbox where status = 'pending' and created_at < now() - interval '15 minutes' having count(*) > 0
    union all
    select jsonb_build_object('job', 'process-notifications', 'kind', 'write_errors', 'count', n)
      from (select count(*) n from public.notification_errors where created_at > now() - interval '24 hours') d where n > 0
  ) x
$$;
revoke all on function app_private.job_problems() from public, anon, authenticated;

create function public.job_health_check() returns jsonb
language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('ok', jsonb_array_length(p) = 0, 'problems', p) from (select app_private.job_problems() p) x $$;
revoke all on function public.job_health_check() from public, anon, authenticated;
grant execute on function public.job_health_check() to service_role;

-- Administrators see the verdict next to the numbers.
create or replace function public.admin_job_health() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  return jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
        'job', j.job,
        'max_age_minutes', j.max_age_minutes,
        'last_run_at', (select max(finished_at) from public.job_runs r where r.job = j.job),
        'last_ok_at', (select max(finished_at) from public.job_runs r where r.job = j.job and r.ok),
        'last_run_ok', (select r.ok from public.job_runs r where r.job = j.job order by r.finished_at desc, r.id desc limit 1),
        'failures_24h', (select count(*) from public.job_runs r where r.job = j.job and not r.ok and r.finished_at > now() - interval '24 hours')) order by j.job), '[]'::jsonb)
      from app_private.job_expectations() j),
    'notifications', jsonb_build_object(
        'pending', (select count(*) from public.notification_outbox where status = 'pending'),
        'processing', (select count(*) from public.notification_outbox where status = 'processing'),
        'stuck', (select count(*) from public.notification_outbox where status = 'processing' and locked_at < now() - interval '5 minutes'),
        'retrying', (select count(*) from public.notification_outbox where status = 'pending' and attempts > 0),
        'dead', (select count(*) from public.notification_outbox where status = 'dead'),
        'sent', (select count(*) from public.notification_outbox where status = 'sent'),
        'suppressed', (select count(*) from public.notification_outbox where status = 'suppressed'),
        'oldest_pending_seconds', (select extract(epoch from now() - min(created_at))::int from public.notification_outbox where status = 'pending'),
        'write_errors_24h', (select count(*) from public.notification_errors where created_at > now() - interval '24 hours')),
    'problems', app_private.job_problems(),
    'note', 'The application does not schedule these jobs. See docs/operations/jobs.md for what runs them.');
end $$;
