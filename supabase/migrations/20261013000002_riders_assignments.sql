-- Batch 4, Phase 7: rider onboarding, terms, shifts, offers, capacity-five assignment, assignment tokens, issues.
-- Rules enforced here (not in the browser):
--   * a rider acts only when approved (profile), has acknowledged the current terms, holds an ACTIVE shift and is at aal2;
--   * at most FIVE active deliveries per rider (slot 1..5 + unique index; the rider row lock is the primary control);
--   * at most ONE active assignment per order (unique index; the order row lock is the primary control);
--   * a vendor hands a parcel only to the assigned rider via a one-time, expiring, hashed, assignment-bound token;
--   * no function here can mark an order delivered or completed.

-- ---------------------------------------------------------------------------------------------
-- Settings (placeholders; owner supplies real values)
-- ---------------------------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('rider_terms_current_version', '"dev-placeholder-1"'::jsonb, 'Version riders must acknowledge before Go Active. Placeholder text only.'),
  ('handover_token_ttl_minutes', '60'::jsonb, 'PLACEHOLDER: lifetime of a vendor-to-rider handover token'),
  ('location_max_accuracy_m', '100'::jsonb, 'PLACEHOLDER: fixes less accurate than this are rejected'),
  ('location_max_age_seconds', '120'::jsonb, 'PLACEHOLDER: fixes older than this are rejected'),
  ('location_min_interval_seconds', '3'::jsonb, 'PLACEHOLDER: minimum seconds between accepted fixes per rider'),
  ('location_stale_after_seconds', '45'::jsonb, 'PLACEHOLDER: customers see a position as stale after this many seconds'),
  ('arrival_max_accuracy_m', '50'::jsonb, 'PLACEHOLDER: arrival needs accuracy at least this good'),
  ('arrival_max_age_seconds', '30'::jsonb, 'PLACEHOLDER: arrival needs a fix at most this old'),
  ('default_geofence_radius_m', '60'::jsonb, 'PLACEHOLDER: arrival radius when a delivery point has none'),
  ('location_history_retention_hours', '24'::jsonb, 'PLACEHOLDER: GPS history older than this is purged')
on conflict (key) do nothing;

