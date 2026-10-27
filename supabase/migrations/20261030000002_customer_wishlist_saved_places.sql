-- Customer conveniences: a wishlist of items and saved delivery places. ADDITIVE ONLY.
-- Both are reachable only through the functions below (direct table access is closed), and only by the signed-in customer.
-- A "saved place" is a label for one of the administrator-approved delivery points: delivery never goes to a free-text address.

create table public.wishlist_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 2 and 40),
  delivery_point_id uuid not null references public.approved_delivery_points (id) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index saved_places_user_idx on public.saved_places (user_id);
create unique index saved_places_one_default on public.saved_places (user_id) where is_default;
alter table public.wishlist_items enable row level security;
alter table public.saved_places enable row level security;
revoke all on public.wishlist_items, public.saved_places from public, anon, authenticated;
grant all on public.wishlist_items, public.saved_places to service_role;


-- Adds the item if it is not on the list, removes it if it is. Returns true when it is now saved. At most 100 items.
create function public.wishlist_toggle(p_product uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer();
begin
  if exists (select 1 from public.wishlist_items where user_id = v_actor and product_id = p_product) then
    delete from public.wishlist_items where user_id = v_actor and product_id = p_product;
    return false;
  end if;
  if not exists (select 1 from public.products p join public.vendors v on v.id = p.vendor_id
                 where p.id = p_product and p.status = 'active' and v.status = 'approved') then
    raise exception 'unknown product' using errcode = 'P0002';
  end if;
  if (select count(*) from public.wishlist_items where user_id = v_actor) >= 100 then
    raise exception 'wishlist_full' using errcode = '22023';
  end if;
  insert into public.wishlist_items (user_id, product_id) values (v_actor, p_product);
  return true;
end $$;

create function public.wishlist_contains(p_product uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer();
begin
  return exists (select 1 from public.wishlist_items where user_id = v_actor and product_id = p_product);
end $$;

create function public.wishlist_list() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price_kobo', p.price_kobo,
            'available', p.is_available and (p.stock_quantity is null or p.stock_quantity > 0),
            'vendor_slug', v.slug, 'vendor_name', v.name, 'open_now', app_private.vendor_is_open(v.id)) order by w.created_at desc), '[]'::jsonb)
          from public.wishlist_items w join public.products p on p.id = w.product_id join public.vendors v on v.id = p.vendor_id
          where w.user_id = v_actor and p.status = 'active' and v.status = 'approved');
end $$;

create function public.saved_places_list() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'delivery_point_id', d.id,
            'delivery_point', d.label, 'is_default', s.is_default, 'point_active', d.is_active) order by s.is_default desc, s.created_at), '[]'::jsonb)
          from public.saved_places s join public.approved_delivery_points d on d.id = s.delivery_point_id where s.user_id = v_actor);
end $$;

-- Creates (p_id null) or updates a saved place. At most five per person; making one the default clears the previous default.
create function public.saved_place_save(p_id uuid, p_label text, p_point uuid, p_default boolean) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer(); v_id uuid := p_id;
begin
  if p_label is null or char_length(btrim(p_label)) not between 2 and 40 then raise exception 'invalid label' using errcode = '22023'; end if;
  if not exists (select 1 from public.approved_delivery_points where id = p_point and is_active) then
    raise exception 'unknown delivery point' using errcode = '22023';
  end if;
  if p_id is null then
    if (select count(*) from public.saved_places where user_id = v_actor) >= 5 then raise exception 'too_many_places' using errcode = '22023'; end if;
  elsif not exists (select 1 from public.saved_places where id = p_id and user_id = v_actor) then
    raise exception 'unknown place' using errcode = 'P0002';
  end if;
  if coalesce(p_default, false) then update public.saved_places set is_default = false where user_id = v_actor and is_default; end if;
  if p_id is null then
    insert into public.saved_places (user_id, label, delivery_point_id, is_default)
      values (v_actor, btrim(p_label), p_point, coalesce(p_default, false)) returning id into v_id;
  else
    update public.saved_places set label = btrim(p_label), delivery_point_id = p_point, is_default = coalesce(p_default, false)
      where id = p_id and user_id = v_actor;
  end if;
  return v_id;
end $$;

create function public.saved_place_delete(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer();
begin
  delete from public.saved_places where id = p_id and user_id = v_actor;
  if not found then raise exception 'unknown place' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.wishlist_toggle(uuid), public.wishlist_contains(uuid), public.wishlist_list(), public.saved_places_list(),
  public.saved_place_save(uuid, text, uuid, boolean), public.saved_place_delete(uuid) from public, anon;
grant execute on function public.wishlist_toggle(uuid), public.wishlist_contains(uuid), public.wishlist_list(), public.saved_places_list(),
  public.saved_place_save(uuid, text, uuid, boolean), public.saved_place_delete(uuid) to authenticated, service_role;

-- Account erasure must also remove what this and the delivery migrations added: wishlist, saved places, pop-up devices, reset codes,
-- and the e-mail address / name on contact messages. The function text is patched in place so the rest of its behaviour is untouched.
do $$
declare v_def text; v_marker text := 'delete from public.notification_preferences where user_id = p_user;';
begin
  v_def := pg_get_functiondef('public.admin_erase_account(uuid, text, uuid)'::regprocedure);
  if position(v_marker in v_def) = 0 then raise exception 'erasure function layout changed; update this migration'; end if;
  v_def := replace(v_def, v_marker, v_marker || '
  delete from public.wishlist_items where user_id = p_user;
  delete from public.saved_places where user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
  delete from public.password_reset_codes where user_id = p_user;
  update public.contact_messages set name = ''Erased'', email = ''erased@example.invalid'', message = ''Erased'', user_id = null where user_id = p_user;');
  execute v_def;
end $$;
