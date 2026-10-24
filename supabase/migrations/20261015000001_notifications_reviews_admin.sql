-- Batch 6, Phase 11: notifications (transactional, idempotent, observable), eligible reviews with moderation,
-- bounded administrative lists and an operations overview.
-- Principles enforced HERE (not in the browser):
--   * a notification is written in the SAME transaction as the business event that caused it (trigger), is unique per
--     (user, event key), carries only a short generic message and a relative link, and can never roll the event back;
--   * the only "external" channel is a LOCAL SINK that records a delivery row. Nothing is sent to anyone outside the
--     database. It is opt-in per user and processed by a bounded, retrying, dead-lettering worker;
--   * a review exists only for a finished order of the person who placed it; hiding a review never touches money or orders;
--   * administrative lists are bounded (page size <= 100) and role scoped.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('order', 'refund', 'return', 'case', 'review', 'admin')),
  title text not null check (char_length(title) between 3 and 80),
  body text not null check (char_length(body) between 3 and 200),
  link text check (link is null or link ~ '^/(orders|cases|vendor|admin|rider|notifications)(/[A-Za-z0-9_/-]{0,80})?$'),
  event_key text not null check (char_length(event_key) between 3 and 120),
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), -- distinct inside one transaction, so ordering is stable
  unique (user_id, event_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Optional external channel. Only the LOCAL SINK exists: delivering means writing a notification_deliveries row.
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null default 'local_sink' check (channel in ('local_sink')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'dead', 'suppressed')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, channel),
  constraint outbox_lock_shape check ((status = 'processing') = (locked_at is not null))
);
create index notification_outbox_work_idx on public.notification_outbox (next_attempt_at) where status = 'pending';
create index notification_outbox_stuck_idx on public.notification_outbox (locked_at) where status = 'processing';

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references public.notification_outbox (id) on delete cascade,
  channel text not null,
  delivered_at timestamptz not null default now()
);

-- Every time a notification could not be written (the business event still succeeded).
create table public.notification_errors (
  id bigint generated always as identity primary key,
  event_key text,
  user_id uuid,
  error text not null,
  created_at timestamptz not null default now()
);
create trigger notification_errors_append_only before update or delete on public.notification_errors
  for each row execute function app_private.deny_mutation();

-- Last runs of the HTTP job endpoints (observability; scheduling itself is NOT done by the application).
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('expire-orders', 'purge-location', 'process-notifications')),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  ok boolean not null,
  detail jsonb not null default '{}'::jsonb
);
create index job_runs_job_idx on public.job_runs (job, finished_at desc);
create trigger job_runs_append_only before update or delete on public.job_runs
  for each row execute function app_private.deny_mutation();

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) between 3 and 500),
  status text not null default 'published' check (status in ('published', 'hidden')),
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) between 10 and 500),
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reviews_hidden_shape check ((status = 'hidden') = (hidden_at is not null))
);
create index reviews_vendor_idx on public.reviews (vendor_id, created_at desc) where status = 'published';
create index reviews_customer_idx on public.reviews (customer_id, created_at desc);
-- the review itself is immutable apart from moderation fields
create function app_private.reviews_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.order_id <> old.order_id or new.vendor_id <> old.vendor_id or new.customer_id <> old.customer_id
     or new.rating <> old.rating or new.comment is distinct from old.comment or new.created_at <> old.created_at then
    raise exception 'review_immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger reviews_guard before update on public.reviews for each row execute function app_private.reviews_guard();
create trigger reviews_no_delete before delete on public.reviews for each row execute function app_private.deny_mutation();

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete restrict,
  reporter_id uuid not null references auth.users (id) on delete restrict,
  reason text not null check (reason in ('abusive', 'spam', 'off_topic', 'personal_info', 'other')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_reason text check (resolution_reason is null or char_length(resolution_reason) between 10 and 500),
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id),
  constraint review_reports_shape check ((status = 'open') = (resolved_at is null))
);
create index review_reports_open_idx on public.review_reports (created_at) where status = 'open';