create or replace function public.set_platform_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_n bigint;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_key = 'settlement_policy' and p_value is distinct from '"DISABLED"'::jsonb then
    raise exception 'settlement_policy is locked to DISABLED pending provider and legal approval' using errcode = '42501';
  end if;
  if p_key = 'mock_payments_enabled' then
    raise exception 'mock_payments_enabled can only be changed with direct database access' using errcode = '42501';
  end if;
  if p_key = 'typed_signature_enabled' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'invalid value for %', p_key using errcode = '22023';
  end if;
  if p_key in ('delivery_fee_kobo', 'platform_fee_bps', 'unpaid_order_expiry_minutes', 'max_cart_item_quantity',
               'handover_token_ttl_minutes', 'location_max_accuracy_m', 'location_max_age_seconds',
               'location_min_interval_seconds', 'location_stale_after_seconds', 'arrival_max_accuracy_m',
               'arrival_max_age_seconds', 'default_geofence_radius_m', 'location_history_retention_hours') then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,9}$' then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
    v_n := (p_value #>> '{}')::bigint;
    if (p_key = 'delivery_fee_kobo' and v_n > 1000000) or (p_key = 'platform_fee_bps' and v_n > 3000)
       or (p_key = 'unpaid_order_expiry_minutes' and v_n not between 5 and 1440)
       or (p_key = 'max_cart_item_quantity' and v_n not between 1 and 100)
       or (p_key = 'handover_token_ttl_minutes' and v_n not between 5 and 720)
       or (p_key = 'location_max_accuracy_m' and v_n not between 5 and 500)
       or (p_key = 'location_max_age_seconds' and v_n not between 5 and 600)
       or (p_key = 'location_min_interval_seconds' and v_n not between 1 and 60)
       or (p_key = 'location_stale_after_seconds' and v_n not between 10 and 600)
       or (p_key = 'arrival_max_accuracy_m' and v_n not between 5 and 200)
       or (p_key = 'arrival_max_age_seconds' and v_n not between 5 and 120)
       or (p_key = 'default_geofence_radius_m' and v_n not between 10 and 500)
       or (p_key = 'location_history_retention_hours' and v_n not between 1 and 720) then
      raise exception 'value out of range for %', p_key using errcode = '22023';
    end if;
  end if;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, v_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform app_private.audit_write(v_actor, 'setting.changed', 'platform_setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Delivery point geometry (SYNTHETIC until AFIT approves real points)
-- ---------------------------------------------------------------------------------------------
alter table public.approved_delivery_points
  add column lat double precision check (lat is null or lat between -90 and 90),
  add column lng double precision check (lng is null or lng between -180 and 180),
  add column geofence_radius_m int check (geofence_radius_m is null or geofence_radius_m between 10 and 500),
  add column is_synthetic boolean not null default true,
  add constraint delivery_point_geo_pair check ((lat is null) = (lng is null));

create function public.delivery_point_set_geo(p_id uuid, p_lat double precision, p_lng double precision, p_radius int)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin();
begin
  update public.approved_delivery_points set lat = p_lat, lng = p_lng, geofence_radius_m = p_radius where id = p_id;
  if not found then raise exception 'unknown delivery point' using errcode = 'P0002'; end if;
  perform app_private.audit_write(v_actor, 'delivery_point.geo_set', 'delivery_point', p_id::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.rider_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  contact_phone text not null check (contact_phone ~ '^[0-9+() -]{7,20}$'),
  vehicle_note text check (vehicle_note is null or char_length(vehicle_note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 500),
  created_at timestamptz not null default now(),
  constraint rider_applications_decided check ((status = 'pending') = (decided_at is null))
);
create unique index rider_applications_one_pending on public.rider_applications (applicant_id) where status = 'pending';

-- rider_profiles exists since Batch 1 (user_id, status, created_at); Phase 7 adds the profile details.
alter table public.rider_profiles
  add column full_name text not null default '',
  add column contact_phone text not null default '',
  add column approved_by uuid references auth.users (id) on delete set null,
  add column updated_at timestamptz not null default now();
alter table public.rider_profiles alter column full_name drop default, alter column contact_phone drop default;
alter table public.rider_profiles alter column status set default 'approved';

-- Replaces the Batch 1 capacity stub with the real rule below.
drop function public.stub_claim_slot(int);
drop table public.stub_capacity_slots;

create trigger rider_profiles_touch before update on public.rider_profiles
  for each row execute function app_private.touch_updated_at();

create table public.rider_terms_versions (
  version text primary key,
  title text not null,
  body text not null,
  is_placeholder boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.rider_terms_versions (version, title, body, is_placeholder) values
  ('dev-placeholder-1', 'Rider terms, conduct and privacy notice (DEVELOPMENT PLACEHOLDER)',
   'PLACEHOLDER TEXT - NOT APPROVED BY AFIT OR COUNSEL. By going active you agree to: carry out only deliveries you accepted; follow AFIT access and safety rules; never share a handover code with anyone but the intended party; keep your phone location sharing on only while you are active with delivery work. Your location is shared only with the customer you are delivering to and authorised staff, and is deleted according to the retention setting. Final wording must be supplied and approved before any real rider is onboarded.',
   true);

create table public.rider_terms_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null references public.rider_terms_versions (version),
  acknowledged_at timestamptz not null default now(),
  unique (user_id, version)
);
create trigger rider_terms_ack_append_only before update or delete on public.rider_terms_acknowledgements
  for each row execute function app_private.deny_mutation();

create table public.rider_shifts (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason is null or end_reason in ('rider', 'ops', 'suspended')),
  constraint rider_shifts_end_shape check ((ended_at is null) = (end_reason is null))
);
create unique index rider_one_active_shift on public.rider_shifts (rider_id) where ended_at is null;

create table public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  rider_id uuid not null references auth.users (id) on delete restrict,
  shift_id uuid not null references public.rider_shifts (id) on delete restrict,
  slot smallint not null check (slot between 1 and 5),
  assignment_no int not null default 1,
  status text not null default 'accepted' check (status in ('accepted', 'picked_up', 'en_route', 'released')),
  dest_lat double precision,
  dest_lng double precision,
  dest_radius_m int,
  accepted_at timestamptz not null default now(),
  picked_up_at timestamptz,
  en_route_at timestamptz,
  arrival_detected_at timestamptz,
  released_at timestamptz,
  release_reason text,
  constraint delivery_assignments_release_shape check ((status = 'released') = (released_at is not null))
);
-- BACKSTOPS for the two invariants. The row locks in the functions are the primary controls; these make
-- a violation impossible even if a lock were missing.
-- "Active" = accepted / picked_up / en_route (Phase 9 will add a terminal status that frees the slot).
create unique index delivery_assignments_one_active_per_order on public.delivery_assignments (order_id)
  where status in ('accepted', 'picked_up', 'en_route');
create unique index delivery_assignments_rider_slot_uq on public.delivery_assignments (rider_id, slot)
  where status in ('accepted', 'picked_up', 'en_route');
create index delivery_assignments_rider_idx on public.delivery_assignments (rider_id, status);

create table public.assignment_tokens (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.delivery_assignments (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  invalidated_at timestamptz,
  failed_attempts int not null default 0,
  created_at timestamptz not null default now()
);
create unique index assignment_tokens_one_live on public.assignment_tokens (assignment_id)
  where used_at is null and invalidated_at is null;

create table public.rider_issues (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.delivery_assignments (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,
  rider_id uuid references auth.users (id) on delete set null,
  reason text not null check (reason in ('vendor_not_ready', 'recipient_unavailable', 'blocked_route',
                                          'safety_security_restriction', 'gps_issue', 'ops_flag')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  constraint rider_issues_resolved check ((status = 'open') = (resolved_at is null))
);
create index rider_issues_open_idx on public.rider_issues (created_at) where status = 'open';

-- ---------------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------------
create function app_private.require_rider() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('rider') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.rider_profiles rp where rp.user_id = v_actor and rp.status = 'approved') then
    raise exception 'rider_not_approved' using errcode = '42501';
  end if;
  return v_actor;
end $$;

create function app_private.require_ops() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_actor;
end $$;

-- The two row locks that serialise capacity and order assignment. Kept as tiny functions so tests can
-- remove them and prove the unique-index backstops (and that the tests would notice a missing lock).
create function app_private.lock_rider(p_rider uuid) returns void
language sql security definer set search_path = ''
as $$ select 1 from public.rider_profiles where user_id = p_rider for update $$;

create function app_private.lock_order_row(p_order uuid) returns void
language sql security definer set search_path = ''
as $$ select 1 from public.orders where id = p_order for update $$;

-- TEST SEAM: a no-op in production. Concurrency tests redefine it to hold every session at a barrier so that all
-- of them have passed the check they are racing before any of them writes.
create function app_private.test_seam(p_name text) returns void
language sql security definer set search_path = ''
as $$ select 1 $$;

create function app_private.haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable parallel safe set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- Releases an assignment that has not reached the pickup stage and puts the order back on offer.
create function app_private.release_assignment(p_assignment uuid, p_reason text, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_a public.delivery_assignments%rowtype;
begin
  select * into v_a from public.delivery_assignments where id = p_assignment for update;
  if not found or v_a.status <> 'accepted' then raise exception 'assignment_not_releasable' using errcode = '22023'; end if;
  update public.delivery_assignments set status = 'released', released_at = now(), release_reason = left(p_reason, 100)
   where id = p_assignment;
  update public.assignment_tokens set invalidated_at = now()
   where assignment_id = p_assignment and used_at is null and invalidated_at is null;
  perform app_private.step_order(v_a.order_id, 'RIDER_ASSIGNED', 'AWAITING_RIDER', p_actor, 'rider_released:' || left(p_reason, 60));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Application and approval
-- ---------------------------------------------------------------------------------------------
create function public.submit_rider_application(p_name text, p_phone text, p_vehicle text, p_accept boolean) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('customer') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_accept is distinct from true then raise exception 'terms_not_accepted' using errcode = '22023'; end if;
  if exists (select 1 from public.rider_profiles rp where rp.user_id = v_actor) then
    raise exception 'already_a_rider' using errcode = '23505';
  end if;
  begin
    insert into public.rider_applications (applicant_id, full_name, contact_phone, vehicle_note)
    values (v_actor, btrim(p_name), btrim(p_phone), nullif(btrim(coalesce(p_vehicle, '')), '')) returning id into v_id;
  exception when unique_violation then
    raise exception 'application_pending' using errcode = '23505';
  end;
  perform app_private.audit_write(v_actor, 'rider_application.submitted', 'rider_application', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

create function public.decide_rider_application(p_application uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin(); v_app public.rider_applications%rowtype;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'invalid decision' using errcode = '22023'; end if;
  select * into v_app from public.rider_applications where id = p_application for update;
  if not found then raise exception 'unknown application' using errcode = 'P0002'; end if;
  if v_app.status <> 'pending' then raise exception 'already decided' using errcode = '23505'; end if;
  if v_app.applicant_id = v_actor then raise exception 'cannot decide your own application' using errcode = '42501'; end if;
  if p_decision = 'reject' then
    if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then
      raise exception 'a reason is required' using errcode = '22023';
    end if;
    update public.rider_applications set status = 'rejected', decided_by = v_actor, decided_at = now(),
      decision_reason = btrim(p_reason) where id = p_application;
    perform app_private.audit_write(v_actor, 'rider_application.rejected', 'rider_application', p_application::text, '{}'::jsonb);
    return;
  end if;
  insert into public.rider_profiles (user_id, full_name, contact_phone, approved_by)
    values (v_app.applicant_id, v_app.full_name, v_app.contact_phone, v_actor);
  insert into public.role_assignments (user_id, role, granted_by) values (v_app.applicant_id, 'rider', v_actor)
    on conflict (user_id, role) where status = 'active' do nothing;
  update public.rider_applications set status = 'approved', decided_by = v_actor, decided_at = now(),
    decision_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_application;
  perform app_private.audit_write(v_actor, 'rider_application.approved', 'rider_application', p_application::text, '{}'::jsonb);
end $$;

-- Suspend / reinstate. Suspension removes the rider role, ends the shift, releases work that has not been picked up
-- and flags work already in progress for staff (nothing is dropped silently).
create function public.set_rider_status(p_rider uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin(); r record;
begin
  if p_status not in ('approved', 'suspended') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  perform app_private.lock_rider(p_rider);
  update public.rider_profiles set status = p_status where user_id = p_rider;
  if not found then raise exception 'unknown rider' using errcode = 'P0002'; end if;
  if p_status = 'suspended' then
    update public.role_assignments set status = 'revoked', revoked_by = v_actor, revoked_at = now()
     where user_id = p_rider and role = 'rider' and status = 'active';
    for r in select id from public.delivery_assignments where rider_id = p_rider and status = 'accepted' loop
      perform app_private.release_assignment(r.id, 'rider_suspended', v_actor);
    end loop;
    for r in select id, order_id from public.delivery_assignments where rider_id = p_rider and status in ('picked_up', 'en_route') loop
      insert into public.rider_issues (assignment_id, order_id, rider_id, reason, note)
        values (r.id, r.order_id, p_rider, 'ops_flag', 'rider suspended while delivery in progress');
    end loop;
    update public.rider_shifts set ended_at = now(), end_reason = 'suspended' where rider_id = p_rider and ended_at is null;
    delete from public.rider_location_current where rider_id = p_rider;
  else
    insert into public.role_assignments (user_id, role, granted_by) values (p_rider, 'rider', v_actor)
      on conflict (user_id, role) where status = 'active' do nothing;
  end if;
  perform app_private.audit_write(v_actor, 'rider.status_changed', 'rider', p_rider::text,
    jsonb_build_object('status', p_status, 'reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Terms and shifts
-- ---------------------------------------------------------------------------------------------
create function public.rider_ack_terms(p_version text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); v_current text;
begin
  select (s.value #>> '{}') into v_current from public.platform_settings s where s.key = 'rider_terms_current_version';
  if v_current is null or p_version is distinct from v_current then
    raise exception 'terms_version_mismatch' using errcode = '22023';
  end if;
  insert into public.rider_terms_acknowledgements (user_id, version) values (v_actor, p_version)
    on conflict (user_id, version) do nothing;
  perform app_private.audit_write(v_actor, 'rider.terms_acknowledged', 'rider', v_actor::text, jsonb_build_object('version', p_version));
end $$;

create function public.my_rider() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); v_ver text; v_shift public.rider_shifts%rowtype;
begin
  select (s.value #>> '{}') into v_ver from public.platform_settings s where s.key = 'rider_terms_current_version';
  select * into v_shift from public.rider_shifts where rider_id = v_actor and ended_at is null;
  return jsonb_build_object(
    'full_name', (select full_name from public.rider_profiles where user_id = v_actor),
    'terms_version', v_ver,
    'terms_title', (select title from public.rider_terms_versions where version = v_ver),
    'terms_body', (select body from public.rider_terms_versions where version = v_ver),
    'terms_is_placeholder', (select is_placeholder from public.rider_terms_versions where version = v_ver),
    'terms_acknowledged', exists (select 1 from public.rider_terms_acknowledgements a where a.user_id = v_actor and a.version = v_ver),
    'active', v_shift.id is not null,
    'shift_started_at', v_shift.started_at,
    'active_deliveries', (select count(*) from public.delivery_assignments d where d.rider_id = v_actor
                           and d.status in ('accepted', 'picked_up', 'en_route')));
end $$;

create function public.rider_go_active() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); v_ver text; v_shift uuid;
begin
  perform app_private.lock_rider(v_actor);
  select (s.value #>> '{}') into v_ver from public.platform_settings s where s.key = 'rider_terms_current_version';
  if not exists (select 1 from public.rider_terms_acknowledgements a where a.user_id = v_actor and a.version = v_ver) then
    raise exception 'terms_not_acknowledged' using errcode = '22023';
  end if;
  select id into v_shift from public.rider_shifts where rider_id = v_actor and ended_at is null;
  if v_shift is null then
    insert into public.rider_shifts (rider_id) values (v_actor) returning id into v_shift;
    perform app_private.audit_write(v_actor, 'rider.went_active', 'rider', v_actor::text, jsonb_build_object('shift', v_shift));
  end if;
  return v_shift;
end $$;

-- Branches when work remains:
--   * nothing active                      -> shift ends
--   * only not-yet-picked-up assignments  -> they are released back to AWAITING_RIDER, then the shift ends
--   * any parcel already picked up        -> REFUSED (active_deliveries_in_progress); the rider must finish or ask support
create function public.rider_go_inactive() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); r record; v_released int := 0;
begin
  perform app_private.lock_rider(v_actor);
  if exists (select 1 from public.delivery_assignments d where d.rider_id = v_actor and d.status in ('picked_up', 'en_route')) then
    raise exception 'active_deliveries_in_progress' using errcode = '22023';
  end if;
  for r in select id from public.delivery_assignments d where d.rider_id = v_actor and d.status = 'accepted' loop
    perform app_private.release_assignment(r.id, 'shift_ended', v_actor);
    v_released := v_released + 1;
  end loop;
  update public.rider_shifts set ended_at = now(), end_reason = 'rider' where rider_id = v_actor and ended_at is null;
  delete from public.rider_location_current where rider_id = v_actor;
  perform app_private.audit_write(v_actor, 'rider.went_inactive', 'rider', v_actor::text, jsonb_build_object('released', v_released));
  return jsonb_build_object('released', v_released);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Offers and acceptance
-- ---------------------------------------------------------------------------------------------
create function public.list_delivery_offers() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider();
begin
  if not exists (select 1 from public.rider_shifts where rider_id = v_actor and ended_at is null) then
    raise exception 'not_active' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number,
            'vendor_name', o.vendor_name, 'pickup', o.pickup_location_snapshot, 'deliver_to', o.delivery_point_label,
            'offered_at', o.updated_at) order by o.updated_at), '[]'::jsonb)
          from (select * from public.orders where fulfilment = 'delivery' and status = 'AWAITING_RIDER'
                 and not exists (select 1 from public.delivery_assignments d where d.order_id = orders.id
                                  and d.status in ('accepted', 'picked_up', 'en_route'))
                 order by updated_at limit 20) o);
end $$;

create function public.rider_accept_order(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rider uuid := app_private.require_rider(); v_ver text; v_shift uuid; v_o public.orders%rowtype;
  v_existing public.delivery_assignments%rowtype; v_count int; v_slot int; v_no int; v_dp public.approved_delivery_points%rowtype;
  v_a uuid;
begin
  perform app_private.lock_rider(v_rider);
  select (s.value #>> '{}') into v_ver from public.platform_settings s where s.key = 'rider_terms_current_version';
  if not exists (select 1 from public.rider_terms_acknowledgements a where a.user_id = v_rider and a.version = v_ver) then
    raise exception 'terms_not_acknowledged' using errcode = '22023';
  end if;
  select id into v_shift from public.rider_shifts where rider_id = v_rider and ended_at is null;
  if v_shift is null then raise exception 'not_active' using errcode = '22023'; end if;

  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if not found then raise exception 'order_unavailable' using errcode = '22023'; end if;
  select * into v_existing from public.delivery_assignments where order_id = p_order and status in ('accepted', 'picked_up', 'en_route');
  if found then
    if v_existing.rider_id = v_rider then
      return jsonb_build_object('assignment_id', v_existing.id, 'already_assigned', true);
    end if;
    raise exception 'order_unavailable' using errcode = '22023';
  end if;
  if v_o.fulfilment <> 'delivery' or v_o.status <> 'AWAITING_RIDER' then
    raise exception 'order_unavailable' using errcode = '22023';
  end if;
  perform app_private.test_seam('after_order_check');

  select count(*) into v_count from public.delivery_assignments d where d.rider_id = v_rider and d.status in ('accepted', 'picked_up', 'en_route');
  if v_count >= 5 then raise exception 'capacity_reached' using errcode = '22023'; end if;
  perform app_private.test_seam('after_capacity_check');

  select min(s) into v_slot from generate_series(1, 5) s
   where not exists (select 1 from public.delivery_assignments d where d.rider_id = v_rider and d.slot = s
                      and d.status in ('accepted', 'picked_up', 'en_route'));
  if v_slot is null then raise exception 'capacity_reached' using errcode = '22023'; end if;
  select coalesce(max(assignment_no), 0) + 1 into v_no from public.delivery_assignments where order_id = p_order;
  select * into v_dp from public.approved_delivery_points where id = v_o.delivery_point_id;

  begin
    insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, assignment_no, dest_lat, dest_lng, dest_radius_m)
    values (p_order, v_rider, v_shift, v_slot, v_no, v_dp.lat, v_dp.lng,
            case when v_dp.lat is null then null else coalesce(v_dp.geofence_radius_m, app_private.setting_int('default_geofence_radius_m', 60)::int) end)
    returning id into v_a;
  exception when unique_violation then
    if exists (select 1 from public.delivery_assignments d where d.order_id = p_order and d.status in ('accepted', 'picked_up', 'en_route')) then
      raise exception 'order_unavailable' using errcode = '22023';
    end if;
    raise exception 'capacity_reached' using errcode = '22023';
  end;
  perform app_private.step_order(p_order, 'AWAITING_RIDER', 'RIDER_ASSIGNED', v_rider, 'rider_accepted');
  perform app_private.audit_write(v_rider, 'rider.accepted_order', 'order', p_order::text, jsonb_build_object('assignment', v_a, 'slot', v_slot));
  return jsonb_build_object('assignment_id', v_a, 'slot', v_slot, 'already_assigned', false);
end $$;

create function public.my_assignments() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'assignment_id', d.id, 'order_id', o.id, 'order_number', o.order_number, 'vendor_name', o.vendor_name,
            'pickup', o.pickup_location_snapshot, 'deliver_to', o.delivery_point_label, 'status', d.status,
            'order_status', o.status, 'slot', d.slot, 'sequence', d.seq, 'arrival_detected_at', d.arrival_detected_at,
            'dest_lat', d.dest_lat, 'dest_lng', d.dest_lng, 'dest_synthetic', true) order by d.seq), '[]'::jsonb)
          from (select a.*, row_number() over (order by a.accepted_at) as seq from public.delivery_assignments a
                 where a.rider_id = v_actor and a.status in ('accepted', 'picked_up', 'en_route')) d
          join public.orders o on o.id = d.order_id);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Vendor-to-rider handover token (assignment-bound, one-time, expiring, hash only)
-- ---------------------------------------------------------------------------------------------
create function public.rider_issue_handover_token(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_rider uuid := app_private.require_rider(); v_a public.delivery_assignments%rowtype; v_token text; v_exp timestamptz;
begin
  select * into v_a from public.delivery_assignments where id = p_assignment for update;
  if not found or v_a.rider_id <> v_rider then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_a.status <> 'accepted' then raise exception 'token_not_needed' using errcode = '22023'; end if;
  update public.assignment_tokens set invalidated_at = now()
   where assignment_id = p_assignment and used_at is null and invalidated_at is null;
  v_token := upper(encode(extensions.gen_random_bytes(5), 'hex'));
  v_exp := now() + make_interval(mins => app_private.setting_int('handover_token_ttl_minutes', 60)::int);
  insert into public.assignment_tokens (assignment_id, token_hash, expires_at)
    values (p_assignment, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;

create function public.vendor_pending_rider_pickups() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_number', o.order_number,
            'rider_name', rp.full_name, 'assignment_no', d.assignment_no) order by d.accepted_at), '[]'::jsonb)
          from public.delivery_assignments d
          join public.orders o on o.id = d.order_id
          join public.rider_profiles rp on rp.user_id = d.rider_id
          where d.status = 'accepted' and o.status = 'RIDER_ASSIGNED'
            and exists (select 1 from public.vendor_staff vs where vs.vendor_id = o.vendor_id and vs.user_id = v_actor)
            and exists (select 1 from public.vendors v where v.id = o.vendor_id and v.status = 'approved'));
