-- AFIT Market - Batch 2 / Phase 3: vendor onboarding, stores, hours, catalogue, public read model.
-- Design choices (documented in docs/database.md):
--  * One store per vendor, so there is no separate `stores` table (the vendor row is the store).
--  * Sensitive writes only through hardened SECURITY DEFINER functions (fixed search_path, EXECUTE
--    restricted, identity + role + aal2 + vendor status checked inside).
--  * Public (anonymous) browsing is served by narrowly-scoped read functions, NOT by granting `anon`
--    any table privilege. Only the functions in the allowlist are executable by anon (asserted in tests).
--  * Money is integer kobo. Opening hours are evaluated in Africa/Lagos.
--  * Product images are deferred (no Storage yet).

create extension if not exists pg_trgm with schema extensions;

alter table public.platform_settings add column note text;

-- ---------------------------------------------------------------------------------------------
-- Categories (admin-managed)
-- ---------------------------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.categories (slug, name, sort_order) values
  ('food', 'Food', 10), ('drinks', 'Drinks', 20), ('printing', 'Printing and stationery', 30),
  ('souvenirs', 'Souvenirs', 40), ('general', 'General shop', 50);

-- ---------------------------------------------------------------------------------------------
-- Vendors (extends the Batch 1 stub) and staff
-- ---------------------------------------------------------------------------------------------
alter table public.vendors
  add column slug text,
  add column description text check (description is null or char_length(description) <= 500),
  add column category_id uuid references public.categories (id),
  add column contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9+() -]{7,20}$'),
  add column pickup_location_text text check (pickup_location_text is null or char_length(pickup_location_text) <= 200),
  add column prep_minutes int not null default 20 check (prep_minutes between 1 and 240),
  add column temporarily_closed boolean not null default false,
  add column owner_id uuid references auth.users (id) on delete set null,
  add column updated_at timestamptz not null default now();
alter table public.vendors alter column slug set not null;
alter table public.vendors add constraint vendors_slug_format check (slug ~ '^[a-z0-9-]{2,60}$');
create unique index vendors_slug_key on public.vendors (slug);
create index vendors_status_idx on public.vendors (status);
create index vendors_category_idx on public.vendors (category_id);
create index vendors_name_trgm on public.vendors using gin (lower(name) extensions.gin_trgm_ops);
create trigger vendors_touch before update on public.vendors
  for each row execute function app_private.touch_updated_at();

alter table public.vendor_staff
  add column staff_role text not null default 'staff' check (staff_role in ('owner', 'staff')),
  add column created_at timestamptz not null default now();
create unique index vendor_staff_one_owner on public.vendor_staff (vendor_id) where staff_role = 'owner';

create table public.vendor_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references auth.users (id) on delete cascade,
  business_name text not null check (char_length(business_name) between 2 and 80),
  contact_phone text not null check (contact_phone ~ '^[0-9+() -]{7,20}$'),
  category_id uuid not null references public.categories (id),
  description text not null check (char_length(description) between 10 and 500),
  pickup_location_text text not null check (char_length(pickup_location_text) between 3 and 200),
  terms_accepted_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 500),
  vendor_id uuid references public.vendors (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vendor_applications_decided check ((status = 'pending') = (decided_at is null))
);
create unique index vendor_applications_one_pending on public.vendor_applications (applicant_id) where status = 'pending';
create index vendor_applications_status_idx on public.vendor_applications (status, created_at);

create table public.store_hours (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  opens time not null,
  closes time not null,
  primary key (vendor_id, weekday, opens),
  constraint store_hours_order check (opens < closes)
);