-- ---------------------------------------------------------------------------------------------
-- Writing notifications (never able to fail the caller)
-- ---------------------------------------------------------------------------------------------
create function app_private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_key text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_email boolean;
begin
  begin
    insert into public.notifications (user_id, kind, title, body, link, event_key)
      values (p_user, p_kind, p_title, p_body, p_link, p_key)
      on conflict (user_id, event_key) do nothing returning id into v_id;
    if v_id is not null then
      select coalesce((select email_enabled from public.notification_preferences where user_id = p_user), false) into v_email;
      insert into public.notification_outbox (notification_id, status) values (v_id, case when v_email then 'pending' else 'suppressed' end);
    end if;
  exception when others then
    -- the business event must succeed even if its notification cannot be written; the failure stays visible
    insert into public.notification_errors (event_key, user_id, error) values (left(p_key, 120), p_user, left(sqlerrm, 300));
  end;
end $$;

create function app_private.notify_vendor_members(p_vendor uuid, p_title text, p_body text, p_link text, p_key text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select user_id from public.vendor_staff where vendor_id = p_vendor loop
    perform app_private.notify(r.user_id, 'order', p_title, p_body, p_link, p_key);
  end loop;
exception when others then
  insert into public.notification_errors (event_key, error) values (left(p_key, 120), left(sqlerrm, 300));
end $$;

create function app_private.notify_roles(p_roles public.app_role[], p_title text, p_body text, p_link text, p_key text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select distinct user_id from public.role_assignments where status = 'active' and role = any (p_roles) limit 50 loop
    perform app_private.notify(r.user_id, 'admin', p_title, p_body, p_link, p_key);
  end loop;
exception when others then
  insert into public.notification_errors (event_key, error) values (left(p_key, 120), left(sqlerrm, 300));
end $$;

-- Order events: generic text only. No amounts, no codes, no tokens, no locations, no reasons.
create function app_private.notify_order_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; v_title text; v_body text; v_key text;
begin
  select * into o from public.orders where id = new.order_id;
  if not found then return new; end if;
  v_key := 'order:' || new.id::text;
  if new.to_status = 'PAID' then
    perform app_private.notify(o.customer_id, 'order', 'Order received', 'Your payment was received. The shop will review your order.', '/orders/' || o.id, v_key);
    perform app_private.notify_vendor_members(o.vendor_id, 'New order', 'A new paid order is waiting for you.', '/vendor/orders', v_key);
    return new;
  end if;
  v_title := case new.to_status
    when 'ACCEPTED' then 'Order accepted'
    when 'CANCELLED' then 'Order cancelled'
    when 'PICKUP_AWAITING_HANDOVER' then 'Ready for pickup'
    when 'RIDER_ASSIGNED' then 'Rider assigned'
    when 'EN_ROUTE' then 'On its way'
    when 'ARRIVAL_DETECTED' then 'Your rider has arrived'
    when 'COMPLETED' then 'Order complete'
    when 'DISPUTED' then 'Order under review'
    when 'RETURN_REQUESTED' then 'Return update'
    when 'RETURN_IN_PROGRESS' then 'Return update'
    when 'RETURNED_TO_VENDOR' then 'Return update'
    else null end;
  if v_title is null then return new; end if;
  v_body := case new.to_status
    when 'ARRIVAL_DETECTED' then 'Open your order to confirm that you received it.'
    when 'CANCELLED' then 'Your order was cancelled. Open it to see what happens next.'
    when 'PICKUP_AWAITING_HANDOVER' then 'Your order is ready. Open it to see your pickup details.'
    else 'Open your order to see the latest status.' end;
  perform app_private.notify(o.customer_id, 'order', v_title, v_body, '/orders/' || o.id, v_key);
  return new;
exception when others then
  insert into public.notification_errors (event_key, error) values (left(v_key, 120), left(sqlerrm, 300));
  return new;
end $$;
create trigger order_status_notify after insert on public.order_status_history
  for each row execute function app_private.notify_order_status();

create function app_private.notify_refund_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r public.refunds%rowtype; o public.orders%rowtype;
begin
  if new.action not in ('review_started', 'approve', 'reject', 'execution_started', 'succeeded', 'failed', 'outcome_unknown') then return new; end if;
  select * into r from public.refunds where id = new.refund_id;
  select * into o from public.orders where id = r.order_id;
  perform app_private.notify(o.customer_id, 'refund', 'Refund update', 'There is an update on your refund request. Open it to see the status.',
                             '/orders/' || o.id || '/help', 'refund:' || new.id::text);
  if new.action = 'approve' then
    perform app_private.notify_roles(array['finance_admin', 'platform_admin']::public.app_role[], 'Refund waiting', 'An approved refund is waiting for execution.',
                                     '/admin/refunds', 'refund-wait:' || new.id::text);
  end if;
  return new;
exception when others then
  insert into public.notification_errors (event_key, error) values ('refund:' || new.id::text, left(sqlerrm, 300));
  return new;
end $$;
create trigger refund_event_notify after insert on public.refund_events
  for each row execute function app_private.notify_refund_event();

create function app_private.notify_case_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare c public.support_cases%rowtype;
begin
  if new.action not in ('opened', 'opened_by_support', 'review_started', 'decided', 'closed') then return new; end if;
  select * into c from public.support_cases where id = new.case_id;
  if new.action = 'opened' then
    perform app_private.notify_roles(array['support_agent', 'platform_admin']::public.app_role[], 'New report', 'A customer report is waiting for review.',
                                     '/admin/cases/' || c.id, 'case-new:' || new.id::text);
    return new;
  end if;
  perform app_private.notify(c.reporter_id, 'case', 'Report update', 'There is an update on your report. Open it to read more.', '/cases/' || c.id, 'case:' || new.id::text);
  return new;
exception when others then
  insert into public.notification_errors (event_key, error) values ('case:' || new.id::text, left(sqlerrm, 300));
  return new;
end $$;
create trigger case_event_notify after insert on public.case_events
  for each row execute function app_private.notify_case_event();

create function app_private.notify_case_statement() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare c public.support_cases%rowtype;
begin
  if new.party <> 'support' or new.visibility <> 'parties' then return new; end if;
  select * into c from public.support_cases where id = new.case_id;
  perform app_private.notify(c.reporter_id, 'case', 'Report update', 'Support added a message to your report.', '/cases/' || c.id, 'case-msg:' || new.id::text);
  return new;
exception when others then
  insert into public.notification_errors (event_key, error) values ('case-msg:' || new.id::text, left(sqlerrm, 300));
  return new;
end $$;
create trigger case_statement_notify after insert on public.case_statements
  for each row execute function app_private.notify_case_statement();

create function app_private.notify_return_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype;
begin
  if new.status = old.status or new.status not in ('approved', 'rejected', 'received_by_vendor') then return new; end if;
  select * into o from public.orders where id = new.order_id;
  perform app_private.notify(new.customer_id, 'return', 'Return update', 'There is an update on your return. Open it to see the status.',
                             '/orders/' || o.id || '/help', 'return:' || new.id::text || ':' || new.status);
  if new.status = 'approved' then
    perform app_private.notify_vendor_members(o.vendor_id, 'Return approved', 'A return was approved for your shop.', '/vendor/returns', 'return-vendor:' || new.id::text);
  end if;
  return new;
exception when others then
  insert into public.notification_errors (event_key, error) values ('return:' || new.id::text, left(sqlerrm, 300));
  return new;
end $$;
create trigger return_status_notify after update on public.return_requests
  for each row execute function app_private.notify_return_status();

-- ---------------------------------------------------------------------------------------------
-- Users: read, mark read, preferences
-- ---------------------------------------------------------------------------------------------
create function public.list_my_notifications(p_limit int default 20, p_offset int default 0, p_unread_only boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50); v_offset int := least(greatest(coalesce(p_offset, 0), 0), 5000);
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.user_id = v_actor and n.read_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'link', x.link,
                'read', x.read_at is not null, 'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
              from (select * from public.notifications n where n.user_id = v_actor and (not coalesce(p_unread_only, false) or n.read_at is null)
                     order by n.created_at desc limit v_limit offset v_offset) x));
