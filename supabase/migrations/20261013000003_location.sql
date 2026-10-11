-- Batch 4, Phase 8: rider location (current + limited history), validation, server-side arrival, privacy-scoped reads,
-- retention purge. SYNTHETIC coordinates only until AFIT approves real delivery points.

create table public.rider_location_current (
  rider_id uuid primary key references auth.users (id) on delete cascade,
  shift_id uuid not null references public.rider_shifts (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision not null check (accuracy_m >= 0),
  observed_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table public.rider_location_history (
  id bigint generated always as identity primary key,
  rider_id uuid not null references auth.users (id) on delete cascade,
  shift_id uuid not null references public.rider_shifts (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index rider_location_history_received_idx on public.rider_location_history (received_at);

-- Location is sensitive: NO direct table access for any API role. Reads go through the scoped functions below.
alter table public.rider_location_current enable row level security;
alter table public.rider_location_history enable row level security;
revoke all on public.rider_location_current, public.rider_location_history from public, anon, authenticated;
grant all on public.rider_location_current, public.rider_location_history to service_role;
grant usage, select on all sequences in schema public to service_role;
create policy rider_location_current_aal2 on public.rider_location_current as restrictive for all to authenticated using (app_private.is_aal2());
create policy rider_location_history_aal2 on public.rider_location_history as restrictive for all to authenticated using (app_private.is_aal2());

-- A fix is stored only while the rider is on an active shift WITH active delivery work. Stale, inaccurate,
-- implausible or too-frequent fixes are refused (returned, not raised). Arrival is inferred here, never claimed.
create function public.rider_post_location(p_lat double precision, p_lng double precision, p_accuracy double precision,
                                           p_observed_at timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rider uuid := app_private.require_rider(); v_shift uuid; v_last timestamptz; v_now timestamptz := now();
  v_max_acc double precision := app_private.setting_int('location_max_accuracy_m', 100);
  v_max_age int := app_private.setting_int('location_max_age_seconds', 120);
  v_min_gap int := app_private.setting_int('location_min_interval_seconds', 3);
  v_arr_acc double precision := app_private.setting_int('arrival_max_accuracy_m', 50);
  v_arr_age int := app_private.setting_int('arrival_max_age_seconds', 30);
  r record; v_arrived int := 0;
begin
  perform app_private.lock_rider(v_rider);
  select id into v_shift from public.rider_shifts where rider_id = v_rider and ended_at is null;
  if v_shift is null then raise exception 'tracking_not_active' using errcode = '22023'; end if;
  if not exists (select 1 from public.delivery_assignments d where d.rider_id = v_rider and d.status in ('accepted', 'picked_up', 'en_route')) then
    raise exception 'tracking_not_active' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_observed_at is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy < 0 or p_accuracy = 'NaN'
     or p_lat = 'NaN' or p_lng = 'NaN' then
    return jsonb_build_object('accepted', false, 'reason', 'malformed');
  end if;
  if p_observed_at > v_now + interval '30 seconds' then return jsonb_build_object('accepted', false, 'reason', 'implausible_time'); end if;
  if p_observed_at < v_now - make_interval(secs => v_max_age) then return jsonb_build_object('accepted', false, 'reason', 'stale'); end if;
  if p_accuracy > v_max_acc then return jsonb_build_object('accepted', false, 'reason', 'inaccurate'); end if;
  select received_at into v_last from public.rider_location_current where rider_id = v_rider;
  if v_last is not null and v_now - v_last < make_interval(secs => v_min_gap) then
    return jsonb_build_object('accepted', false, 'reason', 'rate_limited');
  end if;

  insert into public.rider_location_current (rider_id, shift_id, lat, lng, accuracy_m, observed_at, received_at)
    values (v_rider, v_shift, p_lat, p_lng, p_accuracy, p_observed_at, v_now)
    on conflict (rider_id) do update set shift_id = excluded.shift_id, lat = excluded.lat, lng = excluded.lng,
      accuracy_m = excluded.accuracy_m, observed_at = excluded.observed_at, received_at = excluded.received_at;
  insert into public.rider_location_history (rider_id, shift_id, lat, lng, accuracy_m, observed_at, received_at)
    values (v_rider, v_shift, p_lat, p_lng, p_accuracy, p_observed_at, v_now);

  -- Server-side arrival inference: only for parcels already EN_ROUTE, with a fresh, accurate fix inside the geofence.
  if p_accuracy <= v_arr_acc and p_observed_at >= v_now - make_interval(secs => v_arr_age) then
    for r in select d.id, d.order_id, d.dest_lat, d.dest_lng, d.dest_radius_m from public.delivery_assignments d
              join public.orders o on o.id = d.order_id
             where d.rider_id = v_rider and d.status = 'en_route' and d.arrival_detected_at is null
               and d.dest_lat is not null and o.status = 'EN_ROUTE' loop
      if app_private.haversine_m(p_lat, p_lng, r.dest_lat, r.dest_lng) <= r.dest_radius_m then
        update public.delivery_assignments set arrival_detected_at = v_now where id = r.id;
        perform app_private.step_order(r.order_id, 'EN_ROUTE', 'ARRIVAL_DETECTED', v_rider, 'arrival_detected_by_geofence');
        perform app_private.audit_write(v_rider, 'delivery.arrival_detected', 'order', r.order_id::text, '{}'::jsonb);
        v_arrived := v_arrived + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('accepted', true, 'arrivals_detected', v_arrived);
end $$;

-- What a customer (or approved staff) may see about the rider for ONE order, and only while it is in transit.
create function app_private.tracking_payload(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype; v_l public.rider_location_current%rowtype;
        v_stale int := app_private.setting_int('location_stale_after_seconds', 45)::int; v_age double precision; v_dp public.approved_delivery_points%rowtype;
begin
  select * into v_o from public.orders where id = p_order;
  if v_o.status not in ('PICKED_UP_BY_RIDER', 'EN_ROUTE', 'ARRIVAL_DETECTED') then
    return jsonb_build_object('tracking', false, 'reason', 'not_in_transit', 'status', v_o.status);
  end if;
  select * into v_a from public.delivery_assignments where order_id = p_order and status in ('picked_up', 'en_route');
  if not found then return jsonb_build_object('tracking', false, 'reason', 'no_active_assignment', 'status', v_o.status); end if;
  if not exists (select 1 from public.rider_shifts s where s.id = v_a.shift_id and s.ended_at is null) then
    return jsonb_build_object('tracking', false, 'reason', 'rider_not_sharing', 'status', v_o.status);
  end if;
  select * into v_l from public.rider_location_current where rider_id = v_a.rider_id and shift_id = v_a.shift_id;
  select * into v_dp from public.approved_delivery_points where id = v_o.delivery_point_id;
  if not found and v_l.rider_id is null then null; end if;
  if v_l.rider_id is null then
    return jsonb_build_object('tracking', false, 'reason', 'no_location_yet', 'status', v_o.status,
      'destination', jsonb_build_object('label', v_o.delivery_point_label, 'lat', v_a.dest_lat, 'lng', v_a.dest_lng, 'synthetic', coalesce(v_dp.is_synthetic, true)));
  end if;
  v_age := extract(epoch from (now() - v_l.observed_at));
  return jsonb_build_object('tracking', true, 'status', v_o.status,
    'rider', jsonb_build_object('lat', v_l.lat, 'lng', v_l.lng, 'accuracy_m', v_l.accuracy_m, 'observed_at', v_l.observed_at,
                                 'age_seconds', round(v_age), 'stale', v_age > v_stale),
    'destination', jsonb_build_object('label', v_o.delivery_point_label, 'lat', v_a.dest_lat, 'lng', v_a.dest_lng,
                                      'radius_m', v_a.dest_radius_m, 'synthetic', coalesce(v_dp.is_synthetic, true)),
    'arrival_detected', v_a.arrival_detected_at is not null);
end $$;

create function public.get_order_tracking(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_customer uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select customer_id into v_customer from public.orders where id = p_order;
  if v_customer is distinct from v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  return app_private.tracking_payload(p_order);
end $$;

-- Staff access needs an operational purpose and is audited every time.
create function public.staff_get_order_tracking(p_order uuid, p_purpose text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_ops();
begin
  if p_purpose is null or char_length(btrim(p_purpose)) < 10 then raise exception 'purpose_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.orders where id = p_order) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.audit_write(v_actor, 'tracking.staff_viewed', 'order', p_order::text, jsonb_build_object('purpose', left(btrim(p_purpose), 200)));
  return app_private.tracking_payload(p_order);
end $$;

-- Retention: history older than the configured window, and current rows of riders no longer on shift, are deleted.
create function public.purge_location_data() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_hours int := app_private.setting_int('location_history_retention_hours', 24)::int; v_h int; v_c int;
begin
  delete from public.rider_location_history where received_at < now() - make_interval(hours => v_hours);
  get diagnostics v_h = row_count;
  delete from public.rider_location_current c
   where c.received_at < now() - make_interval(hours => v_hours)
      or not exists (select 1 from public.rider_shifts s where s.id = c.shift_id and s.ended_at is null);
  get diagnostics v_c = row_count;
  if v_h + v_c > 0 then
    perform app_private.audit_write(null, 'location.purged', 'location', null, jsonb_build_object('history', v_h, 'current', v_c));
  end if;
  return jsonb_build_object('history_deleted', v_h, 'current_deleted', v_c);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.rider_post_location(double precision, double precision, double precision, timestamptz)',
                           'public.get_order_tracking(uuid)', 'public.staff_get_order_tracking(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke all on function app_private.tracking_payload(uuid) from public, anon, authenticated;
  grant execute on function app_private.tracking_payload(uuid) to service_role;
  revoke all on function public.purge_location_data() from public, anon, authenticated;
  grant execute on function public.purge_location_data() to service_role;
end $$;
