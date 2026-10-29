-- Public browsing with sorting and category filters, and the public "Contact us" inbox. ADDITIVE ONLY.

-- Product browsing: filter by vendor category, search text, max price and open-now; sort by price, name or newest.
-- Only active products of approved vendors are ever returned. `category_slug` is the vendor's category (products have none of their own).
create function public.browse_products(
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
      and (p_category is null or c.slug = p_category)
      and (p_max_price is null or p.price_kobo <= p_max_price)
      and (not coalesce(p_open_only, false) or app_private.vendor_is_open(v.id))
  ) t
  where t.ord > greatest(coalesce(p_offset, 0), 0)
    and t.ord <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 24), 1), 50);
  return v_out;
end $$;
revoke all on function public.browse_products(text, text, boolean, bigint, text, int, int) from public;
grant execute on function public.browse_products(text, text, boolean, bigint, text, int, int) to anon, authenticated, service_role;

-- Public contact messages. Written only through the service role (the server action validates and rate limits);
-- read and triaged only by platform administrators and support agents through the functions below.
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) between 5 and 254),
  subject text not null check (char_length(subject) between 3 and 100),
  message text not null check (char_length(message) between 10 and 2000),
  status text not null default 'new' check (status in ('new', 'read', 'closed')),
  created_at timestamptz not null default now(),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz
);
create index contact_messages_status_idx on public.contact_messages (status, created_at desc);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from public, anon, authenticated;
grant all on public.contact_messages to service_role;

create function public.staff_list_contact_messages(p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]);
begin
  if p_status is not null and p_status not in ('new', 'read', 'closed') then raise exception 'invalid status' using errcode = '22023'; end if;
  return (select jsonb_build_object(
      'total', (select count(*) from public.contact_messages m where p_status is null or m.status = p_status),
      'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
          select m.id, m.name, m.email, m.subject, m.message, m.status, m.created_at, m.handled_at
          from public.contact_messages m where p_status is null or m.status = p_status
          order by m.created_at desc
          limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb)));
end $$;

create function public.staff_set_contact_message_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]);
begin
  if p_status not in ('read', 'closed') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.contact_messages set status = p_status, handled_by = v_actor, handled_at = now() where id = p_id;
  if not found then raise exception 'unknown message' using errcode = 'P0002'; end if;
  perform app_private.audit_write(v_actor, 'contact.status_changed', 'contact_message', p_id::text, jsonb_build_object('status', p_status));
end $$;

revoke all on function public.staff_list_contact_messages(text, int, int), public.staff_set_contact_message_status(uuid, text) from public, anon;
grant execute on function public.staff_list_contact_messages(text, int, int), public.staff_set_contact_message_status(uuid, text) to authenticated, service_role;
