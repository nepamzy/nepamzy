-- A customer's phone or laptop often only knows roughly where it is (Wi-Fi or network based, a few kilometres). That is
-- still useful to a rider as an approximate circle, so positions up to 5 km are accepted and the accuracy is passed on
-- to the rider's map, which draws the circle. (Riders still need 100 m or better: their positions drive arrival detection.)
create or replace function public.customer_post_location(p_order uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not exists (select 1 from public.orders where id = p_order and customer_id = v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy < 0 then
    return jsonb_build_object('accepted', false, 'reason', 'invalid');
  end if;
  if p_accuracy > 5000 then return jsonb_build_object('accepted', false, 'reason', 'inaccurate'); end if;
  if not exists (select 1 from public.delivery_assignments where order_id = p_order and status in ('accepted', 'picked_up', 'en_route')) then
    delete from public.customer_location_current where order_id = p_order;
    return jsonb_build_object('accepted', false, 'reason', 'no_active_delivery');
  end if;
  insert into public.customer_location_current (order_id, customer_id, lat, lng, accuracy_m, observed_at)
    values (p_order, v_actor, p_lat, p_lng, p_accuracy, now())
  on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, observed_at = now();
  return jsonb_build_object('accepted', true);
end $$;

create or replace function public.rider_job_map(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); v_a public.delivery_assignments%rowtype; v_o public.orders%rowtype;
        v_r public.rider_location_current%rowtype; v_c public.customer_location_current%rowtype;
        v_stale int := app_private.setting_int('location_stale_after_seconds', 90)::int;
begin
  select * into v_a from public.delivery_assignments where id = p_assignment and rider_id = v_actor and status in ('accepted', 'picked_up', 'en_route');
  if not found then return jsonb_build_object('active', false); end if;
  select * into v_o from public.orders where id = v_a.order_id;
  select * into v_r from public.rider_location_current where rider_id = v_actor;
  select * into v_c from public.customer_location_current where order_id = v_a.order_id;
  return jsonb_build_object('active', true,
    'destination', jsonb_build_object('label', v_o.delivery_point_label, 'lat', v_a.dest_lat, 'lng', v_a.dest_lng),
    'rider', case when v_r.rider_id is null then null else jsonb_build_object('lat', v_r.lat, 'lng', v_r.lng,
        'age_seconds', round(extract(epoch from (now() - v_r.observed_at)))) end,
    'customer', case when v_c.order_id is null then null else jsonb_build_object('lat', v_c.lat, 'lng', v_c.lng,
        'accuracy_m', v_c.accuracy_m,
        'age_seconds', round(extract(epoch from (now() - v_c.observed_at))),
        'stale', extract(epoch from (now() - v_c.observed_at)) > v_stale) end);
end $$;