-- ---------------------------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 300),
  section text check (section is null or char_length(section) <= 40),
  price_kobo bigint not null check (price_kobo between 1 and 100000000),
  is_available boolean not null default true,
  stock_quantity int check (stock_quantity is null or stock_quantity between 0 and 100000), -- null = unlimited
  status text not null default 'active' check (status in ('active', 'archived')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_vendor_idx on public.products (vendor_id, status);
create index products_name_trgm on public.products using gin (lower(name) extensions.gin_trgm_ops);
create trigger products_touch before update on public.products
  for each row execute function app_private.touch_updated_at();

create table public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  min_select smallint not null default 0 check (min_select between 0 and 10),
  max_select smallint not null default 1 check (max_select between 1 and 10),
  sort_order int not null default 0,
  constraint option_group_range check (min_select <= max_select)
);
create index product_option_groups_product_idx on public.product_option_groups (product_id);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_option_groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  price_delta_kobo bigint not null default 0 check (price_delta_kobo between 0 and 100000000),
  is_available boolean not null default true,
  sort_order int not null default 0
);
create index product_options_group_idx on public.product_options (group_id);

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS (reads only through the API; writes via functions)
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'vendor_applications', 'store_hours', 'products', 'product_option_groups', 'product_options'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on public.vendors, public.vendor_staff from anon;
grant select on public.vendor_applications, public.store_hours, public.products,
  public.product_option_groups, public.product_options to authenticated;
grant all on all tables in schema public to service_role;

create function app_private.is_platform_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select app_private.has_role('platform_admin') $$;
revoke all on function app_private.is_platform_admin() from public, anon;
grant execute on function app_private.is_platform_admin() to authenticated, service_role;

-- vendor_applications: applicant sees own; platform admin sees all
create policy vendor_applications_select on public.vendor_applications for select to authenticated
  using (applicant_id = (select auth.uid()) or app_private.is_platform_admin());
create policy vendor_applications_mfa on public.vendor_applications as restrictive for all to authenticated
  using (app_private.is_aal2());

-- store_hours / products / options: vendor members and platform admins
create policy store_hours_select on public.store_hours for select to authenticated
  using (app_private.is_vendor_member(vendor_id) or app_private.is_platform_admin());
create policy store_hours_mfa on public.store_hours as restrictive for all to authenticated
  using (app_private.mfa_satisfied());
create policy products_select on public.products for select to authenticated
  using (app_private.is_vendor_member(vendor_id) or app_private.is_platform_admin());
create policy products_mfa on public.products as restrictive for all to authenticated
  using (app_private.mfa_satisfied());
create policy option_groups_select on public.product_option_groups for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id
                 and (app_private.is_vendor_member(p.vendor_id) or app_private.is_platform_admin())));
create policy option_groups_mfa on public.product_option_groups as restrictive for all to authenticated
  using (app_private.mfa_satisfied());
create policy options_select on public.product_options for select to authenticated
  using (exists (select 1 from public.product_option_groups g join public.products p on p.id = g.product_id
                 where g.id = group_id and (app_private.is_vendor_member(p.vendor_id) or app_private.is_platform_admin())));
create policy options_mfa on public.product_options as restrictive for all to authenticated
  using (app_private.mfa_satisfied());

-- ---------------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------------
create function app_private.like_escape(p text) returns text
language sql immutable set search_path = ''
as $$ select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_') $$;

create function app_private.vendor_is_open(p_vendor uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select v.status = 'approved' and not v.temporarily_closed and exists (
      select 1 from public.store_hours h
      where h.vendor_id = v.id
        and h.weekday = extract(dow from (p_at at time zone 'Africa/Lagos'))::int
        and (p_at at time zone 'Africa/Lagos')::time >= h.opens
        and (p_at at time zone 'Africa/Lagos')::time < h.closes)
    from public.vendors v where v.id = p_vendor), false)
$$;

