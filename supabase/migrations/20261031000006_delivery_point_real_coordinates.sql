-- An administrator can put a delivery point on the real map: exact coordinates, the arrival radius, and whether it is a
-- real, approved place (then the app stops calling it a placeholder). Replaces the 4-argument version.
drop function if exists public.delivery_point_set_geo(uuid, double precision, double precision, int);

create function public.delivery_point_set_geo(p_id uuid, p_lat double precision, p_lng double precision, p_radius int, p_real boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin();
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_lat = 'NaN' or p_lng = 'NaN' then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;
  if p_radius is null or p_radius not between 10 and 500 then
    raise exception 'invalid_radius' using errcode = '22023';
  end if;
  update public.approved_delivery_points
     set lat = p_lat, lng = p_lng, geofence_radius_m = p_radius, is_synthetic = not coalesce(p_real, false)
   where id = p_id;
  if not found then raise exception 'unknown delivery point' using errcode = 'P0002'; end if;
  perform app_private.audit_write(v_actor, 'delivery_point.geo_set', 'delivery_point', p_id::text,
    jsonb_build_object('radius_m', p_radius, 'real_place', coalesce(p_real, false)));
end $$;

revoke all on function public.delivery_point_set_geo(uuid, double precision, double precision, int, boolean) from public, anon;
grant execute on function public.delivery_point_set_geo(uuid, double precision, double precision, int, boolean) to authenticated;
