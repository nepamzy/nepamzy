-- Administration: dashboard metrics, user directory with suspension, catalogue moderation, and reports.
-- Every function checks the caller's staff role and the second step inside; sensitive changes are audited with a reason.

-- ---- catalogue moderation: a fourth product status the VENDOR cannot change ---------------------------------------------------
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status in ('active', 'archived', 'hidden'));

create or replace function public.product_set_availability(p_product uuid, p_available boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_vendor uuid; v_status text;
begin
  select vendor_id, status into v_vendor, v_status from public.products where id = p_product;
  if v_vendor is null then raise exception 'unknown product' using errcode = 'P0002'; end if;
  perform app_private.require_vendor_actor(v_vendor, false);
  if v_status = 'hidden' then raise exception 'product_hidden' using errcode = '42501'; end if;
  update public.products set is_available = coalesce(p_available, false) where id = p_product;
end $$;

create or replace function public.product_archive(p_product uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_vendor uuid; v_status text;
begin
  select vendor_id, status into v_vendor, v_status from public.products where id = p_product;
  if v_vendor is null then raise exception 'unknown product' using errcode = 'P0002'; end if;
  perform app_private.require_vendor_actor(v_vendor, false);
  if v_status = 'hidden' then raise exception 'product_hidden' using errcode = '42501'; end if;
  update public.products set status = 'archived', is_available = false where id = p_product;
  perform app_private.audit_write((select auth.uid()), 'product.archived', 'product', p_product::text,
    jsonb_build_object('vendor_id', v_vendor));
end $$;

create function public.admin_list_products(p_q text default null, p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_pat text;
begin
  perform app_private.require_staff(array['platform_admin', 'support_agent']::public.app_role[]);
  if p_status is not null and p_status not in ('active', 'archived', 'hidden') then raise exception 'invalid status' using errcode = '22023'; end if;
  v_pat := case when p_q is null or btrim(p_q) = '' then null else '%' || app_private.like_escape(left(btrim(p_q), 60)) || '%' end;
  return jsonb_build_object(
    'total', (select count(*) from public.products p join public.vendors v on v.id = p.vendor_id
               where (p_status is null or p.status = p_status) and (v_pat is null or lower(p.name) like lower(v_pat) escape '\' or lower(v.name) like lower(v_pat) escape '\')),
    'rows', coalesce((select jsonb_agg(to_jsonb(r)) from (
        select p.id, p.name, p.price_kobo, p.status, p.is_available, p.stock_quantity, p.created_at, v.name as vendor_name, v.slug as vendor_slug
        from public.products p join public.vendors v on v.id = p.vendor_id
        where (p_status is null or p.status = p_status) and (v_pat is null or lower(p.name) like lower(v_pat) escape '\' or lower(v.name) like lower(v_pat) escape '\')
        order by p.created_at desc
        limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb));
end $$;

-- Hides a product from every public page and cart (reason recorded), or shows it again. Archived products are the vendor's decision and are not touched.
create function public.admin_set_product_visibility(p_product uuid, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['platform_admin']::public.app_role[]); v_status text;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 300 then raise exception 'a reason of 5 to 300 characters is required' using errcode = '22023'; end if;
  select status into v_status from public.products where id = p_product for update;
  if v_status is null then raise exception 'unknown product' using errcode = 'P0002'; end if;
  if coalesce(p_hidden, false) then
    if v_status <> 'active' then raise exception 'product_not_active' using errcode = '22023'; end if;
    update public.products set status = 'hidden' where id = p_product;
  else
    if v_status <> 'hidden' then raise exception 'product_not_hidden' using errcode = '22023'; end if;
    update public.products set status = 'active' where id = p_product;
  end if;
  perform app_private.audit_write(v_actor, case when coalesce(p_hidden, false) then 'product.hidden_by_admin' else 'product.shown_by_admin' end,
    'product', p_product::text, jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- ---- user directory --------------------------------------------------------------------------------------------------------------
create function public.admin_list_users(p_q text default null, p_role text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_pat text;
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  v_pat := case when p_q is null or btrim(p_q) = '' then null else '%' || app_private.like_escape(left(btrim(p_q), 80)) || '%' end;
  return jsonb_build_object(
    'total', (select count(*) from auth.users u left join public.profiles pr on pr.id = u.id
               where (v_pat is null or lower(u.email) like lower(v_pat) escape '\' or lower(coalesce(pr.display_name, '')) like lower(v_pat) escape '\')
                 and (p_role is null or exists (select 1 from public.role_assignments ra where ra.user_id = u.id and ra.status = 'active' and ra.role::text = p_role))),
    'rows', coalesce((select jsonb_agg(to_jsonb(r)) from (
        select u.id, u.email, pr.display_name, u.created_at, u.last_sign_in_at,
               (u.banned_until is not null and u.banned_until > now()) as suspended,
               coalesce((select jsonb_agg(ra.role::text order by ra.role::text) from public.role_assignments ra where ra.user_id = u.id and ra.status = 'active'), '[]'::jsonb) as roles
        from auth.users u left join public.profiles pr on pr.id = u.id
        where (v_pat is null or lower(u.email) like lower(v_pat) escape '\' or lower(coalesce(pr.display_name, '')) like lower(v_pat) escape '\')
          and (p_role is null or exists (select 1 from public.role_assignments ra where ra.user_id = u.id and ra.status = 'active' and ra.role::text = p_role))
        order by u.created_at desc
        limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb));
end $$;

create function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['platform_admin']::public.app_role[]); v jsonb;
begin
  select jsonb_build_object('id', u.id, 'email', u.email, 'display_name', pr.display_name, 'created_at', u.created_at,
           'last_sign_in_at', u.last_sign_in_at, 'email_confirmed', u.email_confirmed_at is not null,
           'suspended', (u.banned_until is not null and u.banned_until > now()),
           'has_authenticator', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
           'roles', coalesce((select jsonb_agg(ra.role::text order by ra.role::text) from public.role_assignments ra where ra.user_id = u.id and ra.status = 'active'), '[]'::jsonb),
           'orders_as_customer', (select count(*) from public.orders o where o.customer_id = u.id),
           'vendor', (select jsonb_build_object('name', ve.name, 'status', ve.status) from public.vendor_staff vs join public.vendors ve on ve.id = vs.vendor_id where vs.user_id = u.id limit 1),
           'rider_status', (select rp.status from public.rider_profiles rp where rp.user_id = u.id))
    into v from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user;
  if v is null then raise exception 'unknown account' using errcode = 'P0002'; end if;
  perform app_private.audit_write(v_actor, 'admin.user_viewed', 'user', p_user::text, '{}'::jsonb);
  return v;
end $$;

-- Suspends (cannot sign in; open sessions are ended) or reinstates an account. Not for yourself and not for staff accounts:
-- remove the staff role first. A reason is required and recorded.
create function public.admin_set_user_suspended(p_user uuid, p_suspended boolean, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['platform_admin']::public.app_role[]);
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 300 then raise exception 'a reason of 5 to 300 characters is required' using errcode = '22023'; end if;
  if p_user = v_actor then raise exception 'you cannot suspend your own account' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown account' using errcode = 'P0002'; end if;
  if coalesce(p_suspended, false) and exists (select 1 from public.role_assignments where user_id = p_user and status = 'active'
        and role in ('platform_admin', 'finance_admin', 'support_agent')) then
    raise exception 'staff_account' using errcode = '42501';
  end if;
  if coalesce(p_suspended, false) then
    update auth.users set banned_until = 'infinity', updated_at = now() where id = p_user;
    delete from auth.sessions where user_id = p_user;
  else
    update auth.users set banned_until = null, updated_at = now() where id = p_user;
  end if;
  perform app_private.audit_write(v_actor, case when coalesce(p_suspended, false) then 'user.suspended' else 'user.reinstated' end,
    'user', p_user::text, jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- ---- dashboard and reports -------------------------------------------------------------------------------------------------------
-- Real counts only. Money figures are payments RECEIVED according to the ledger (test-mode payments in preview), never estimates.
create function public.admin_dashboard() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_money boolean := app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]);
begin
  perform app_private.require_staff(array['platform_admin', 'support_agent', 'finance_admin']::public.app_role[]);
  return jsonb_build_object(
    'orders_total', (select count(*) from public.orders),
    'orders_7d', (select count(*) from public.orders where created_at > now() - interval '7 days'),
    'orders_active', (select count(*) from public.orders where status not in ('COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'RETURNED_TO_VENDOR', 'PENDING_PAYMENT')),
    'payments_received_kobo', case when v_money then (select coalesce(sum(amount_kobo), 0) from public.ledger_entries where entry_type = 'payment_received') end,
    'payments_received_7d_kobo', case when v_money then (select coalesce(sum(amount_kobo), 0) from public.ledger_entries where entry_type = 'payment_received' and created_at > now() - interval '7 days') end,
    'vendors_approved', (select count(*) from public.vendors where status = 'approved'),
    'vendors_pending', (select count(*) from public.vendor_applications where status = 'pending'),
    'riders_approved', (select count(*) from public.rider_profiles where status = 'approved'),
    'users_total', (select count(*) from auth.users u where u.deleted_at is null and not exists (select 1 from public.account_erasures e where e.user_id = u.id)),
    'new_users_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'orders_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'orders', coalesce(c.n, 0)) order by d)
        from generate_series((now() - interval '13 days')::date, now()::date, interval '1 day') d
        left join (select created_at::date as day, count(*) as n from public.orders where created_at > now() - interval '14 days' group by 1) c on c.day = d::date), '[]'::jsonb),
    'recent_orders', coalesce((select jsonb_agg(to_jsonb(r)) from (
        select o.id, o.order_number, o.vendor_name, o.status, o.total_kobo, o.created_at from public.orders o order by o.created_at desc limit 8) r), '[]'::jsonb));
end $$;

create function public.admin_report(p_days int default 30) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_days int := least(greatest(coalesce(p_days, 30), 7), 90); v_since timestamptz;
begin
  perform app_private.require_staff(array['platform_admin', 'finance_admin']::public.app_role[]);
  v_since := now() - make_interval(days => v_days);
  return jsonb_build_object(
    'days', v_days,
    'orders', (select count(*) from public.orders where created_at >= v_since),
    'orders_completed', (select count(*) from public.orders where created_at >= v_since and status = 'COMPLETED'),
    'orders_cancelled', (select count(*) from public.orders where created_at >= v_since and status = 'CANCELLED'),
    'payments_received_kobo', (select coalesce(sum(amount_kobo), 0) from public.ledger_entries where entry_type = 'payment_received' and created_at >= v_since),
    'refunds_paid_kobo', (select coalesce(sum(amount_kobo), 0) from public.ledger_entries where entry_type = 'refund_paid' and created_at >= v_since),
    'new_users', (select count(*) from auth.users where created_at >= v_since),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'n', n) order by n desc) from
        (select status, count(*) as n from public.orders where created_at >= v_since group by 1) s), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'orders', coalesce(oc.n, 0), 'received_kobo', coalesce(lc.k, 0)) order by d)
        from generate_series(v_since::date, now()::date, interval '1 day') d
        left join (select o.created_at::date as day, count(*) as n from public.orders o
                   where o.created_at >= v_since group by 1) oc on oc.day = d::date
        left join (select l.created_at::date as day, sum(l.amount_kobo) as k from public.ledger_entries l
                   where l.entry_type = 'payment_received' and l.created_at >= v_since group by 1) lc on lc.day = d::date), '[]'::jsonb),
    'top_vendors', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select o.vendor_name, count(*) as orders, coalesce(sum(o.items_total_kobo) filter (where o.status = 'COMPLETED'), 0) as completed_items_kobo
        from public.orders o where o.created_at >= v_since group by o.vendor_name order by count(*) desc limit 5) t), '[]'::jsonb));
end $$;

revoke all on function public.admin_list_products(text, text, int, int), public.admin_set_product_visibility(uuid, boolean, text),
  public.admin_list_users(text, text, int, int), public.admin_user_detail(uuid), public.admin_set_user_suspended(uuid, boolean, text),
  public.admin_dashboard(), public.admin_report(int) from public, anon;
grant execute on function public.admin_list_products(text, text, int, int), public.admin_set_product_visibility(uuid, boolean, text),
  public.admin_list_users(text, text, int, int), public.admin_user_detail(uuid), public.admin_set_user_suspended(uuid, boolean, text),
  public.admin_dashboard(), public.admin_report(int) to authenticated, service_role;
