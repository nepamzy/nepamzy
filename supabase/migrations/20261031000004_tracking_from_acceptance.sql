-- Live tracking starts the moment a rider accepts the delivery (not only after pickup), so the customer can watch the
-- rider come to the shop and then to them. The rider's phone sends a position every 30 seconds by default
-- (setting location_send_interval_seconds) and a position is shown as out of date after 90 seconds.

create or replace function app_private.tracking_payload(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype; v_l public.rider_location_current%rowtype;
        v_stale int := app_private.setting_int('location_stale_after_seconds', 90)::int; v_age double precision; v_dp public.approved_delivery_points%rowtype;
begin
  select * into v_o from public.orders where id = p_order;
  if v_o.status not in ('RIDER_ASSIGNED', 'PICKED_UP_BY_RIDER', 'EN_ROUTE', 'ARRIVAL_DETECTED') then
    return jsonb_build_object('tracking', false, 'reason', 'not_in_transit', 'status', v_o.status);
  end if;
  select * into v_a from public.delivery_assignments where order_id = p_order and status in ('accepted', 'picked_up', 'en_route');
  if not found then return jsonb_build_object('tracking', false, 'reason', 'no_active_assignment', 'status', v_o.status); end if;
  if not exists (select 1 from public.rider_shifts s where s.id = v_a.shift_id and s.ended_at is null) then
    return jsonb_build_object('tracking', false, 'reason', 'rider_not_sharing', 'status', v_o.status);
  end if;
  select * into v_l from public.rider_location_current where rider_id = v_a.rider_id and shift_id = v_a.shift_id;
  select * into v_dp from public.approved_delivery_points where id = v_o.delivery_point_id;
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

update public.platform_settings set value = '90'::jsonb where key = 'location_stale_after_seconds';
insert into public.platform_settings (key, value, note) values
  ('location_send_interval_seconds', '30'::jsonb, 'How often a rider''s phone sends its position while carrying a delivery. Lower is smoother but uses more battery and data.')
on conflict (key) do nothing;