end $$;

-- A wrong token is COUNTED and returned (not raised) so the counter commits; 5 wrong tries lock the token.
create function public.vendor_confirm_rider_pickup(p_order uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype;
        v_t public.assignment_tokens%rowtype; v_hash text;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.require_vendor_actor(v_o.vendor_id);
  select * into v_a from public.delivery_assignments where order_id = p_order and status in ('accepted', 'picked_up', 'en_route') for update;
  if not found or v_a.status <> 'accepted' then return jsonb_build_object('ok', false, 'reason', 'no_pending_pickup'); end if;
  select * into v_t from public.assignment_tokens
   where assignment_id = v_a.id and used_at is null and invalidated_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'token_unavailable'); end if;
  if v_t.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'token_expired'); end if;
  if v_t.failed_attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'token_locked'); end if;
  v_hash := encode(extensions.digest(upper(btrim(coalesce(p_token, ''))), 'sha256'), 'hex');
  if v_hash <> v_t.token_hash then
    update public.assignment_tokens set failed_attempts = failed_attempts + 1 where id = v_t.id;
    perform app_private.audit_write(v_actor, 'rider_handover.wrong_token', 'order', p_order::text, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'reason', 'wrong_token', 'attempts_left', greatest(0, 4 - v_t.failed_attempts));
  end if;
  update public.assignment_tokens set used_at = now() where id = v_t.id;
  update public.delivery_assignments set status = 'picked_up', picked_up_at = now() where id = v_a.id;
  perform app_private.step_order(p_order, 'RIDER_ASSIGNED', 'PICKED_UP_BY_RIDER', v_actor, 'vendor_handed_to_rider');
  perform app_private.audit_write(v_actor, 'rider_handover.confirmed', 'order', p_order::text, jsonb_build_object('assignment', v_a.id));
  return jsonb_build_object('ok', true);