end $$;

create function public.notification_mark_read(p_id uuid default null) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_n int;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  update public.notifications set read_at = now() where user_id = v_actor and read_at is null and (p_id is null or id = p_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.get_notification_preferences() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return jsonb_build_object('email_enabled', coalesce((select email_enabled from public.notification_preferences where user_id = v_actor), false));
end $$;

create function public.set_notification_preference(p_email boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if p_email is null then raise exception 'invalid value' using errcode = '22023'; end if;
  insert into public.notification_preferences (user_id, email_enabled) values (v_actor, p_email)
    on conflict (user_id) do update set email_enabled = excluded.email_enabled, updated_at = now();
  perform app_private.audit_write(v_actor, 'notification.preference_changed', 'user', v_actor::text, jsonb_build_object('email_enabled', p_email));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Worker (service role only): bounded, retrying, dead-lettering, reclaims stuck work
-- ---------------------------------------------------------------------------------------------
create function public.notification_outbox_claim(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50); v_out jsonb;
begin
  -- work that has been "processing" far too long and already used its attempts is dead, not retried forever
  update public.notification_outbox set status = 'dead', locked_at = null, last_error = 'stuck while processing'
   where status = 'processing' and locked_at < now() - interval '5 minutes' and attempts >= 5;
  with c as (
    select id from public.notification_outbox
     where (status = 'pending' and next_attempt_at <= now()) or (status = 'processing' and locked_at < now() - interval '5 minutes')
     order by next_attempt_at, created_at limit v_limit for update skip locked),
  u as (
    update public.notification_outbox o set status = 'processing', locked_at = now(), attempts = o.attempts + 1
      from c where o.id = c.id returning o.id, o.channel, o.attempts, o.notification_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'channel', u.channel, 'attempts', u.attempts, 'title', n.title, 'body', n.body, 'link', n.link)), '[]'::jsonb)
    into v_out from u join public.notifications n on n.id = u.notification_id;
  return v_out;
