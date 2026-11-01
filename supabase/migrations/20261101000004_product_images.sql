-- Vendors can add a photo to each product. The photo is shrunk to a small JPEG in the vendor's browser and kept here, so
-- no separate file storage service is needed. The table is service-role only: the public image route reads it for ACTIVE
-- products of APPROVED shops, and vendors write it only through the two functions below.

create table public.product_images (
  product_id uuid primary key references public.products (id) on delete cascade,
  jpeg bytea not null check (octet_length(jpeg) between 500 and 400000),
  updated_at timestamptz not null default now()
);
alter table public.product_images enable row level security;
revoke all on public.product_images from public, anon, authenticated;
grant all on public.product_images to service_role;

create function public.vendor_set_product_image(p_product uuid, p_jpeg bytea) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_vendor uuid; v_actor uuid := (select auth.uid());
begin
  select vendor_id into v_vendor from public.products where id = p_product;
  if v_vendor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.require_vendor_actor(v_vendor);
  if p_jpeg is null or octet_length(p_jpeg) not between 500 and 400000
     or get_byte(p_jpeg, 0) <> 255 or get_byte(p_jpeg, 1) <> 216 or get_byte(p_jpeg, 2) <> 255 then
    raise exception 'invalid_image' using errcode = '22023';
  end if;
  insert into public.product_images (product_id, jpeg) values (p_product, p_jpeg)
    on conflict (product_id) do update set jpeg = excluded.jpeg, updated_at = now();
  perform app_private.audit_write(v_actor, 'product.image_set', 'product', p_product::text, '{}'::jsonb);
end $$;
revoke all on function public.vendor_set_product_image(uuid, bytea) from public, anon;
grant execute on function public.vendor_set_product_image(uuid, bytea) to authenticated;

create function public.vendor_remove_product_image(p_product uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_vendor uuid; v_actor uuid := (select auth.uid());
begin
  select vendor_id into v_vendor from public.products where id = p_product;
  if v_vendor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.require_vendor_actor(v_vendor);
  delete from public.product_images where product_id = p_product;
  perform app_private.audit_write(v_actor, 'product.image_removed', 'product', p_product::text, '{}'::jsonb);
end $$;
revoke all on function public.vendor_remove_product_image(uuid) from public, anon;
grant execute on function public.vendor_remove_product_image(uuid) to authenticated;
