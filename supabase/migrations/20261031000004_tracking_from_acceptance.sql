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

-- The new setting must be on the allowlist before it can exist (an administrator can then change it, with a reason).
CREATE OR REPLACE FUNCTION app_private.setting_rule(p_key text)
 RETURNS TABLE(kind text, lo bigint, hi bigint, choices text[])
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select r.kind, r.lo, r.hi, r.choices from (values
    ('delivery_fee_kobo', 'int', 0::bigint, 1000000::bigint, null::text[]),
    ('platform_fee_bps', 'int', 0, 0, null),               -- pinned: the customer fee is retired
    ('vendor_commission_bps', 'int', 0, 2000, null),
    ('commission_afit_bps', 'int', 0, 2000, null),
    ('unpaid_order_expiry_minutes', 'int', 5, 1440, null),
    ('max_cart_item_quantity', 'int', 1, 100, null),
    ('handover_token_ttl_minutes', 'int', 5, 720, null),
    ('location_max_accuracy_m', 'int', 5, 500, null),
    ('location_max_age_seconds', 'int', 5, 600, null),
    ('location_min_interval_seconds', 'int', 1, 60, null),
    ('location_stale_after_seconds', 'int', 10, 600, null),
    ('location_send_interval_seconds', 'int', 5, 300, null),
    ('arrival_max_accuracy_m', 'int', 5, 200, null),
    ('arrival_max_age_seconds', 'int', 5, 120, null),
    ('default_geofence_radius_m', 'int', 10, 500, null),
    ('location_history_retention_hours', 'int', 1, 720, null),
    ('delivery_proof_ttl_minutes', 'int', 5, 120, null),
    ('refund_support_approval_limit_kobo', 'int', 0, 100000000, null),
    ('typed_signature_enabled', 'bool', null, null, null),
    ('refund_fee_policy', 'enum', null, null, array['none', 'proportional_service_fee']),
    ('delivery_fee_collection_mode', 'enum', null, null, array['paystack', 'direct_to_rider']),
    ('return_policy', 'return_policy', null, null, null),
    ('settlement_policy', 'locked', null, null, null),
    ('mock_payments_enabled', 'locked', null, null, null),
    ('rider_terms_current_version', 'locked', null, null, null)
  ) as r(key, kind, lo, hi, choices) where r.key = p_key
$function$;

update public.platform_settings set value = '90'::jsonb where key = 'location_stale_after_seconds';
insert into public.platform_settings (key, value, note) values
  ('location_send_interval_seconds', '30'::jsonb, 'How often a rider''s phone sends its position while carrying a delivery. Lower is smoother but uses more battery and data.')
on conflict (key) do nothing;
