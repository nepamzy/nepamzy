-- AFIT Market - Batch 1 / Phase 2: identity, roles, audit, security helpers, stub tables.
-- Conventions:
--  * RLS is enabled on EVERY table. Sensitive writes happen only through hardened SECURITY DEFINER
--    functions (fixed search_path, restricted EXECUTE, identity + authorization checked inside).
--  * Privileged roles (everything except `customer`) must be at aal2 for ANY table access, enforced
--    by a RESTRICTIVE policy on every table.
--  * Internal helpers live in schema app_private (not exposed through the Data API).

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create type public.app_role as enum (
  'customer', 'vendor_owner', 'vendor_staff', 'rider',
  'support_agent', 'finance_admin', 'platform_admin'
);
create type public.role_status as enum ('active', 'revoked');

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  status public.role_status not null default 'active',
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint role_status_matches_revoked_at check ((status = 'revoked') = (revoked_at is not null))
);
create unique index role_assignments_one_active on public.role_assignments (user_id, role)
  where status = 'active';
create index role_assignments_user_idx on public.role_assignments (user_id);

-- Append-only security/audit trail. actor_id intentionally has no FK so history outlives accounts.
create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (char_length(action) between 3 and 80),
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  request_id text
);
create index audit_events_occurred_idx on public.audit_events (occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id);

create table public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Stub reference tables: minimal columns so Batch 1 can test ownership-based RLS. Later batches
-- extend them (vendors/stores, rider onboarding).
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  created_at timestamptz not null default now()
);
create table public.vendor_staff (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (vendor_id, user_id)
);
create index vendor_staff_user_idx on public.vendor_staff (user_id);
create table public.rider_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  created_at timestamptz not null default now()
);

-- STUB: stands in for "customer places an order" to test the registered-customer aal2 rule.
create table public.stub_order_placements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index stub_order_placements_user_idx on public.stub_order_placements (user_id);

-- STUB: stands in for an atomic capacity rule (Batch 4: rider max five). Exercises the
-- parallel-connection test harness.
create table public.stub_capacity_slots (
  id int primary key,
  capacity int not null check (capacity >= 0),
  used int not null default 0 check (used >= 0 and used <= capacity)
);

-- app_private: rate limiting
create table app_private.rate_limit_events (
  id bigint generated always as identity primary key,
  key text not null,
  occurred_at timestamptz not null default now()
);
create index rate_limit_events_key_idx on app_private.rate_limit_events (key, occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- Helper functions (app_private). All SECURITY DEFINER ones fix search_path and restrict EXECUTE.
-- ---------------------------------------------------------------------------------------------
create function app_private.is_aal2() returns boolean
language sql stable security invoker set search_path = ''
as $$ select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false) $$;

create function app_private.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.role_assignments ra
    where ra.user_id = (select auth.uid()) and ra.role = p_role and ra.status = 'active'
  )
$$;

create function app_private.has_any_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.role_assignments ra
    where ra.user_id = (select auth.uid()) and ra.role = any (p_roles) and ra.status = 'active'
  )
$$;

-- True when the caller holds any role other than `customer` (vendor, rider, staff, admin).
create function app_private.has_privileged_role() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.role_assignments ra
    where ra.user_id = (select auth.uid()) and ra.status = 'active' and ra.role <> 'customer'
  )
$$;

-- MFA requirement used by RESTRICTIVE policies: privileged callers must be at aal2.
create function app_private.mfa_satisfied() returns boolean
language sql stable security definer set search_path = ''
as $$ select app_private.is_aal2() or not app_private.has_privileged_role() $$;

create function app_private.is_vendor_member(p_vendor uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.vendor_staff vs
    where vs.vendor_id = p_vendor and vs.user_id = (select auth.uid())
  )
$$;