end $$;

create function public.notification_outbox_complete(p_id uuid, p_ok boolean, p_error text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare o public.notification_outbox%rowtype;
begin
  select * into o from public.notification_outbox where id = p_id for update;
  if not found then raise exception 'unknown outbox item' using errcode = 'P0002'; end if;
  if o.status <> 'processing' then return o.status; end if; -- repeated report: harmless
  if p_ok then
    insert into public.notification_deliveries (outbox_id, channel) values (o.id, o.channel) on conflict (outbox_id) do nothing;
    update public.notification_outbox set status = 'sent', sent_at = now(), locked_at = null, last_error = null where id = p_id;
    return 'sent';
  end if;
  if o.attempts >= 5 then
    update public.notification_outbox set status = 'dead', locked_at = null, last_error = left(coalesce(p_error, 'failed'), 300) where id = p_id;
    return 'dead';
  end if;
  update public.notification_outbox set status = 'pending', locked_at = null, last_error = left(coalesce(p_error, 'failed'), 300),
         next_attempt_at = now() + make_interval(mins => power(2, o.attempts)::int) where id = p_id;
  return 'pending';
end $$;

create function public.record_job_run(p_job text, p_ok boolean, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = ''
as $$ insert into public.job_runs (job, ok, detail) values (p_job, p_ok, coalesce(p_detail, '{}'::jsonb)) $$;

-- ---------------------------------------------------------------------------------------------
-- Admin health and overview (role scoped)
-- ---------------------------------------------------------------------------------------------
create function public.admin_job_health() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  return jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
        'job', j.job,
        'last_run_at', (select max(finished_at) from public.job_runs r where r.job = j.job),
        'last_ok_at', (select max(finished_at) from public.job_runs r where r.job = j.job and r.ok),
        'last_run_ok', (select r.ok from public.job_runs r where r.job = j.job order by r.finished_at desc, r.id desc limit 1),
        'failures_24h', (select count(*) from public.job_runs r where r.job = j.job and not r.ok and r.finished_at > now() - interval '24 hours')) order by j.job), '[]'::jsonb)
      from (values ('expire-orders'), ('purge-location'), ('process-notifications')) as j(job)),
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
    'note', 'The application does not schedule these jobs. See docs/operations/jobs.md for what runs them.');
