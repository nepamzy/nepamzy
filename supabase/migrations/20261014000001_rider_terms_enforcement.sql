-- Batch 5, correction A8 / K48: placeholder rider terms must never authorise real rider work.
-- Until AFIT supplies approved wording, rider_terms_versions rows are flagged is_placeholder = true. Rider operations
-- (acknowledge, Go Active, accept a delivery) are refused in the DATABASE while the current terms version is a
-- placeholder, is unknown, or is missing. Approved wording can only be installed with direct database access
-- (rider_terms_versions has no write grant for API roles), together with a settings change by a platform admin.

create function app_private.current_terms_version() returns text
language sql stable security definer set search_path = ''
as $$ select (s.value #>> '{}') from public.platform_settings s where s.key = 'rider_terms_current_version' $$;

-- Raises terms_not_approved unless the current version exists and is NOT a placeholder.
create function app_private.require_approved_terms() returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_ver text := app_private.current_terms_version();
begin
  if v_ver is null or not exists (select 1 from public.rider_terms_versions t where t.version = v_ver and not t.is_placeholder) then
    raise exception 'terms_not_approved' using errcode = '22023';
  end if;
  return v_ver;
end $$;

-- Approved terms AND acknowledged by this rider.
create function app_private.require_terms_ack(p_rider uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_ver text := app_private.require_approved_terms();
begin
  if not exists (select 1 from public.rider_terms_acknowledgements a where a.user_id = p_rider and a.version = v_ver) then
    raise exception 'terms_not_acknowledged' using errcode = '22023';
  end if;
end $$;
revoke all on function app_private.current_terms_version(), app_private.require_approved_terms(),
  app_private.require_terms_ack(uuid) from public, anon, authenticated;

create or replace function public.rider_ack_terms(p_version text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); v_current text;
begin
  v_current := app_private.current_terms_version();
  if v_current is null or p_version is distinct from v_current then
    raise exception 'terms_version_mismatch' using errcode = '22023';
  end if;
  perform app_private.require_approved_terms();
  insert into public.rider_terms_acknowledgements (user_id, version) values (v_actor, p_version)
    on conflict (user_id, version) do nothing;
  perform app_private.audit_write(v_actor, 'rider.terms_acknowledged', 'rider', v_actor::text, jsonb_build_object('version', p_version));
end $$;

create or replace function public.rider_go_active() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); v_shift uuid;
begin
  perform app_private.lock_rider(v_actor);
  perform app_private.require_terms_ack(v_actor);
  select id into v_shift from public.rider_shifts where rider_id = v_actor and ended_at is null;
  if v_shift is null then
    insert into public.rider_shifts (rider_id) values (v_actor) returning id into v_shift;
    perform app_private.audit_write(v_actor, 'rider.went_active', 'rider', v_actor::text, jsonb_build_object('shift', v_shift));
  end if;
  return v_shift;
end $$;

create or replace function public.rider_accept_order(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rider uuid := app_private.require_rider(); v_shift uuid; v_o public.orders%rowtype;
  v_existing public.delivery_assignments%rowtype; v_count int; v_slot int; v_no int; v_dp public.approved_delivery_points%rowtype;
  v_a uuid;
begin
  perform app_private.lock_rider(v_rider);
  perform app_private.require_terms_ack(v_rider);
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

create or replace function public.my_rider() returns jsonb
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
    'terms_is_placeholder', coalesce((select is_placeholder from public.rider_terms_versions where version = v_ver), true),
    'terms_approved', exists (select 1 from public.rider_terms_versions where version = v_ver and not is_placeholder),
    'terms_acknowledged', exists (select 1 from public.rider_terms_acknowledgements a where a.user_id = v_actor and a.version = v_ver),
    'active', v_shift.id is not null,
    'shift_started_at', v_shift.started_at,
    'active_deliveries', (select count(*) from public.delivery_assignments d where d.rider_id = v_actor
                           and d.status in ('accepted', 'picked_up', 'en_route')));
end $$;
