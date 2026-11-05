-- A rider can tap "I have arrived" instead of waiting for the GPS to notice. This does exactly what the automatic detection does
-- (the delivery moves to ARRIVAL_DETECTED so the hand-over can begin), and records HOW it was marked so staff can see it.
-- It proves nothing about where the rider is: the hand-over still needs the customer's signature (compared with the one they saved)
-- or the customer scanning the rider's QR code on their own phone.

alter table public.delivery_assignments
  add column arrival_source text check (arrival_source is null or arrival_source in ('gps', 'rider_tap'));

-- what already happened was always GPS
update public.delivery_assignments set arrival_source = 'gps' where arrival_detected_at is not null and arrival_source is null;

create function public.rider_tap_arrived(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_rider uuid := app_private.require_rider(); v_a public.delivery_assignments%rowtype;
begin
  select * into v_a from public.delivery_assignments where id = p_assignment for update;
  if not found or v_a.rider_id <> v_rider then raise exception 'forbidden' using errcode = '42501'; end if;
  -- already arrived (by GPS or an earlier tap): nothing to do, and nothing is overwritten
  if v_a.status = 'en_route' and v_a.arrival_detected_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_a.status <> 'en_route' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  update public.delivery_assignments set arrival_detected_at = now(), arrival_source = 'rider_tap' where id = v_a.id;
  perform app_private.step_order(v_a.order_id, 'EN_ROUTE', 'ARRIVAL_DETECTED', v_rider, 'arrival_tapped_by_rider');
  perform app_private.audit_write(v_rider, 'delivery.arrival_tapped', 'order', v_a.order_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'already', false);
end $$;
revoke all on function public.rider_tap_arrived(uuid) from public, anon;
grant execute on function public.rider_tap_arrived(uuid) to authenticated, service_role;