end $$;

create function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_out jsonb := '{}'::jsonb; v_admin boolean := app_private.has_role('platform_admin');
        v_support boolean := app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]);
        v_fin boolean := app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]);
begin
  perform app_private.require_staff(array['platform_admin', 'support_agent', 'finance_admin']::public.app_role[]);
  if v_support then
    v_out := v_out || jsonb_build_object(
      'cases_open', (select count(*) from public.support_cases where status in ('open', 'under_review')),
      'cases_awaiting_close', (select count(*) from public.support_cases where status = 'decided'),
      'returns_waiting', (select count(*) from public.return_requests where status = 'requested'),
      'review_reports_open', (select count(*) from public.review_reports where status = 'open'),
      'rider_issues_open', (select count(*) from public.rider_issues where status = 'open'),
      'deliveries_in_flight', (select count(*) from public.orders where status in ('PICKED_UP_BY_RIDER', 'EN_ROUTE', 'ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF')));
  end if;
  if v_fin then
    v_out := v_out || jsonb_build_object(
      'refunds_requested', (select count(*) from public.refunds where status in ('requested', 'under_review')),
      'refunds_awaiting_execution', (select count(*) from public.refunds where status = 'approved'),
      'refunds_need_reconciliation', (select count(*) from public.refunds where status = 'reconciliation_required'),
      'payment_flags_open', (select count(*) from public.reconciliation_flags where resolved_at is null));
  end if;
  if v_admin then
    v_out := v_out || jsonb_build_object(
      'vendor_applications_pending', (select count(*) from public.vendor_applications where status = 'pending'),
      'rider_applications_pending', (select count(*) from public.rider_applications where status = 'pending'),
      'notifications_dead', (select count(*) from public.notification_outbox where status = 'dead'),
      'notifications_stuck', (select count(*) from public.notification_outbox where status = 'processing' and locked_at < now() - interval '5 minutes'));
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------------------------
create function public.create_review(p_order uuid, p_rating int, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); o public.orders%rowtype; v_comment text; v_id uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order;
  if not found or o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if app_private.is_vendor_member(o.vendor_id) then raise exception 'review_own_shop' using errcode = '42501'; end if;
  if o.status not in ('COMPLETED', 'PARTIALLY_REFUNDED') then raise exception 'review_not_eligible' using errcode = '22023'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'review_invalid_rating' using errcode = '22023'; end if;
  v_comment := nullif(btrim(regexp_replace(coalesce(p_comment, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '');
  if v_comment is not null and (char_length(v_comment) < 3 or char_length(v_comment) > 500) then raise exception 'review_invalid_comment' using errcode = '22023'; end if;
  if (select count(*) from public.reviews r where r.customer_id = v_actor and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_reviews' using errcode = '22023';
  end if;
  begin
    insert into public.reviews (order_id, vendor_id, customer_id, rating, comment) values (p_order, o.vendor_id, v_actor, p_rating, v_comment) returning id into v_id;
  exception when unique_violation then
    raise exception 'review_exists' using errcode = '23505';
  end;
  perform app_private.audit_write(v_actor, 'review.created', 'order', p_order::text, jsonb_build_object('review', v_id, 'rating', p_rating));
  return jsonb_build_object('id', v_id);
end $$;

create function public.my_order_review(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); o public.orders%rowtype; r public.reviews%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order;
  if not found or o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.reviews where order_id = p_order;
  if found then
    return jsonb_build_object('can_review', false, 'reason', 'already_reviewed', 'review', jsonb_build_object('rating', r.rating, 'comment', r.comment, 'status', r.status));
  end if;
  if app_private.is_vendor_member(o.vendor_id) then return jsonb_build_object('can_review', false, 'reason', 'own_shop'); end if;
  if o.status not in ('COMPLETED', 'PARTIALLY_REFUNDED') then return jsonb_build_object('can_review', false, 'reason', 'not_finished'); end if;
  return jsonb_build_object('can_review', true);
end $$;

-- Public: published reviews only, no customer identity, no order data. Average is returned in tenths (43 = 4.3).
create function public.get_vendor_reviews(p_slug text, p_limit int default 10, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v public.vendors%rowtype; v_limit int := least(greatest(coalesce(p_limit, 10), 1), 50); v_offset int := least(greatest(coalesce(p_offset, 0), 0), 5000);
begin
  select * into v from public.vendors where slug = p_slug and status = 'approved';
  if not found then return null; end if;
  return jsonb_build_object(
    'count', (select count(*) from public.reviews where vendor_id = v.id and status = 'published'),
    'average_tenths', (select case when count(*) = 0 then null else round(sum(rating) * 10.0 / count(*))::int end from public.reviews where vendor_id = v.id and status = 'published'),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'rating', x.rating, 'comment', x.comment, 'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
                from (select * from public.reviews r where r.vendor_id = v.id and r.status = 'published' order by r.created_at desc limit v_limit offset v_offset) x));
end $$;

create function public.report_review(p_review uuid, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); r public.reviews%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into r from public.reviews where id = p_review and status = 'published';
  if not found then raise exception 'review_not_found' using errcode = 'P0002'; end if;
  if r.customer_id = v_actor then raise exception 'review_own_report' using errcode = '42501'; end if;
  if p_reason not in ('abusive', 'spam', 'off_topic', 'personal_info', 'other') then raise exception 'invalid_reason' using errcode = '22023'; end if;
  if (select count(*) from public.review_reports x where x.reporter_id = v_actor and x.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_reports' using errcode = '22023';
  end if;
  begin
    insert into public.review_reports (review_id, reporter_id, reason, note) values (p_review, v_actor, p_reason, left(nullif(btrim(coalesce(p_note, '')), ''), 300));
  exception when unique_violation then
    raise exception 'report_exists' using errcode = '23505';
  end;
  perform app_private.audit_write(v_actor, 'review.reported', 'review', p_review::text, jsonb_build_object('reason', p_reason));
end $$;

create function public.staff_list_review_reports(p_status text default 'open', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  perform app_private.require_staff(array['platform_admin', 'support_agent']::public.app_role[]);
  if p_status is not null and p_status not in ('open', 'upheld', 'dismissed') then raise exception 'invalid value' using errcode = '22023'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.review_reports where p_status is null or status = p_status),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'review_id', x.review_id, 'reason', x.reason, 'note', x.note, 'status', x.status,
                'created_at', x.created_at, 'resolution_reason', x.resolution_reason, 'rating', x.rating, 'comment', x.comment,
                'review_status', x.review_status, 'vendor', x.vendor_name) order by x.created_at), '[]'::jsonb)
             from (select rr.*, rv.rating, rv.comment, rv.status as review_status, v.name as vendor_name
                     from public.review_reports rr join public.reviews rv on rv.id = rr.review_id join public.vendors v on v.id = rv.vendor_id
                    where p_status is null or rr.status = p_status order by rr.created_at limit v_limit offset v_offset) x));
