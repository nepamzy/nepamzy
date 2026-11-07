-- A shop can sell in more than one category, can say "something else" in its own words, and says who it is when it applies
-- (an AFIT student, a shop AFIT already knows on campus, or someone else). ADDITIVE; the single category stays as the MAIN one.

-- ---------------------------------------------------------------------------------------------
-- 1. Categories of a shop (the first one is also kept on the shop itself as its main category)
-- ---------------------------------------------------------------------------------------------
create table public.vendor_categories (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (vendor_id, category_id)
);
create index vendor_categories_category_idx on public.vendor_categories (category_id);
alter table public.vendor_categories enable row level security;
revoke all on public.vendor_categories from public, anon, authenticated;
grant all on public.vendor_categories to service_role;
insert into public.vendor_categories (vendor_id, category_id)
  select id, category_id from public.vendors where category_id is not null on conflict do nothing;

-- the main category is always one of the shop's categories, however the shop row was written
create function app_private.sync_main_category() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.category_id is not null then
    insert into public.vendor_categories (vendor_id, category_id) values (new.id, new.category_id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function app_private.sync_main_category() from public, anon, authenticated;

alter table public.vendors add column other_category text check (other_category is null or char_length(other_category) between 3 and 60);
create trigger vendors_sync_main_category after insert or update of category_id on public.vendors
  for each row execute function app_private.sync_main_category();

alter table public.vendor_applications
  add column extra_category_ids uuid[] not null default '{}' check (cardinality(extra_category_ids) <= 8),
  add column other_category text check (other_category is null or char_length(other_category) between 3 and 60),
  add column vendor_type text check (vendor_type is null or vendor_type in ('student', 'afit_shop', 'other')),
  add column shop_place text check (shop_place is null or char_length(shop_place) between 3 and 120);

-- ---------------------------------------------------------------------------------------------
-- 2. Applying: the same call as before, with optional extras (old callers keep working)
-- ---------------------------------------------------------------------------------------------
drop function public.submit_vendor_application(text, text, uuid, text, text, boolean);
create function public.submit_vendor_application(
  p_business_name text, p_phone text, p_category uuid, p_description text, p_pickup text, p_accept boolean,
  p_extra_categories uuid[] default '{}', p_other_category text default null, p_vendor_type text default null, p_shop_place text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid; v_extra uuid[];
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('customer') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_accept is distinct from true then raise exception 'terms_not_accepted' using errcode = '22023'; end if;
  if exists (select 1 from public.vendor_staff vs where vs.user_id = v_actor) then
    raise exception 'already_a_vendor' using errcode = '23505';
  end if;
  if not exists (select 1 from public.categories c where c.id = p_category and c.is_active) then
    raise exception 'unknown_category' using errcode = '22023';
  end if;
  v_extra := coalesce((select array_agg(distinct c.id) from public.categories c
                        where c.id = any (coalesce(p_extra_categories, '{}')) and c.is_active and c.id <> p_category), '{}');
  if cardinality(coalesce(p_extra_categories, '{}')) > 8 then raise exception 'too_many_categories' using errcode = '22023'; end if;
  if p_vendor_type is not null and p_vendor_type not in ('student', 'afit_shop', 'other') then
    raise exception 'invalid_vendor_type' using errcode = '22023';
  end if;
  if p_vendor_type = 'afit_shop' and char_length(btrim(coalesce(p_shop_place, ''))) < 3 then
    raise exception 'shop_place_required' using errcode = '22023';
  end if;
  begin
    insert into public.vendor_applications (applicant_id, business_name, contact_phone, category_id, description, pickup_location_text,
                                            terms_accepted_at, extra_category_ids, other_category, vendor_type, shop_place)
    values (v_actor, btrim(p_business_name), btrim(p_phone), p_category, btrim(p_description), btrim(p_pickup), now(),
            v_extra, nullif(btrim(coalesce(p_other_category, '')), ''), p_vendor_type, nullif(btrim(coalesce(p_shop_place, '')), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'application_pending' using errcode = '23505';
  end;
  perform app_private.audit_write(v_actor, 'vendor_application.submitted', 'vendor_application', v_id::text,
    jsonb_build_object('vendor_type', p_vendor_type, 'categories', 1 + cardinality(v_extra)));
  return v_id;
end $$;
revoke all on function public.submit_vendor_application(text, text, uuid, text, text, boolean, uuid[], text, text, text) from public, anon;
grant execute on function public.submit_vendor_application(text, text, uuid, text, text, boolean, uuid[], text, text, text) to authenticated, service_role;

-- Approving also records every category the shop chose.
create or replace function public.decide_vendor_application(p_application uuid, p_decision text, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_platform_admin();
  v_app public.vendor_applications%rowtype;
  v_slug text; v_base text; v_vendor uuid; v_try int := 0;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'reason too long' using errcode = '22023'; end if;
  select * into v_app from public.vendor_applications where id = p_application for update;
  if not found then raise exception 'unknown application' using errcode = 'P0002'; end if;
  if v_app.status <> 'pending' then raise exception 'already decided' using errcode = '23505'; end if;
  if v_app.applicant_id = v_actor then raise exception 'cannot decide your own application' using errcode = '42501'; end if;

  if p_decision = 'reject' then
    if p_reason is null or char_length(btrim(p_reason)) < 5 then
      raise exception 'a reason is required' using errcode = '22023';
    end if;
    update public.vendor_applications
       set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_reason = btrim(p_reason)
     where id = p_application;
    perform app_private.audit_write(v_actor, 'vendor_application.rejected', 'vendor_application', p_application::text,
      jsonb_build_object('reason', btrim(p_reason)));
    return null;
  end if;

  v_base := trim(both '-' from lower(regexp_replace(v_app.business_name, '[^a-zA-Z0-9]+', '-', 'g')));
  if v_base = '' then v_base := 'vendor'; end if;
  v_base := left(v_base, 50);
  loop
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    exit when not exists (select 1 from public.vendors where slug = v_slug);
    v_try := v_try + 1;
    if v_try > 10 then raise exception 'could not allocate slug'; end if;
  end loop;
  insert into public.vendors (name, slug, status, description, category_id, contact_phone, pickup_location_text, owner_id)
  values (v_app.business_name, v_slug, 'approved', v_app.description, v_app.category_id, v_app.contact_phone,
          v_app.pickup_location_text, v_app.applicant_id)
  returning id into v_vendor;
  update public.vendors set other_category = v_app.other_category where id = v_vendor;
  insert into public.vendor_categories (vendor_id, category_id)
    select v_vendor, x from unnest(array[v_app.category_id] || v_app.extra_category_ids) as x on conflict do nothing;
  insert into public.vendor_staff (vendor_id, user_id, staff_role) values (v_vendor, v_app.applicant_id, 'owner');
  insert into public.role_assignments (user_id, role, granted_by) values (v_app.applicant_id, 'vendor_owner', v_actor)
  on conflict (user_id, role) where status = 'active' do nothing;
  update public.vendor_applications
     set status = 'approved', decided_by = v_actor, decided_at = now(), decision_reason = nullif(btrim(p_reason), ''),
         vendor_id = v_vendor
   where id = p_application;
  perform app_private.audit_write(v_actor, 'vendor_application.approved', 'vendor_application', p_application::text,
    jsonb_build_object('vendor_id', v_vendor));
  return v_vendor;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. A shop owner can change what the shop sells later
-- ---------------------------------------------------------------------------------------------
create function public.vendor_set_categories(p_vendor uuid, p_main uuid, p_extra uuid[], p_other text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_ids uuid[];
begin
  perform app_private.require_vendor_actor(p_vendor, true);
  if not exists (select 1 from public.categories c where c.id = p_main and c.is_active) then
    raise exception 'unknown_category' using errcode = '22023';
  end if;
  v_ids := array[p_main] || coalesce((select array_agg(distinct c.id) from public.categories c
                                        where c.id = any (coalesce(p_extra, '{}')) and c.is_active and c.id <> p_main), '{}');
  if cardinality(v_ids) > 9 then raise exception 'too_many_categories' using errcode = '22023'; end if;
  update public.vendors set category_id = p_main, other_category = nullif(btrim(coalesce(p_other, '')), ''), updated_at = now() where id = p_vendor;
  delete from public.vendor_categories where vendor_id = p_vendor and category_id <> all (v_ids);
  insert into public.vendor_categories (vendor_id, category_id) select p_vendor, x from unnest(v_ids) as x on conflict do nothing;
  perform app_private.audit_write((select auth.uid()), 'vendor.categories_changed', 'vendor', p_vendor::text, jsonb_build_object('categories', cardinality(v_ids)));
end $$;
revoke all on function public.vendor_set_categories(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.vendor_set_categories(uuid, uuid, uuid[], text) to authenticated, service_role;

-- What the shop owner's pages need to know about the shop's categories.
create or replace function public.my_vendor() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'status', v.status, 'staff_role', vs.staff_role,
                            'category_slug', (select c.slug from public.categories c where c.id = v.category_id),
                            'category_slugs', (select coalesce(jsonb_agg(c.slug order by c.sort_order, c.name), '[]'::jsonb)
                                                 from public.vendor_categories vc join public.categories c on c.id = vc.category_id where vc.vendor_id = v.id),
                            'category_ids', (select coalesce(jsonb_agg(vc.category_id), '[]'::jsonb) from public.vendor_categories vc where vc.vendor_id = v.id),
                            'other_category', v.other_category)
  from public.vendor_staff vs join public.vendors v on v.id = vs.vendor_id
  where vs.user_id = (select auth.uid())
  order by vs.created_at limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Browsing: a shop shows up under ANY of its categories
-- ---------------------------------------------------------------------------------------------
create or replace function public.browse_vendors(
  p_q text default null, p_category text default null, p_open_only boolean default false,
  p_limit int default 24, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_pat text; v_out jsonb;
begin
  v_pat := case when p_q is null or btrim(p_q) = '' then null else '%' || app_private.like_escape(left(btrim(p_q), 60)) || '%' end;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.open_now desc, t.name), '[]'::jsonb) into v_out
  from (
    select v.id, v.slug, v.name, v.description, c.slug as category_slug, c.name as category_name,
           v.prep_minutes, v.temporarily_closed, app_private.vendor_is_open(v.id) as open_now
    from public.vendors v left join public.categories c on c.id = v.category_id
    where v.status = 'approved'
      and (p_category is null or exists (select 1 from public.vendor_categories vc join public.categories cc on cc.id = vc.category_id where vc.vendor_id = v.id and cc.slug = p_category))
      and (v_pat is null or lower(v.name) like lower(v_pat) escape '\'
           or exists (select 1 from public.products p where p.vendor_id = v.id and p.status = 'active'
                      and lower(p.name) like lower(v_pat) escape '\'))
      and (not coalesce(p_open_only, false) or app_private.vendor_is_open(v.id))
    order by app_private.vendor_is_open(v.id) desc, v.name
    limit least(greatest(coalesce(p_limit, 24), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
  ) t;
  return v_out;
end $$;

create or replace function public.browse_products(
  p_q text default null, p_category text default null, p_open_only boolean default false, p_max_price bigint default null,
  p_sort text default 'recommended', p_limit int default 24, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_pat text; v_sort text := coalesce(p_sort, 'recommended'); v_out jsonb;
begin
  if v_sort not in ('recommended', 'price_asc', 'price_desc', 'name', 'newest') then v_sort := 'recommended'; end if;
  v_pat := case when p_q is null or btrim(p_q) = '' then null else '%' || app_private.like_escape(left(btrim(p_q), 60)) || '%' end;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.ord), '[]'::jsonb) into v_out
  from (
    select p.id, p.name, p.price_kobo, p.is_available and (p.stock_quantity is null or p.stock_quantity > 0) as available,
           v.slug as vendor_slug, v.name as vendor_name, c.slug as category_slug, c.name as category_name,
           app_private.vendor_is_open(v.id) as open_now,
           row_number() over (order by
             case when v_sort = 'recommended' then (not app_private.vendor_is_open(v.id))::int end,
             case when v_sort = 'price_asc' then p.price_kobo end,
             case when v_sort = 'price_desc' then p.price_kobo end desc,
             case when v_sort = 'newest' then p.created_at end desc,
             lower(p.name), p.id) as ord
    from public.products p
    join public.vendors v on v.id = p.vendor_id
    left join public.categories c on c.id = v.category_id
    where p.status = 'active' and v.status = 'approved'
      and (v_pat is null or lower(p.name) like lower(v_pat) escape '\')
      and (p_category is null or exists (select 1 from public.vendor_categories vc join public.categories cc on cc.id = vc.category_id where vc.vendor_id = v.id and cc.slug = p_category))
      and (p_max_price is null or p.price_kobo <= p_max_price)
      and (not coalesce(p_open_only, false) or app_private.vendor_is_open(v.id))
  ) t
  where t.ord > greatest(coalesce(p_offset, 0), 0)
    and t.ord <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 24), 1), 50);
  return v_out;
end $$;
