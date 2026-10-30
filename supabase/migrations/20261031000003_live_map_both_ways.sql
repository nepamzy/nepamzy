-- Live map in both directions. While a delivery is active the customer may choose to share where they are with their
-- rider, and the rider's job map shows the rider, the delivery point and (if shared) the customer. Everything stops
-- when the assignment ends. Location is sensitive: no direct table access, scoped functions only, same as the rider's.

create table public.customer_location_current (
  order_id uuid primary key references public.orders (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision not null check (accuracy_m >= 0),
  observed_at timestamptz not null default now()
);
alter table public.customer_location_current enable row level security;
revoke all on public.customer_location_current from public, anon, authenticated;
grant all on public.customer_location_current to service_role;
create policy customer_location_current_aal2 on public.customer_location_current as restrictive for all to authenticated using (app_private.is_aal2());

-- The customer shares a position for ONE of their own orders, only while a rider is on the delivery.
create function public.customer_post_location(p_order uuid, p_lat double precision, p_lng double precision, p_accuracy double precision)
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
  if p_accuracy > 500 then return jsonb_build_object('accepted', false, 'reason', 'inaccurate'); end if;
  if not exists (select 1 from public.delivery_assignments where order_id = p_order and status in ('accepted', 'picked_up', 'en_route')) then
    delete from public.customer_location_current where order_id = p_order;
    return jsonb_build_object('accepted', false, 'reason', 'no_active_delivery');
  end if;
  insert into public.customer_location_current (order_id, customer_id, lat, lng, accuracy_m, observed_at)
    values (p_order, v_actor, p_lat, p_lng, p_accuracy, now())
  on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, observed_at = now();
  return jsonb_build_object('accepted', true);
end $$;

create function public.customer_stop_location(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if p_order is null then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.customer_location_current where order_id = p_order and customer_id = v_actor;
end $$;

-- What the rider sees on one of their own active deliveries: themselves, the delivery point, and the customer if shared.
create function public.rider_job_map(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider(); v_a public.delivery_assignments%rowtype; v_o public.orders%rowtype;
        v_r public.rider_location_current%rowtype; v_c public.customer_location_current%rowtype;
        v_stale int := app_private.setting_int('location_stale_after_seconds', 45)::int;
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
        'age_seconds', round(extract(epoch from (now() - v_c.observed_at))),
        'stale', extract(epoch from (now() - v_c.observed_at)) > v_stale) end);
end $$;

-- Sharing ends with the delivery: nothing of the customer's position outlives the assignment.
create function app_private.clear_customer_location() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status not in ('accepted', 'picked_up', 'en_route') then
    delete from public.customer_location_current where order_id = new.order_id;
  end if;
  return new;
end $$;
create trigger delivery_assignments_clear_customer_location
  after update of status on public.delivery_assignments
  for each row execute function app_private.clear_customer_location();

revoke all on function app_private.clear_customer_location() from public, anon, authenticated;
revoke all on function public.customer_post_location(uuid, double precision, double precision, double precision) from public, anon;
revoke all on function public.customer_stop_location(uuid) from public, anon;
revoke all on function public.rider_job_map(uuid) from public, anon;
grant execute on function public.customer_post_location(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.customer_stop_location(uuid) to authenticated;
grant execute on function public.rider_job_map(uuid) to authenticated;

-- Account erasure also removes shared positions (cascade covers customers; nothing else holds them).