-- Internal audit writer. NOT callable by API roles; used by other SECURITY DEFINER functions.
create function app_private.audit_write(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text, p_details jsonb
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
  values (p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'app_private.is_aal2()', 'app_private.has_role(public.app_role)',
    'app_private.has_any_role(public.app_role[])', 'app_private.has_privileged_role()',
    'app_private.mfa_satisfied()', 'app_private.is_vendor_member(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function app_private.audit_write(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Append-only audit trail
-- ---------------------------------------------------------------------------------------------
create function app_private.deny_mutation() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '% on % is not allowed (append-only)', tg_op, tg_table_name using errcode = '42501'; end $$;

revoke all on function app_private.deny_mutation() from public, anon, authenticated;
create trigger audit_events_no_update_delete before update or delete on public.audit_events
  for each row execute function app_private.deny_mutation();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function app_private.deny_mutation();

-- ---------------------------------------------------------------------------------------------
-- Triggers: updated_at, profile bootstrap
-- ---------------------------------------------------------------------------------------------
create function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;
revoke all on function app_private.touch_updated_at() from public, anon, authenticated;
create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.touch_updated_at();

create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.role_assignments (user_id, role) values (new.id, 'customer');
  insert into public.audit_events (actor_id, action, entity_type, entity_id)
  values (new.id, 'account.created', 'user', new.id::text);
  return new;
end $$;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Table privileges: nothing for anon; minimal for authenticated; no direct writes to sensitive tables
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'role_assignments', 'audit_events', 'platform_settings', 'vendors',
    'vendor_staff', 'rider_profiles', 'stub_order_placements', 'stub_capacity_slots'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
alter table app_private.rate_limit_events enable row level security;
revoke all on app_private.rate_limit_events from public, anon, authenticated;

grant select on public.profiles, public.role_assignments, public.audit_events,
  public.platform_settings, public.vendors, public.vendor_staff, public.rider_profiles,
  public.stub_order_placements to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------------------------
-- RLS policies. Restrictive policies are ANDed with the permissive ones.
-- ---------------------------------------------------------------------------------------------
-- profiles
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_select_staff on public.profiles for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_mfa_privileged on public.profiles as restrictive for all to authenticated
  using (app_private.mfa_satisfied());
-- Editing the account is a "protected account feature": aal2 for everyone, customers included.
create policy profiles_update_needs_aal2 on public.profiles as restrictive for update to authenticated
  using (app_private.is_aal2()) with check (app_private.is_aal2());

-- role_assignments (read-only through the API; writes via grant_role/revoke_role)
create policy role_assignments_select_self on public.role_assignments for select to authenticated
  using (user_id = (select auth.uid()));
create policy role_assignments_select_staff on public.role_assignments for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy role_assignments_mfa on public.role_assignments as restrictive for all to authenticated
  using (app_private.mfa_satisfied());

-- audit_events
create policy audit_events_select_staff on public.audit_events for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy audit_events_mfa on public.audit_events as restrictive for all to authenticated
  using (app_private.mfa_satisfied());

-- platform_settings
create policy platform_settings_select_staff on public.platform_settings for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]));
create policy platform_settings_mfa on public.platform_settings as restrictive for all to authenticated
  using (app_private.mfa_satisfied());

-- vendors / vendor_staff / rider_profiles
create policy vendors_select_member on public.vendors for select to authenticated
  using (app_private.is_vendor_member(id) or app_private.has_role('platform_admin'));
create policy vendors_mfa on public.vendors as restrictive for all to authenticated
  using (app_private.mfa_satisfied());
create policy vendor_staff_select on public.vendor_staff for select to authenticated
  using (user_id = (select auth.uid()) or app_private.has_role('platform_admin'));
create policy vendor_staff_mfa on public.vendor_staff as restrictive for all to authenticated
  using (app_private.mfa_satisfied());
