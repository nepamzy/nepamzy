-- "Add from the list": a shop picks ready-made items for its category and may set the price later.
-- Items still waiting for a price are only remembered here (a product needs a real price, so nothing half-made is shown to customers).
-- ADDITIVE ONLY: one new table, three new functions, and my_vendor() now also returns the shop's category slug.

create table public.vendor_catalogue_picks (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  created_at timestamptz not null default now(),
  primary key (vendor_id, slug)
);
alter table public.vendor_catalogue_picks enable row level security;
revoke all on public.vendor_catalogue_picks from public, anon, authenticated;
grant all on public.vendor_catalogue_picks to service_role;

create function public.vendor_picks_list(p_vendor uuid) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_vendor_actor(p_vendor, false);
  return coalesce((select array_agg(slug order by created_at, slug) from public.vendor_catalogue_picks where vendor_id = p_vendor), '{}');
end $$;
revoke all on function public.vendor_picks_list(uuid) from public, anon;
grant execute on function public.vendor_picks_list(uuid) to authenticated;

create function public.vendor_picks_add(p_vendor uuid, p_slugs text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare s text;
begin
  perform app_private.require_vendor_actor(p_vendor, false);
  if p_slugs is null or cardinality(p_slugs) > 60 then raise exception 'invalid picks' using errcode = '22023'; end if;
  foreach s in array p_slugs loop
    insert into public.vendor_catalogue_picks (vendor_id, slug) values (p_vendor, s) on conflict do nothing;
  end loop;
end $$;
revoke all on function public.vendor_picks_add(uuid, text[]) from public, anon;
grant execute on function public.vendor_picks_add(uuid, text[]) to authenticated;

create function public.vendor_picks_remove(p_vendor uuid, p_slug text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_vendor_actor(p_vendor, false);
  delete from public.vendor_catalogue_picks where vendor_id = p_vendor and slug = p_slug;
end $$;
revoke all on function public.vendor_picks_remove(uuid, text) from public, anon;
grant execute on function public.vendor_picks_remove(uuid, text) to authenticated;

create or replace function public.my_vendor() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'status', v.status, 'staff_role', vs.staff_role,
                            'category_slug', (select c.slug from public.categories c where c.id = v.category_id))
  from public.vendor_staff vs join public.vendors v on v.id = vs.vendor_id
  where vs.user_id = (select auth.uid())
  order by vs.created_at limit 1
$$;