end $$;

create function public.moderate_review_report(p_report uuid, p_action text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['platform_admin', 'support_agent']::public.app_role[]);
        rr public.review_reports%rowtype; rv public.reviews%rowtype;
begin
  if p_action not in ('hide', 'dismiss') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(p_reason) > 500 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into rr from public.review_reports where id = p_report for update;
  if not found then raise exception 'unknown report' using errcode = 'P0002'; end if;
  if rr.status <> 'open' then raise exception 'report_already_resolved' using errcode = '23505'; end if;
  select * into rv from public.reviews where id = rr.review_id for update;
  if rv.customer_id = v_actor or rr.reporter_id = v_actor then raise exception 'cannot moderate your own review or report' using errcode = '42501'; end if;
  if p_action = 'hide' then
    update public.reviews set status = 'hidden', hidden_reason = btrim(p_reason), hidden_by = v_actor, hidden_at = now() where id = rv.id and status = 'published';
    update public.review_reports set status = 'upheld', resolved_by = v_actor, resolved_at = now(), resolution_reason = btrim(p_reason)
     where review_id = rv.id and status = 'open';
  else
    update public.review_reports set status = 'dismissed', resolved_by = v_actor, resolved_at = now(), resolution_reason = btrim(p_reason) where id = p_report;
  end if;
  perform app_private.audit_write(v_actor, case p_action when 'hide' then 'review.hidden' else 'review.report_dismissed' end, 'review', rv.id::text,
                                  jsonb_build_object('report', p_report, 'reason', left(btrim(p_reason), 200)));