create policy rider_profiles_select on public.rider_profiles for select to authenticated
  using (user_id = (select auth.uid())
         or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy rider_profiles_mfa on public.rider_profiles as restrictive for all to authenticated
  using (app_private.mfa_satisfied());

-- stub_order_placements: own rows, and aal2 for EVERY registered user (protected feature)
create policy stub_orders_select_own on public.stub_order_placements for select to authenticated
  using (user_id = (select auth.uid()));
create policy stub_orders_needs_aal2 on public.stub_order_placements as restrictive for all to authenticated
  using (app_private.is_aal2());

-- stub_capacity_slots: no policies for API roles (access only via stub_claim_slot)

-- ---------------------------------------------------------------------------------------------
-- Client-callable functions (public schema = exposed as RPC). Each: SECURITY DEFINER, fixed
-- search_path, EXECUTE restricted, identity + authorization validated inside.
-- ---------------------------------------------------------------------------------------------
-- Roles of the caller. Callable at aal1 so the app can decide between MFA enroll/challenge/forbidden.
create function public.my_roles() returns public.app_role[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(ra.role order by ra.role), '{}'::public.app_role[])
  from public.role_assignments ra
  where ra.user_id = (select auth.uid()) and ra.status = 'active'
$$;

create function public.grant_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = v_actor then raise exception 'cannot change your own roles' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'unknown user' using errcode = 'P0002';
  end if;
  insert into public.role_assignments (user_id, role, granted_by) values (p_user, p_role, v_actor)
  on conflict (user_id, role) where status = 'active' do nothing;
  perform app_private.audit_write(v_actor, 'role.granted', 'user', p_user::text,
    jsonb_build_object('role', p_role));
end $$;

create function public.revoke_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_n int;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = v_actor then raise exception 'cannot change your own roles' using errcode = '42501'; end if;
  update public.role_assignments
     set status = 'revoked', revoked_at = now(), revoked_by = v_actor
   where user_id = p_user and role = p_role and status = 'active';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app_private.audit_write(v_actor, 'role.revoked', 'user', p_user::text,
      jsonb_build_object('role', p_role));
  end if;
end $$;

create function public.set_platform_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Policy encoded in code: vendor settlement stays DISABLED until Paystack + legal confirmation.
  if p_key = 'settlement_policy' and p_value is distinct from '"DISABLED"'::jsonb then
    raise exception 'settlement_policy is locked to DISABLED pending provider and legal approval'
      using errcode = '42501';
  end if;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, v_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform app_private.audit_write(v_actor, 'setting.changed', 'platform_setting', p_key,
    jsonb_build_object('value', p_value));
end $$;

-- STUB: "place an order" - requires a registered customer at aal2.
create function public.stub_place_order() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('customer') then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.stub_order_placements (user_id) values (v_actor) returning id into v_id;
  return v_id;
end $$;

-- STUB: atomic capacity claim (row lock). Returns false when full. Replaced by the real rider
-- capacity rule in Batch 4.
create function public.stub_claim_slot(p_slot int) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_cap int; v_used int;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select capacity, used into v_cap, v_used from public.stub_capacity_slots where id = p_slot for update;
  if not found then raise exception 'unknown slot' using errcode = 'P0002'; end if;
  if v_used >= v_cap then return false; end if;
  update public.stub_capacity_slots set used = used + 1 where id = p_slot;
  return true;
end $$;

-- Service-role-only helpers (called from the Next.js server, never from browsers).
create function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_count int;
begin
  if p_key is null or char_length(p_key) > 200 or p_window_seconds <= 0 or p_max <= 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  delete from app_private.rate_limit_events
   where key = p_key and occurred_at < now() - make_interval(secs => p_window_seconds);
  insert into app_private.rate_limit_events (key) values (p_key);
  select count(*) into v_count from app_private.rate_limit_events where key = p_key;
  return v_count <= p_max;
end $$;

create function public.record_security_event(p_actor uuid, p_action text, p_details jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_action !~ '^(auth|mfa)\.[a-z_]+$' then
    raise exception 'unsupported security event' using errcode = '22023';
  end if;
  perform app_private.audit_write(p_actor, p_action, 'security', null, p_details);
end $$;

do $$
declare f text;
begin
  -- authenticated-callable
  foreach f in array array[
    'public.my_roles()', 'public.grant_role(uuid, public.app_role)',
    'public.revoke_role(uuid, public.app_role)', 'public.set_platform_setting(text, jsonb)',
    'public.stub_place_order()', 'public.stub_claim_slot(int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- service-role only
  foreach f in array array[
    'public.rate_limit_hit(text, int, int)', 'public.record_security_event(uuid, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Seed reference data
insert into public.platform_settings (key, value) values
  ('settlement_policy', '"DISABLED"'::jsonb)
on conflict (key) do nothing;