-- Caller must be an aal2 member of an APPROVED vendor (owner only when p_owner_only).
create function app_private.require_vendor_actor(p_vendor uuid, p_owner_only boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_role text; v_status text;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select vs.staff_role into v_role from public.vendor_staff vs where vs.vendor_id = p_vendor and vs.user_id = v_actor;
  if v_role is null or (p_owner_only and v_role <> 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select v.status into v_status from public.vendors v where v.id = p_vendor;
  if v_status is distinct from 'approved' then
    raise exception 'vendor is not active' using errcode = '42501';
  end if;
end $$;

create function app_private.require_platform_admin() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  return v_actor;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app_private.like_escape(text)', 'app_private.vendor_is_open(uuid, timestamptz)',
    'app_private.require_vendor_actor(uuid, boolean)', 'app_private.require_platform_admin()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Vendor application lifecycle
-- ---------------------------------------------------------------------------------------------
create function public.submit_vendor_application(
  p_business_name text, p_phone text, p_category uuid, p_description text, p_pickup text, p_accept boolean
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
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
  begin
    insert into public.vendor_applications (applicant_id, business_name, contact_phone, category_id,
      description, pickup_location_text, terms_accepted_at)
    values (v_actor, btrim(p_business_name), btrim(p_phone), p_category, btrim(p_description), btrim(p_pickup), now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'application_pending' using errcode = '23505';
  end;
  perform app_private.audit_write(v_actor, 'vendor_application.submitted', 'vendor_application', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

create function public.decide_vendor_application(p_application uuid, p_decision text, p_reason text)
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

create function public.set_vendor_status(p_vendor uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin(); v_n int;
begin
  if p_status not in ('approved', 'suspended') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.vendors set status = p_status where id = p_vendor;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'unknown vendor' using errcode = 'P0002'; end if;
  perform app_private.audit_write(v_actor, 'vendor.status_changed', 'vendor', p_vendor::text,
    jsonb_build_object('status', p_status, 'reason', btrim(p_reason)));
end $$;

create function public.category_upsert(p_category uuid, p_slug text, p_name text, p_sort int, p_active boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin(); v_id uuid;
begin
  if p_category is null then
    insert into public.categories (slug, name, sort_order, is_active)
    values (p_slug, btrim(p_name), coalesce(p_sort, 0), coalesce(p_active, true)) returning id into v_id;
  else
    update public.categories set slug = p_slug, name = btrim(p_name), sort_order = coalesce(p_sort, 0),
      is_active = coalesce(p_active, true) where id = p_category returning id into v_id;
    if v_id is null then raise exception 'unknown category' using errcode = 'P0002'; end if;
  end if;
  perform app_private.audit_write(v_actor, 'category.saved', 'category', v_id::text, jsonb_build_object('slug', p_slug));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Vendor self-service
-- ---------------------------------------------------------------------------------------------
-- The caller's vendor (first membership). Callable at aal1 so layouts can route; returns no secrets.
create function public.my_vendor() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'status', v.status, 'staff_role', vs.staff_role)
  from public.vendor_staff vs join public.vendors v on v.id = vs.vendor_id
  where vs.user_id = (select auth.uid())
  order by vs.created_at limit 1
$$;

create function public.vendor_update_profile(p_vendor uuid, p_description text, p_phone text, p_pickup text, p_prep int)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_vendor_actor(p_vendor, true);
  update public.vendors set description = btrim(p_description), contact_phone = btrim(p_phone),
    pickup_location_text = btrim(p_pickup), prep_minutes = p_prep where id = p_vendor;
  perform app_private.audit_write((select auth.uid()), 'vendor.profile_updated', 'vendor', p_vendor::text, '{}'::jsonb);
end $$;

create function public.vendor_set_temporarily_closed(p_vendor uuid, p_closed boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_vendor_actor(p_vendor, false);
  update public.vendors set temporarily_closed = coalesce(p_closed, false) where id = p_vendor;
  perform app_private.audit_write((select auth.uid()), 'vendor.closed_flag', 'vendor', p_vendor::text,
    jsonb_build_object('closed', coalesce(p_closed, false)));
end $$;

-- p_hours: [{"weekday":1,"opens":"08:00","closes":"18:00"}, ...] (no overlaps, max 28 intervals)
create function public.vendor_set_hours(p_vendor uuid, p_hours jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare e jsonb; f jsonb; v_count int; v_wd smallint; v_o time; v_c time; i int := 0; j int;
begin
  perform app_private.require_vendor_actor(p_vendor, true);
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then raise exception 'hours must be an array' using errcode = '22023'; end if;
  v_count := jsonb_array_length(p_hours);
  if v_count > 28 then raise exception 'too many intervals' using errcode = '22023'; end if;
  -- validate each interval and reject overlaps (max 28 intervals, so the quadratic check is trivial)
  for e in select * from jsonb_array_elements(p_hours) loop
    begin
      v_wd := (e->>'weekday')::smallint; v_o := (e->>'opens')::time; v_c := (e->>'closes')::time;
    exception when others then
      raise exception 'invalid interval' using errcode = '22023';
    end;
    if v_wd is null or v_o is null or v_c is null or v_wd not between 0 and 6 or v_o >= v_c then
      raise exception 'invalid interval' using errcode = '22023';
    end if;
    j := 0;
    for f in select * from jsonb_array_elements(p_hours) loop
      if j <> i and (f->>'weekday')::smallint = v_wd and (f->>'opens')::time < v_c and v_o < (f->>'closes')::time then
        raise exception 'overlapping intervals' using errcode = '22023';
      end if;
      j := j + 1;
    end loop;
    i := i + 1;
  end loop;
  delete from public.store_hours where vendor_id = p_vendor;
  insert into public.store_hours (vendor_id, weekday, opens, closes)
    select p_vendor, (x->>'weekday')::smallint, (x->>'opens')::time, (x->>'closes')::time from jsonb_array_elements(p_hours) x;
  perform app_private.audit_write((select auth.uid()), 'vendor.hours_updated', 'vendor', p_vendor::text,
    jsonb_build_object('intervals', v_count));
end $$;

create function public.vendor_add_staff(p_vendor uuid, p_email text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_user uuid;
begin
  perform app_private.require_vendor_actor(p_vendor, true);
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  -- Uniform behavior whether or not the address exists: no account-enumeration oracle.
  if v_user is null or v_user = v_actor then return; end if;
  if exists (select 1 from public.vendor_staff vs where vs.user_id = v_user) then return; end if;
  insert into public.vendor_staff (vendor_id, user_id, staff_role) values (p_vendor, v_user, 'staff');
  insert into public.role_assignments (user_id, role, granted_by) values (v_user, 'vendor_staff', v_actor)
  on conflict (user_id, role) where status = 'active' do nothing;
  perform app_private.audit_write(v_actor, 'vendor.staff_added', 'vendor', p_vendor::text, jsonb_build_object('user_id', v_user));
end $$;

create function public.vendor_remove_staff(p_vendor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_n int;
begin
  perform app_private.require_vendor_actor(p_vendor, true);
  delete from public.vendor_staff where vendor_id = p_vendor and user_id = p_user and staff_role = 'staff';
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;
  if not exists (select 1 from public.vendor_staff where user_id = p_user) then
    update public.role_assignments set status = 'revoked', revoked_at = now(), revoked_by = v_actor
     where user_id = p_user and role = 'vendor_staff' and status = 'active';
  end if;
  perform app_private.audit_write(v_actor, 'vendor.staff_removed', 'vendor', p_vendor::text, jsonb_build_object('user_id', p_user));
end $$;

-- p_options: [{"name":"Size","min":1,"max":1,"options":[{"name":"Large","price_delta_kobo":20000,"available":true}]}]
create function public.product_upsert(
  p_vendor uuid, p_product uuid, p_name text, p_description text, p_price bigint, p_section text,
  p_available boolean, p_stock int, p_options jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare g jsonb; o jsonb; v_id uuid := p_product; v_group uuid; v_gi int := 0; v_oi int; v_min int; v_max int;
begin
  perform app_private.require_vendor_actor(p_vendor, false);
  p_options := coalesce(p_options, '[]'::jsonb);
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) > 10 then
    raise exception 'invalid options' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.products (vendor_id, name, description, section, price_kobo, is_available, stock_quantity)
    values (p_vendor, btrim(p_name), nullif(btrim(p_description), ''), nullif(btrim(p_section), ''), p_price,
            coalesce(p_available, true), p_stock)
    returning id into v_id;
  else
    update public.products set name = btrim(p_name), description = nullif(btrim(p_description), ''),
      section = nullif(btrim(p_section), ''), price_kobo = p_price, is_available = coalesce(p_available, true),
      stock_quantity = p_stock
     where id = v_id and vendor_id = p_vendor and status = 'active';
    if not found then raise exception 'unknown product' using errcode = 'P0002'; end if;
    delete from public.product_option_groups where product_id = v_id;
  end if;
  for g in select * from jsonb_array_elements(p_options) loop
    v_min := coalesce((g->>'min')::int, 0); v_max := coalesce((g->>'max')::int, 1);
    if jsonb_typeof(g->'options') <> 'array' or jsonb_array_length(g->'options') not between 1 and 20 then
      raise exception 'each option group needs 1-20 options' using errcode = '22023';
    end if;
    if v_min > v_max or v_max > jsonb_array_length(g->'options') then
      raise exception 'invalid option group limits' using errcode = '22023';
    end if;
    insert into public.product_option_groups (product_id, name, min_select, max_select, sort_order)
    values (v_id, btrim(g->>'name'), v_min, v_max, v_gi) returning id into v_group;
    v_oi := 0;
    for o in select * from jsonb_array_elements(g->'options') loop
      insert into public.product_options (group_id, name, price_delta_kobo, is_available, sort_order)
      values (v_group, btrim(o->>'name'), coalesce((o->>'price_delta_kobo')::bigint, 0),
              coalesce((o->>'available')::boolean, true), v_oi);
      v_oi := v_oi + 1;
    end loop;
    v_gi := v_gi + 1;
  end loop;
  perform app_private.audit_write((select auth.uid()), case when p_product is null then 'product.created' else 'product.updated' end,
    'product', v_id::text, jsonb_build_object('vendor_id', p_vendor));
  return v_id;
end $$;

create function public.product_set_availability(p_product uuid, p_available boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_vendor uuid;
begin
  select vendor_id into v_vendor from public.products where id = p_product;
  if v_vendor is null then raise exception 'unknown product' using errcode = 'P0002'; end if;
  perform app_private.require_vendor_actor(v_vendor, false);
  update public.products set is_available = coalesce(p_available, false) where id = p_product;
end $$;

create function public.product_archive(p_product uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_vendor uuid;
begin
  select vendor_id into v_vendor from public.products where id = p_product;
  if v_vendor is null then raise exception 'unknown product' using errcode = 'P0002'; end if;
  perform app_private.require_vendor_actor(v_vendor, false);
  update public.products set status = 'archived', is_available = false where id = p_product;
  perform app_private.audit_write((select auth.uid()), 'product.archived', 'product', p_product::text,
    jsonb_build_object('vendor_id', v_vendor));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public read model (anonymous allowed). Returns only public-safe columns of APPROVED vendors and
-- ACTIVE products. No table privileges are granted to anon.
-- ---------------------------------------------------------------------------------------------
create function public.list_categories() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name) order by c.sort_order, c.name), '[]'::jsonb)
  from public.categories c where c.is_active
$$;

create function public.browse_vendors(
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
      and (p_category is null or c.slug = p_category)
      and (v_pat is null or lower(v.name) like lower(v_pat) escape '\'
           or exists (select 1 from public.products p where p.vendor_id = v.id and p.status = 'active'
                      and lower(p.name) like lower(v_pat) escape '\'))
      and (not coalesce(p_open_only, false) or app_private.vendor_is_open(v.id))
    order by app_private.vendor_is_open(v.id) desc, v.name
    limit least(greatest(coalesce(p_limit, 24), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
  ) t;
  return v_out;
end $$;

create function public.get_vendor_menu(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v public.vendors%rowtype; v_cat text; v_hours jsonb; v_products jsonb;
begin
  select * into v from public.vendors where slug = p_slug and status = 'approved';
  if not found then return null; end if;
  select c.name into v_cat from public.categories c where c.id = v.category_id;
  select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI'))
                  order by h.weekday, h.opens), '[]'::jsonb) into v_hours from public.store_hours h where h.vendor_id = v.id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'section', p.section, 'price_kobo', p.price_kobo,
      'available', p.is_available and (p.stock_quantity is null or p.stock_quantity > 0),
      'options', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
          'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name,
                        'price_delta_kobo', o.price_delta_kobo, 'available', o.is_available) order by o.sort_order, o.name), '[]'::jsonb)
                      from public.product_options o where o.group_id = g.id)) order by g.sort_order), '[]'::jsonb)
                      from public.product_option_groups g where g.product_id = p.id)
    ) order by p.section nulls last, p.sort_order, p.name), '[]'::jsonb) into v_products
  from public.products p where p.vendor_id = v.id and p.status = 'active';
  return jsonb_build_object(
    'vendor', jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'description', v.description,
       'category', v_cat, 'open_now', app_private.vendor_is_open(v.id), 'temporarily_closed', v.temporarily_closed,
       'prep_minutes', v.prep_minutes, 'pickup_location_text', v.pickup_location_text),
    'hours', v_hours, 'products', v_products);