end $$;

create function public.rider_start_route(p_assignment uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_rider uuid := app_private.require_rider(); v_a public.delivery_assignments%rowtype;
begin
  select * into v_a from public.delivery_assignments where id = p_assignment for update;
  if not found or v_a.rider_id <> v_rider then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_a.status <> 'picked_up' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  update public.delivery_assignments set status = 'en_route', en_route_at = now() where id = p_assignment;
  perform app_private.step_order(v_a.order_id, 'PICKED_UP_BY_RIDER', 'EN_ROUTE', v_rider, 'rider_en_route');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Issues and operations
-- ---------------------------------------------------------------------------------------------
create function public.rider_report_issue(p_assignment uuid, p_reason text, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_rider uuid := app_private.require_rider(); v_a public.delivery_assignments%rowtype; v_id uuid;
begin
  if p_reason not in ('vendor_not_ready', 'recipient_unavailable', 'blocked_route', 'safety_security_restriction', 'gps_issue') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select * into v_a from public.delivery_assignments where id = p_assignment;
  if not found or v_a.rider_id <> v_rider or v_a.status not in ('accepted', 'picked_up', 'en_route') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.rider_issues (assignment_id, order_id, rider_id, reason, note)
    values (p_assignment, v_a.order_id, v_rider, p_reason, left(nullif(btrim(coalesce(p_note, '')), ''), 300))
    returning id into v_id;
  -- Deliberately NO automatic consequence (no penalty, refund or state change): the flag is for a human to read.
  perform app_private.audit_write(v_rider, 'rider.issue_reported', 'order', v_a.order_id::text, jsonb_build_object('reason', p_reason));
  return v_id;
end $$;

create function public.list_rider_issues() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_ops();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'order_number', o.order_number, 'reason', i.reason,
            'note', i.note, 'created_at', i.created_at, 'assignment_id', i.assignment_id, 'assignment_status', d.status)
            order by i.created_at), '[]'::jsonb)
          from public.rider_issues i join public.orders o on o.id = i.order_id
          left join public.delivery_assignments d on d.id = i.assignment_id
          where i.status = 'open');