end $$;

create function public.unhide_review(p_review uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['platform_admin']::public.app_role[]); rv public.reviews%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into rv from public.reviews where id = p_review for update;
  if not found or rv.status <> 'hidden' then raise exception 'review_not_found' using errcode = 'P0002'; end if;
  if rv.customer_id = v_actor then raise exception 'cannot moderate your own review or report' using errcode = '42501'; end if;
  update public.reviews set status = 'published', hidden_reason = null, hidden_by = null, hidden_at = null where id = p_review;
  perform app_private.audit_write(v_actor, 'review.restored', 'review', p_review::text, jsonb_build_object('reason', left(btrim(p_reason), 200)));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Bounded, searchable staff lists (replace the unbounded Batch 5 versions; defaults keep old calls working)
-- ---------------------------------------------------------------------------------------------
drop function public.staff_list_refunds(text);
create function public.staff_list_refunds(p_status text default null, p_limit int default 25, p_offset int default 0, p_search text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'finance_admin', 'platform_admin']::public.app_role[]);
        v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := least(greatest(coalesce(p_offset, 0), 0), 10000);
        v_q text := lower(btrim(coalesce(p_search, '')));
begin
  if p_status is not null and p_status not in ('requested', 'under_review', 'approved', 'rejected', 'processing', 'succeeded', 'failed', 'reconciliation_required') then
    raise exception 'invalid value' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'order_id', x.order_id, 'order_number', x.order_number, 'amount_kobo', x.amount_kobo, 'status', x.status,
      'reason', x.reason, 'source', x.source, 'provider_mode', x.provider_mode, 'created_at', x.created_at,
      'decision_reason', x.decision_reason, 'own_request', x.requested_by = v_actor,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', oi.product_name, 'quantity', ri.quantity, 'amount_kobo', ri.amount_kobo)), '[]'::jsonb)
                  from public.refund_items ri join public.order_items oi on oi.id = ri.order_item_id where ri.refund_id = x.id),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'to', e.to_status, 'note', e.note, 'at', e.created_at) order by e.id), '[]'::jsonb)
                   from public.refund_events e where e.refund_id = x.id)) order by x.created_at desc), '[]'::jsonb)
    from (select r.*, o.order_number from public.refunds r join public.orders o on o.id = r.order_id
           where (p_status is null or r.status = p_status) and (v_q = '' or position(v_q in lower(o.order_number)) > 0)
           order by r.created_at desc limit v_limit offset v_offset) x);
end $$;

drop function public.staff_list_cases(text);
create function public.staff_list_cases(p_status text default null, p_limit int default 25, p_offset int default 0, p_search text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]);
        v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100); v_offset int := least(greatest(coalesce(p_offset, 0), 0), 10000);
        v_q text := lower(btrim(coalesce(p_search, '')));