end $$;

create function public.get_product(p_product uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_slug text; v_menu jsonb; v_p jsonb;
begin
  select v.slug into v_slug from public.products p join public.vendors v on v.id = p.vendor_id
   where p.id = p_product and p.status = 'active' and v.status = 'approved';
  if v_slug is null then return null; end if;
  v_menu := public.get_vendor_menu(v_slug);
  select e into v_p from jsonb_array_elements(v_menu->'products') e where (e->>'id')::uuid = p_product;
  return jsonb_build_object('vendor', v_menu->'vendor', 'product', v_p);
end $$;

create function public.search_products(
  p_q text, p_max_price bigint default null, p_open_only boolean default false, p_limit int default 24, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_pat text; v_out jsonb;
begin
  if p_q is null or btrim(p_q) = '' then return '[]'::jsonb; end if;
  v_pat := '%' || app_private.like_escape(left(btrim(p_q), 60)) || '%';
  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) into v_out
  from (
    select p.id, p.name, p.price_kobo, p.is_available and (p.stock_quantity is null or p.stock_quantity > 0) as available,
           v.slug as vendor_slug, v.name as vendor_name, app_private.vendor_is_open(v.id) as open_now
    from public.products p join public.vendors v on v.id = p.vendor_id
    where p.status = 'active' and v.status = 'approved' and lower(p.name) like lower(v_pat) escape '\'
      and (p_max_price is null or p.price_kobo <= p_max_price)
      and (not coalesce(p_open_only, false) or app_private.vendor_is_open(v.id))
    order by app_private.vendor_is_open(v.id) desc, p.price_kobo, p.name
    limit least(greatest(coalesce(p_limit, 24), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
  ) t;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- EXECUTE grants
-- ---------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  -- authenticated-callable (each validates identity/role/aal inside)
  foreach f in array array[
    'public.submit_vendor_application(text, text, uuid, text, text, boolean)',
    'public.decide_vendor_application(uuid, text, text)', 'public.set_vendor_status(uuid, text, text)',
    'public.category_upsert(uuid, text, text, int, boolean)', 'public.my_vendor()',
    'public.vendor_update_profile(uuid, text, text, text, int)', 'public.vendor_set_temporarily_closed(uuid, boolean)',
    'public.vendor_set_hours(uuid, jsonb)', 'public.vendor_add_staff(uuid, text)', 'public.vendor_remove_staff(uuid, uuid)',
    'public.product_upsert(uuid, uuid, text, text, bigint, text, boolean, int, jsonb)',
    'public.product_set_availability(uuid, boolean)', 'public.product_archive(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- public read model: the ONLY functions anon may execute (besides none in Batch 1). Read-only, public-safe.
  foreach f in array array[
    'public.list_categories()', 'public.browse_vendors(text, text, boolean, int, int)',
    'public.get_vendor_menu(text)', 'public.get_product(uuid)', 'public.search_products(text, bigint, boolean, int, int)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