end $$;

create function public.resolve_rider_issue(p_issue uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_ops();
begin
  if p_note is null or char_length(btrim(p_note)) < 3 then raise exception 'note_required' using errcode = '22023'; end if;
  update public.rider_issues set status = 'resolved', resolved_by = v_actor, resolved_at = now(), resolution_note = left(btrim(p_note), 300)
   where id = p_issue and status = 'open';
  if not found then raise exception 'issue_not_open' using errcode = '22023'; end if;
  perform app_private.audit_write(v_actor, 'rider.issue_resolved', 'rider_issue', p_issue::text, '{}'::jsonb);
end $$;

create function public.ops_release_assignment(p_assignment uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_ops();
begin
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'reason_required' using errcode = '22023'; end if;
  perform app_private.release_assignment(p_assignment, 'ops: ' || btrim(p_reason), v_actor);
  perform app_private.audit_write(v_actor, 'assignment.released_by_ops', 'assignment', p_assignment::text, jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rider_applications', 'rider_profiles', 'rider_terms_versions', 'rider_terms_acknowledgements',
                           'rider_shifts', 'delivery_assignments', 'assignment_tokens', 'rider_issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (app_private.is_aal2())', t || '_aal2', t);
  end loop;
end $$;
-- assignment_tokens: no user access at all (hash + counters are internal).
grant select on public.rider_applications, public.rider_profiles, public.rider_terms_versions,
  public.rider_terms_acknowledgements, public.rider_shifts, public.delivery_assignments, public.rider_issues to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy rider_applications_select on public.rider_applications for select to authenticated
  using (applicant_id = (select auth.uid()) or app_private.is_platform_admin());
create policy rider_terms_versions_select on public.rider_terms_versions for select to authenticated using (true);
create policy rider_terms_ack_select on public.rider_terms_acknowledgements for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_platform_admin());
create policy rider_shifts_select on public.rider_shifts for select to authenticated
  using (rider_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy delivery_assignments_select on public.delivery_assignments for select to authenticated
  using (rider_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy rider_issues_select on public.rider_issues for select to authenticated
  using (rider_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));

do $$
declare f text;
begin
  foreach f in array array[
    'public.delivery_point_set_geo(uuid, double precision, double precision, int)',
    'public.submit_rider_application(text, text, text, boolean)', 'public.decide_rider_application(uuid, text, text)',
    'public.set_rider_status(uuid, text, text)', 'public.rider_ack_terms(text)', 'public.my_rider()',
    'public.rider_go_active()', 'public.rider_go_inactive()', 'public.list_delivery_offers()',
    'public.rider_accept_order(uuid)', 'public.my_assignments()', 'public.rider_issue_handover_token(uuid)',
    'public.vendor_pending_rider_pickups()', 'public.vendor_confirm_rider_pickup(uuid, text)',
    'public.rider_start_route(uuid)', 'public.rider_report_issue(uuid, text, text)', 'public.list_rider_issues()',
    'public.resolve_rider_issue(uuid, text)', 'public.ops_release_assignment(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'app_private.require_rider()', 'app_private.require_ops()', 'app_private.lock_rider(uuid)',
    'app_private.lock_order_row(uuid)', 'app_private.test_seam(text)',
    'app_private.haversine_m(double precision, double precision, double precision, double precision)',
    'app_private.release_assignment(uuid, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
