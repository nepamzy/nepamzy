-- Controlled recovery of dead notifications (Master Prompt 1, Part 5.4).
--   * Only a platform administrator at aal2 may requeue; a reason (10 to 500 characters) is mandatory.
--   * Only a row that is currently 'dead' can be requeued (checked under a row lock), so a running, sent or
--     suppressed item can never be duplicated, and a second call on the same item is refused.
--   * A fresh eligibility check runs every time: the notification must still be recent, the recipient must still
--     exist and still have the optional channel switched on, and no delivery may already be recorded.
--   * Bounded: at most 2 requeues per item (attempts are reset to 3, so a requeued item gets at most 2 more tries),
--     at most 20 items per call, and an item must have been waiting at least 10 minutes.
--   * Every requeue writes an append-only record (who, when, why, prior status/attempts/error) plus an audit event.
--     Dead rows are never deleted or rewritten except by this function. Message text is never returned or logged.
--   * Only the LOCAL SINK exists; requeueing cannot send anything real.

create table public.notification_requeues (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.notification_outbox (id) on delete cascade,
  actor_id uuid not null references auth.users (id),
  reason text not null check (char_length(reason) between 10 and 500),
  previous_status text not null,
  previous_attempts int not null,
  previous_error text,
  requeued_at timestamptz not null default now()
);
create index notification_requeues_outbox_idx on public.notification_requeues (outbox_id);
create trigger notification_requeues_append_only before update or delete on public.notification_requeues
  for each row execute function app_private.deny_mutation();

alter table public.notification_requeues enable row level security;
revoke all on public.notification_requeues from public, anon, authenticated;
create policy notification_requeues_aal2 on public.notification_requeues as restrictive for all to authenticated using (app_private.is_aal2());
grant all on public.notification_requeues to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Why an item can or cannot be requeued right now. NULL = eligible.
create function app_private.requeue_problem(p_outbox uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare o public.notification_outbox%rowtype; n public.notifications%rowtype;
begin
  select * into o from public.notification_outbox where id = p_outbox;
  if not found then return 'not_found'; end if;
  if o.status <> 'dead' then return 'not_dead'; end if;
  if o.created_at > now() - interval '10 minutes' then return 'too_recent'; end if;
  if (select count(*) from public.notification_requeues where outbox_id = o.id) >= 2 then return 'requeue_limit_reached'; end if;
  if exists (select 1 from public.notification_deliveries where outbox_id = o.id) then return 'already_delivered'; end if;
  select * into n from public.notifications where id = o.notification_id;
  if not found then return 'notification_gone'; end if;
  if n.created_at < now() - interval '7 days' then return 'notification_expired'; end if;
  if not exists (select 1 from auth.users u where u.id = n.user_id) then return 'recipient_gone'; end if;
  if not coalesce((select p.email_enabled from public.notification_preferences p where p.user_id = n.user_id), false) then return 'recipient_opted_out'; end if;
  return null;
end $$;

-- Dead items for the administrator: identifiers, counts and the (short, system-written) error. No message text.
create function public.admin_list_dead_notifications(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 20), 1), 20);
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'kind', x.kind, 'attempts', x.attempts, 'last_error', x.last_error, 'created_at', x.created_at,
      'requeues', x.requeues, 'eligible', x.problem is null, 'blocked_by', x.problem) order by x.created_at), '[]'::jsonb)
    from (select o.id, n.kind, o.attempts, o.last_error, o.created_at,
                 (select count(*) from public.notification_requeues q where q.outbox_id = o.id) as requeues,
                 app_private.requeue_problem(o.id) as problem
            from public.notification_outbox o join public.notifications n on n.id = o.notification_id
           where o.status = 'dead' order by o.created_at limit v_limit) x);
end $$;

create function public.admin_requeue_notification(p_outbox uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_reason text := btrim(coalesce(p_reason, '')); o public.notification_outbox%rowtype; v_problem text;
begin
  v_actor := app_private.require_staff(array['platform_admin']::public.app_role[]);
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023';
  end if;
  select * into o from public.notification_outbox where id = p_outbox for update;
  if not found then raise exception 'unknown notification' using errcode = 'P0002'; end if;
  v_problem := app_private.requeue_problem(p_outbox);
  if v_problem is not null then
    perform app_private.audit_write(v_actor, 'notification.requeue_refused', 'notification_outbox', p_outbox::text,
      jsonb_build_object('blocked_by', v_problem, 'reason', v_reason));
    return jsonb_build_object('requeued', false, 'blocked_by', v_problem);
  end if;
  insert into public.notification_requeues (outbox_id, actor_id, reason, previous_status, previous_attempts, previous_error)
    values (o.id, v_actor, v_reason, o.status, o.attempts, o.last_error);
  update public.notification_outbox set status = 'pending', attempts = 3, next_attempt_at = now(), locked_at = null, last_error = null
   where id = o.id;
  perform app_private.audit_write(v_actor, 'notification.requeued', 'notification_outbox', o.id::text,
    jsonb_build_object('previous_attempts', o.attempts, 'previous_error', o.last_error, 'reason', v_reason));
  return jsonb_build_object('requeued', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.admin_list_dead_notifications(int)', 'public.admin_requeue_notification(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke all on function app_private.requeue_problem(uuid) from public, anon, authenticated;
end $$;