begin
  if p_status is not null and p_status not in ('open', 'under_review', 'decided', 'closed') then raise exception 'invalid value' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'case_no', x.case_no, 'order_number', x.order_number, 'case_type', x.case_type,
            'status', x.status, 'created_at', x.created_at, 'decision', x.decision, 'assigned_to_me', x.assigned_to = v_actor) order by x.created_at), '[]'::jsonb)
          from (select c.*, o.order_number from public.support_cases c join public.orders o on o.id = c.order_id
                 where (p_status is null or c.status = p_status)
                   and (v_q = '' or position(v_q in lower(o.order_number)) > 0 or position(v_q in lower(c.case_no)) > 0)
                 order by c.created_at limit v_limit offset v_offset) x);
end $$;

drop function public.list_returns(uuid);
create function public.list_returns(p_order uuid default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_staff boolean;
        v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  v_staff := app_private.has_any_role(array['support_agent', 'platform_admin']::public.app_role[]);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'order_id', x.order_id, 'order_number', x.order_number, 'status', x.status, 'reason', x.reason,
            'decision_reason', x.decision_reason, 'vendor_condition', x.vendor_condition, 'created_at', x.created_at,
            'return_rule', app_private.return_rule_for_order(x.order_id),
            'items', (select coalesce(jsonb_agg(jsonb_build_object('name', oi.product_name, 'quantity', ri.quantity)), '[]'::jsonb)
                        from public.return_request_items ri join public.order_items oi on oi.id = ri.order_item_id where ri.return_id = x.id)) order by x.created_at desc), '[]'::jsonb)
          from (select r.*, o.order_number from public.return_requests r join public.orders o on o.id = r.order_id
                 where (p_order is null or r.order_id = p_order)
                   and (r.customer_id = v_actor or v_staff or app_private.is_vendor_member(o.vendor_id))
                 order by r.created_at desc limit v_limit offset v_offset) x);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notifications', 'notification_preferences', 'notification_outbox', 'notification_deliveries', 'notification_errors',
                           'job_runs', 'reviews', 'review_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (app_private.is_aal2())', t || '_aal2', t);
  end loop;
end $$;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.notifications, public.notification_preferences, public.reviews, public.review_reports to authenticated;

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notification_preferences_select on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy reviews_select on public.reviews for select to authenticated
  using (customer_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy review_reports_select on public.review_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));

do $$
declare f text;
begin
  foreach f in array array[
    'public.list_my_notifications(int, int, boolean)', 'public.notification_mark_read(uuid)', 'public.get_notification_preferences()',
    'public.set_notification_preference(boolean)', 'public.admin_job_health()', 'public.admin_overview()',
    'public.create_review(uuid, int, text)', 'public.my_order_review(uuid)', 'public.report_review(uuid, text, text)',
    'public.staff_list_review_reports(text, int, int)', 'public.moderate_review_report(uuid, text, text)', 'public.unhide_review(uuid, text)',
    'public.staff_list_refunds(text, int, int, text)', 'public.staff_list_cases(text, int, int, text)', 'public.list_returns(uuid, int, int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- public read of published reviews (the anon allowlist in the schema test is extended consciously)
  revoke all on function public.get_vendor_reviews(text, int, int) from public;
  grant execute on function public.get_vendor_reviews(text, int, int) to anon, authenticated, service_role;
  -- service role only: the worker and the job log
  foreach f in array array['public.notification_outbox_claim(int)', 'public.notification_outbox_complete(uuid, boolean, text)',
                           'public.record_job_run(text, boolean, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- internal helpers
  foreach f in array array[
    'app_private.notify(uuid, text, text, text, text, text)', 'app_private.notify_vendor_members(uuid, text, text, text, text)',
    'app_private.notify_roles(public.app_role[], text, text, text, text)', 'app_private.notify_order_status()', 'app_private.notify_refund_event()',
    'app_private.notify_case_event()', 'app_private.notify_case_statement()', 'app_private.notify_return_status()', 'app_private.reviews_guard()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
