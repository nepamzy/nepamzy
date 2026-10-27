-- Delivery of notifications to people: e-mail and browser/phone pop-ups (Web Push). ADDITIVE ONLY.
-- The existing in-app notifications (public.notifications, written by the order/refund/case triggers) are the single source of
-- events. This migration adds (1) the browser push subscriptions people choose to register, (2) a per-notification delivery
-- record so each notification is e-mailed / pushed exactly once, and (3) one service-role-only function that hands a bounded
-- batch of undelivered notifications to the app's delivery worker. Nothing here is reachable by anon or authenticated.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 200),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_dispatch (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  attempts int not null default 1 check (attempts between 1 and 3),
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'skipped', 'failed')),
  push_status text not null default 'pending' check (push_status in ('pending', 'sent', 'skipped', 'failed')),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  done_at timestamptz,
  constraint dispatch_done_shape check ((done_at is not null) = (email_status <> 'pending' and push_status <> 'pending'))
);
create index notification_dispatch_open_idx on public.notification_dispatch (claimed_at) where done_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.notification_dispatch enable row level security;
revoke all on public.push_subscriptions, public.notification_dispatch from public, anon, authenticated;
grant all on public.push_subscriptions, public.notification_dispatch to service_role;

-- Worker only (service role). Returns up to p_limit notifications that have not been handed out yet (created within the last
-- three days), plus ones whose delivery was claimed more than ten minutes ago and never finished (at most three attempts in
-- all; a channel that already succeeded is reported as such so it is not sent again). Each notification is handed to exactly one caller: the unique key on notification_dispatch decides, so two workers
-- running at once never deliver the same notification twice. Returns only what the e-mail / push text needs.
create function public.dispatch_claim(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50); v_out jsonb;
begin
  with cand as (
    select n.id from public.notifications n
     where n.created_at > now() - interval '3 days'
       and not exists (select 1 from public.notification_dispatch d where d.notification_id = n.id)
     order by n.created_at
     limit v_limit),
  fresh as (
    insert into public.notification_dispatch (notification_id)
      select id from cand
      on conflict (notification_id) do nothing
      returning notification_id, attempts, email_status, push_status),
  stuck as (
    update public.notification_dispatch d set attempts = d.attempts + 1, claimed_at = now()
     where d.notification_id in (
       select s.notification_id from public.notification_dispatch s
        where s.done_at is null and s.claimed_at < now() - interval '10 minutes' and s.attempts < 3
        order by s.claimed_at
        limit v_limit
        for update skip locked)
     returning d.notification_id, d.attempts, d.email_status, d.push_status),
  picked as (
    select * from fresh
    union all
    select * from stuck)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'user_id', n.user_id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link,
           'attempts', p.attempts, 'email_status', p.email_status, 'push_status', p.push_status
         ) order by n.created_at), '[]'::jsonb)
    into v_out
    from picked p
    join public.notifications n on n.id = p.notification_id;
  return v_out;
end $$;
revoke all on function public.dispatch_claim(int) from public, anon, authenticated;
grant execute on function public.dispatch_claim(int) to service_role;

-- People who never touched the e-mail setting receive e-mail copies; only an explicit "off" opts out. The existing
-- email_enabled value is unchanged (the older outbox still reads it); `saved` tells the page whether a choice exists.
create or replace function public.get_notification_preferences() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_row public.notification_preferences;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_row from public.notification_preferences where user_id = v_actor;
  return jsonb_build_object('email_enabled', coalesce(v_row.email_enabled, false), 'saved', v_row.user_id is not null);
end $$;
