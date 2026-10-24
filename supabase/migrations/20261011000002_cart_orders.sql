-- AFIT Market - Batch 2 / Phase 4: delivery points, cart, checkout pricing, order creation, MOCK payment.
-- Scope guard: only order CREATION and the PENDING_PAYMENT / PAID / CANCELLED transitions exist here.
-- The full state machine and vendor actions arrive in Batch 3. Payment is a clearly-labelled MOCK
-- that fails closed (see mock_pay_order). No real payment provider is referenced.

-- ---------------------------------------------------------------------------------------------
-- Configuration (PLACEHOLDERS pending owner decisions; never hard-coded in the app)
-- ---------------------------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('delivery_fee_kobo', '50000'::jsonb, 'PLACEHOLDER pending owner decision: flat delivery fee in kobo (N500)'),
  ('platform_fee_bps', '500'::jsonb, 'PLACEHOLDER pending owner decision: platform fee in basis points of the items total (5.00%), rounded half up to the kobo'),
  ('unpaid_order_expiry_minutes', '30'::jsonb, 'PLACEHOLDER: minutes before an unpaid order expires and its stock is released'),
  ('max_cart_item_quantity', '20'::jsonb, 'PLACEHOLDER: maximum quantity of one cart line'),
  ('mock_payments_enabled', 'false'::jsonb, 'Local/test only. Default OFF. Can only be changed with direct database access, never from the app.')
on conflict (key) do nothing;

create function app_private.setting_int(p_key text, p_default bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce((select (s.value #>> '{}')::bigint from public.platform_settings s where s.key = p_key), p_default) $$;
revoke all on function app_private.setting_int(text, bigint) from public, anon;
grant execute on function app_private.setting_int(text, bigint) to authenticated, service_role;

create or replace function public.set_platform_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_n bigint;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Policy encoded in code: vendor settlement stays DISABLED until Paystack + legal confirmation.
  if p_key = 'settlement_policy' and p_value is distinct from '"DISABLED"'::jsonb then
    raise exception 'settlement_policy is locked to DISABLED pending provider and legal approval' using errcode = '42501';
  end if;
  if p_key = 'mock_payments_enabled' then
    raise exception 'mock_payments_enabled can only be changed with direct database access' using errcode = '42501';
  end if;
  if p_key in ('delivery_fee_kobo', 'platform_fee_bps', 'unpaid_order_expiry_minutes', 'max_cart_item_quantity') then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,9}$' then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
    v_n := (p_value #>> '{}')::bigint;
    if (p_key = 'delivery_fee_kobo' and v_n > 1000000) or (p_key = 'platform_fee_bps' and v_n > 3000)
       or (p_key = 'unpaid_order_expiry_minutes' and v_n not between 5 and 1440)
       or (p_key = 'max_cart_item_quantity' and v_n not between 1 and 100) then
      raise exception 'value out of range for %', p_key using errcode = '22023';
    end if;
  end if;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, v_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform app_private.audit_write(v_actor, 'setting.changed', 'platform_setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Approved delivery points (admin managed; FICTIONAL placeholders; no coordinates in this batch)
-- ---------------------------------------------------------------------------------------------
create table public.approved_delivery_points (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 3 and 80),
  instructions text check (instructions is null or char_length(instructions) <= 200),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------------------------
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity int not null check (quantity between 1 and 100),
  selected_option_ids uuid[] not null default '{}',
  created_at timestamptz not null default clock_timestamp() -- insertion order must be stable even within one transaction
);
create index cart_items_cart_idx on public.cart_items (cart_id);

-- ---------------------------------------------------------------------------------------------
-- Orders (immutable snapshots) and history
-- ---------------------------------------------------------------------------------------------
create sequence public.order_number_seq start 1000;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references auth.users (id) on delete restrict,
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  vendor_name text not null,
  fulfilment text not null check (fulfilment in ('pickup', 'delivery')),
  delivery_point_id uuid references public.approved_delivery_points (id) on delete set null,
  delivery_point_label text,
  pickup_location_snapshot text,
  prep_minutes_snapshot int,
  status text not null default 'PENDING_PAYMENT' check (status in (
    'PENDING_PAYMENT', 'PAID', 'VENDOR_REVIEW', 'ACCEPTED', 'PREPARING', 'READY', 'AWAITING_RIDER', 'RIDER_ASSIGNED',
    'PICKED_UP_BY_RIDER', 'EN_ROUTE', 'ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF', 'DELIVERED',
    'PICKUP_AWAITING_HANDOVER', 'COMPLETED', 'CANCELLED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED',
    'DISPUTED', 'RETURN_REQUESTED', 'RETURN_IN_PROGRESS', 'RETURNED_TO_VENDOR')),
  items_total_kobo bigint not null check (items_total_kobo >= 0),
  delivery_fee_kobo bigint not null check (delivery_fee_kobo >= 0),
  platform_fee_kobo bigint not null check (platform_fee_kobo >= 0),
  discount_kobo bigint not null default 0 check (discount_kobo >= 0),
  total_kobo bigint not null check (total_kobo > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches check (total_kobo = items_total_kobo + delivery_fee_kobo + platform_fee_kobo - discount_kobo),
  constraint orders_delivery_shape check (
    (fulfilment = 'delivery' and delivery_point_label is not null)
    or (fulfilment = 'pickup' and delivery_point_label is null and delivery_fee_kobo = 0)),
  constraint orders_unique_idempotency unique (customer_id, idempotency_key)
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_vendor_idx on public.orders (vendor_id, created_at desc);
create index orders_expiry_idx on public.orders (expires_at) where status = 'PENDING_PAYMENT';
create trigger orders_touch before update on public.orders for each row execute function app_private.touch_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  options jsonb not null default '[]'::jsonb,
  base_price_kobo bigint not null check (base_price_kobo > 0),
  unit_price_kobo bigint not null check (unit_price_kobo > 0),
  quantity int not null check (quantity between 1 and 100),
  line_total_kobo bigint not null,
  constraint order_items_line_matches check (line_total_kobo = unit_price_kobo * quantity)
);
create index order_items_order_idx on public.order_items (order_id);
create trigger order_items_immutable before update or delete on public.order_items
  for each row execute function app_private.deny_mutation();
-- the product_id FK uses ON DELETE SET NULL, which is an UPDATE: allow only that single column change
drop trigger order_items_immutable on public.order_items;
create function app_private.order_items_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.product_id is not null and new.product_id is null
     and (new.id, new.order_id, new.product_name, new.options, new.base_price_kobo, new.unit_price_kobo,
          new.quantity, new.line_total_kobo) is not distinct from
         (old.id, old.order_id, old.product_name, old.options, old.base_price_kobo, old.unit_price_kobo,
          old.quantity, old.line_total_kobo) then
    return new;
  end if;
  raise exception '% on % is not allowed (immutable order snapshot)', tg_op, tg_table_name using errcode = '42501';
end $$;
revoke all on function app_private.order_items_guard() from public, anon, authenticated;
create trigger order_items_immutable before update or delete on public.order_items
  for each row execute function app_private.order_items_guard();
create trigger order_items_no_truncate before truncate on public.order_items
  for each statement execute function app_private.deny_mutation();

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  from_status text,
  to_status text not null,
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, id);
create trigger order_status_history_append_only before update or delete on public.order_status_history
  for each row execute function app_private.deny_mutation();
create trigger order_status_history_no_truncate before truncate on public.order_status_history
  for each statement execute function app_private.deny_mutation();

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  provider text not null check (provider in ('mock')),
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null check (status in ('succeeded', 'failed')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index payment_attempts_order_idx on public.payment_attempts (order_id);
create trigger payment_attempts_append_only before update or delete on public.payment_attempts
  for each row execute function app_private.deny_mutation();

-- ---------------------------------------------------------------------------------------------
-- Replace the Batch 1 stub: the "registered customer needs aal2 to order" rule now lives in create_order
-- ---------------------------------------------------------------------------------------------
drop function public.stub_place_order();
drop table public.stub_order_placements;

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['approved_delivery_points', 'carts', 'cart_items', 'orders', 'order_items', 'order_status_history', 'payment_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.order_number_seq from public, anon, authenticated;
grant select on public.approved_delivery_points, public.carts, public.cart_items, public.orders,
  public.order_items, public.order_status_history, public.payment_attempts to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy delivery_points_select on public.approved_delivery_points for select to authenticated
  using (app_private.is_platform_admin());
create policy delivery_points_mfa on public.approved_delivery_points as restrictive for all to authenticated
  using (app_private.mfa_satisfied());

create policy carts_select on public.carts for select to authenticated using (user_id = (select auth.uid()));
create policy carts_mfa on public.carts as restrictive for all to authenticated using (app_private.mfa_satisfied());
create policy cart_items_select on public.cart_items for select to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));
create policy cart_items_mfa on public.cart_items as restrictive for all to authenticated using (app_private.mfa_satisfied());

-- Orders are a protected account feature: aal2 for EVERYONE (customers included).
create policy orders_select on public.orders for select to authenticated
  using (customer_id = (select auth.uid()) or app_private.is_vendor_member(vendor_id)
         or app_private.has_any_role(array['platform_admin', 'support_agent', 'finance_admin']::public.app_role[]));
create policy orders_aal2 on public.orders as restrictive for all to authenticated using (app_private.is_aal2());
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy order_items_aal2 on public.order_items as restrictive for all to authenticated using (app_private.is_aal2());
create policy order_history_select on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy order_history_aal2 on public.order_status_history as restrictive for all to authenticated using (app_private.is_aal2());
create policy payment_attempts_select on public.payment_attempts for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and
                 (o.customer_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]))));
create policy payment_attempts_aal2 on public.payment_attempts as restrictive for all to authenticated using (app_private.is_aal2());

-- ---------------------------------------------------------------------------------------------
-- Pricing and selection validation (internal)
-- ---------------------------------------------------------------------------------------------
-- Platform fee: items * bps / 10000, rounded half up to the kobo. Non-negative inputs only.
create function app_private.platform_fee(p_items bigint, p_bps bigint) returns bigint
language sql immutable set search_path = ''
as $$ select case when p_items < 0 or p_bps < 0 then null else (p_items * p_bps + 5000) / 10000 end $$;

-- NULL when the selection is valid for the product, otherwise a problem code.
create function app_private.selection_problem(p_product uuid, p_option_ids uuid[]) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare g record; v_cnt int; v_total int;
begin
  p_option_ids := coalesce(p_option_ids, '{}');
  if (select count(distinct x) from unnest(p_option_ids) x) <> coalesce(array_length(p_option_ids, 1), 0) then
    return 'invalid_option';
  end if;
  select count(*) into v_cnt from public.product_options o join public.product_option_groups gr on gr.id = o.group_id
   where gr.product_id = p_product and o.id = any (p_option_ids);
  if v_cnt <> coalesce(array_length(p_option_ids, 1), 0) then return 'invalid_option'; end if;
  if exists (select 1 from public.product_options o where o.id = any (p_option_ids) and not o.is_available) then
    return 'option_unavailable';
  end if;
  for g in select gr.id, gr.min_select, gr.max_select from public.product_option_groups gr where gr.product_id = p_product loop
    select count(*) into v_total from public.product_options o where o.group_id = g.id and o.id = any (p_option_ids);
    if v_total < g.min_select or v_total > g.max_select then return 'option_selection_invalid'; end if;
  end loop;
  return null;
end $$;

create function app_private.price_cart(p_user uuid, p_fulfilment text, p_delivery_point uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cart public.carts%rowtype; v_vendor public.vendors%rowtype; r record;
  v_lines jsonb := '[]'::jsonb; v_problems jsonb := '[]'::jsonb;
  v_items bigint := 0; v_delivery bigint := 0; v_fee bigint; v_unit bigint; v_delta bigint; v_opts jsonb;
  v_prob text; v_label text; v_max int := app_private.setting_int('max_cart_item_quantity', 20)::int;
begin
  if p_fulfilment not in ('pickup', 'delivery') then raise exception 'invalid_fulfilment' using errcode = '22023'; end if;
  select * into v_cart from public.carts where user_id = p_user;
  if not found or not exists (select 1 from public.cart_items where cart_id = v_cart.id) then
    return jsonb_build_object('empty', true, 'fulfilment', p_fulfilment, 'lines', '[]'::jsonb, 'problems', '[]'::jsonb,
      'items_total_kobo', 0, 'delivery_fee_kobo', 0, 'platform_fee_kobo', 0, 'discount_kobo', 0, 'total_kobo', 0);
  end if;
  select * into v_vendor from public.vendors where id = v_cart.vendor_id;
  if not found or v_vendor.status <> 'approved' then
    v_problems := v_problems || jsonb_build_object('code', 'vendor_unavailable');
  elsif not app_private.vendor_is_open(v_vendor.id) then
    v_problems := v_problems || jsonb_build_object('code', 'vendor_closed');
  end if;

  for r in
    select ci.id as item_id, ci.product_id, ci.quantity, ci.selected_option_ids, p.name, p.price_kobo, p.is_available,
           p.status, p.vendor_id
    from public.cart_items ci join public.products p on p.id = ci.product_id
    where ci.cart_id = v_cart.id order by ci.created_at, ci.id
  loop
    if r.vendor_id is distinct from v_cart.vendor_id then
      v_problems := v_problems || jsonb_build_object('code', 'vendor_mismatch', 'item_id', r.item_id);
    end if;
    if r.status <> 'active' or not r.is_available then
      v_problems := v_problems || jsonb_build_object('code', 'unavailable', 'item_id', r.item_id, 'product_id', r.product_id);
    end if;
    if r.quantity < 1 or r.quantity > v_max then
      v_problems := v_problems || jsonb_build_object('code', 'invalid_quantity', 'item_id', r.item_id);
    end if;
    v_prob := app_private.selection_problem(r.product_id, r.selected_option_ids);
    if v_prob is not null then
      v_problems := v_problems || jsonb_build_object('code', v_prob, 'item_id', r.item_id, 'product_id', r.product_id);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'group', g.name, 'name', o.name, 'price_delta_kobo', o.price_delta_kobo)
                              order by g.sort_order, o.sort_order, o.name), '[]'::jsonb),
           coalesce(sum(o.price_delta_kobo), 0)
      into v_opts, v_delta
      from public.product_options o join public.product_option_groups g on g.id = o.group_id
     where o.id = any (r.selected_option_ids) and g.product_id = r.product_id;
    v_unit := r.price_kobo + v_delta;
    v_items := v_items + v_unit * r.quantity;
    v_lines := v_lines || jsonb_build_object('item_id', r.item_id, 'product_id', r.product_id, 'name', r.name,
      'quantity', r.quantity, 'base_price_kobo', r.price_kobo, 'unit_price_kobo', v_unit,
      'line_total_kobo', v_unit * r.quantity, 'options', v_opts);
  end loop;

  for r in
    select ci.product_id, sum(ci.quantity) as q, p.stock_quantity
    from public.cart_items ci join public.products p on p.id = ci.product_id
    where ci.cart_id = v_cart.id group by ci.product_id, p.stock_quantity
    having p.stock_quantity is not null and sum(ci.quantity) > p.stock_quantity
  loop
    v_problems := v_problems || jsonb_build_object('code', 'out_of_stock', 'product_id', r.product_id);
  end loop;

  if p_fulfilment = 'delivery' then
    select dp.label into v_label from public.approved_delivery_points dp where dp.id = p_delivery_point and dp.is_active;
    if v_label is null then
      v_problems := v_problems || jsonb_build_object('code', 'delivery_point_invalid');
    end if;
    v_delivery := app_private.setting_int('delivery_fee_kobo', 0);
  end if;
  v_fee := app_private.platform_fee(v_items, app_private.setting_int('platform_fee_bps', 0));

  return jsonb_build_object('empty', false, 'fulfilment', p_fulfilment, 'vendor_id', v_cart.vendor_id,
    'vendor_name', v_vendor.name, 'delivery_point_label', v_label, 'lines', v_lines, 'problems', v_problems,
    'items_total_kobo', v_items, 'delivery_fee_kobo', v_delivery, 'platform_fee_kobo', v_fee, 'discount_kobo', 0,
    'total_kobo', v_items + v_delivery + v_fee);
end $$;

create function app_private.release_order_stock(p_order uuid) returns void
language sql security definer set search_path = ''
as $$
  update public.products p set stock_quantity = p.stock_quantity + s.q
    from (select oi.product_id, sum(oi.quantity)::int as q from public.order_items oi
           where oi.order_id = p_order and oi.product_id is not null group by oi.product_id) s
   where p.id = s.product_id and p.stock_quantity is not null
$$;

create function app_private.cancel_order_and_release(p_order uuid, p_actor uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.orders where id = p_order for update;
  if v_status is distinct from 'PENDING_PAYMENT' then return false; end if;
  update public.orders set status = 'CANCELLED' where id = p_order;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason)
    values (p_order, 'PENDING_PAYMENT', 'CANCELLED', p_actor, p_reason);
  perform app_private.release_order_stock(p_order);
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app_private.platform_fee(bigint, bigint)', 'app_private.selection_problem(uuid, uuid[])',
    'app_private.price_cart(uuid, text, uuid)', 'app_private.release_order_stock(uuid)',
    'app_private.cancel_order_and_release(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- pure helper used in policies/tests may be called by authenticated
  grant execute on function app_private.platform_fee(bigint, bigint) to authenticated;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Delivery points (admin) and list for checkout
-- ---------------------------------------------------------------------------------------------
create function public.delivery_point_upsert(p_id uuid, p_label text, p_instructions text, p_active boolean, p_sort int)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin(); v_id uuid;
begin
  if p_id is null then
    insert into public.approved_delivery_points (label, instructions, is_active, sort_order)
    values (btrim(p_label), nullif(btrim(p_instructions), ''), coalesce(p_active, true), coalesce(p_sort, 0)) returning id into v_id;
  else
    update public.approved_delivery_points set label = btrim(p_label), instructions = nullif(btrim(p_instructions), ''),
      is_active = coalesce(p_active, true), sort_order = coalesce(p_sort, 0) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'unknown delivery point' using errcode = 'P0002'; end if;
  end if;
  perform app_private.audit_write(v_actor, 'delivery_point.saved', 'delivery_point', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

create function public.list_delivery_points() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'instructions', d.instructions)
                                    order by d.sort_order, d.label), '[]'::jsonb)
          from public.approved_delivery_points d where d.is_active);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Cart operations (registered customers; privileged accounts need aal2 like everywhere else)
-- ---------------------------------------------------------------------------------------------
create function app_private.require_customer() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.mfa_satisfied() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('customer') then raise exception 'forbidden' using errcode = '42501'; end if;
  return v_actor;
end $$;
revoke all on function app_private.require_customer() from public, anon;
grant execute on function app_private.require_customer() to authenticated, service_role;

create function public.cart_add_item(p_product uuid, p_qty int, p_options uuid[], p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_customer(); v_p public.products%rowtype; v_cart public.carts%rowtype;
  v_opts uuid[]; v_prob text; v_max int := app_private.setting_int('max_cart_item_quantity', 20)::int; v_existing public.cart_items%rowtype;
begin
  if p_qty is null or p_qty < 1 or p_qty > v_max then raise exception 'invalid_quantity' using errcode = '22023'; end if;
  select * into v_p from public.products where id = p_product and status = 'active' and is_available;
  if not found or not exists (select 1 from public.vendors v where v.id = v_p.vendor_id and v.status = 'approved') then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(x order by x), '{}') into v_opts from unnest(coalesce(p_options, '{}')) x;
  v_prob := app_private.selection_problem(p_product, v_opts);
  if v_prob is not null then raise exception '%', v_prob using errcode = '22023'; end if;

  insert into public.carts (user_id) values (v_actor) on conflict (user_id) do nothing;
  select * into v_cart from public.carts where user_id = v_actor for update;
  if v_cart.vendor_id is not null and v_cart.vendor_id <> v_p.vendor_id
     and exists (select 1 from public.cart_items where cart_id = v_cart.id) then
    if not coalesce(p_replace, false) then
      return jsonb_build_object('status', 'vendor_conflict');
    end if;
    delete from public.cart_items where cart_id = v_cart.id;
  end if;
  if (select count(*) from public.cart_items where cart_id = v_cart.id) >= 30 then
    raise exception 'cart_full' using errcode = '22023';
  end if;
  select * into v_existing from public.cart_items
   where cart_id = v_cart.id and product_id = p_product and selected_option_ids = v_opts;
  if found then
    update public.cart_items set quantity = least(quantity + p_qty, v_max) where id = v_existing.id;
  else
    insert into public.cart_items (cart_id, product_id, quantity, selected_option_ids) values (v_cart.id, p_product, p_qty, v_opts);
  end if;
  update public.carts set vendor_id = v_p.vendor_id, updated_at = now() where id = v_cart.id;
  return jsonb_build_object('status', 'added');
end $$;

create function public.cart_set_quantity(p_item uuid, p_qty int) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer(); v_cart uuid; v_max int := app_private.setting_int('max_cart_item_quantity', 20)::int;
begin
  select c.id into v_cart from public.carts c join public.cart_items i on i.cart_id = c.id
   where i.id = p_item and c.user_id = v_actor;
  if v_cart is null then raise exception 'unknown item' using errcode = 'P0002'; end if;
  if p_qty is null or p_qty < 0 or p_qty > v_max then raise exception 'invalid_quantity' using errcode = '22023'; end if;
  if p_qty = 0 then delete from public.cart_items where id = p_item;
  else update public.cart_items set quantity = p_qty where id = p_item; end if;
  if not exists (select 1 from public.cart_items where cart_id = v_cart) then
    update public.carts set vendor_id = null, updated_at = now() where id = v_cart;
  else
    update public.carts set updated_at = now() where id = v_cart;
  end if;
end $$;

create function public.cart_clear() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer();
begin
  delete from public.cart_items where cart_id in (select id from public.carts where user_id = v_actor);
  update public.carts set vendor_id = null, updated_at = now() where user_id = v_actor;
end $$;

create function public.cart_quote(p_fulfilment text, p_delivery_point uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_customer();
begin
  return app_private.price_cart(v_actor, p_fulfilment, p_delivery_point);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Order creation: ONE transaction. Recomputes every price from the database; the client supplies
-- only the fulfilment choice, the delivery point and an idempotency key.
-- ---------------------------------------------------------------------------------------------
create function public.create_order(p_fulfilment text, p_delivery_point uuid, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid()); v_cart public.carts%rowtype; v_quote jsonb; v_order uuid; v_line jsonb;
  v_vendor public.vendors%rowtype; v_expiry int := app_private.setting_int('unpaid_order_expiry_minutes', 30)::int;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('customer') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_fulfilment not in ('pickup', 'delivery') then raise exception 'invalid_fulfilment' using errcode = '22023'; end if;

  select id into v_order from public.orders where customer_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_order; end if;

  select * into v_cart from public.carts where user_id = v_actor for update;
  if not found or not exists (select 1 from public.cart_items where cart_id = v_cart.id) then
    raise exception 'cart_empty' using errcode = '22023';
  end if;
  -- Serialise stock: lock the products in a fixed order so concurrent buyers queue instead of deadlocking.
  perform 1 from public.products where id in (select product_id from public.cart_items where cart_id = v_cart.id)
   order by id for update;

  v_quote := app_private.price_cart(v_actor, p_fulfilment, p_delivery_point);
  if jsonb_array_length(v_quote->'problems') > 0 then
    raise exception 'checkout_blocked' using detail = (v_quote->'problems')::text, errcode = 'P0001';
  end if;
  select * into v_vendor from public.vendors where id = v_cart.vendor_id;

  begin
    insert into public.orders (order_number, customer_id, vendor_id, vendor_name, fulfilment, delivery_point_id,
      delivery_point_label, pickup_location_snapshot, prep_minutes_snapshot, items_total_kobo, delivery_fee_kobo,
      platform_fee_kobo, discount_kobo, total_kobo, idempotency_key, expires_at)
    values ('AFM-' || lpad(nextval('public.order_number_seq')::text, 6, '0'), v_actor, v_vendor.id, v_vendor.name,
      p_fulfilment, case when p_fulfilment = 'delivery' then p_delivery_point end, v_quote->>'delivery_point_label',
      v_vendor.pickup_location_text, v_vendor.prep_minutes,
      (v_quote->>'items_total_kobo')::bigint, (v_quote->>'delivery_fee_kobo')::bigint, (v_quote->>'platform_fee_kobo')::bigint,
      (v_quote->>'discount_kobo')::bigint, (v_quote->>'total_kobo')::bigint, p_idempotency_key,
      now() + make_interval(mins => v_expiry))
    returning id into v_order;
  exception when unique_violation then
    select id into v_order from public.orders where customer_id = v_actor and idempotency_key = p_idempotency_key;
    if found then return v_order; end if;
    raise;
  end;

  for v_line in select * from jsonb_array_elements(v_quote->'lines') loop
    insert into public.order_items (order_id, product_id, product_name, options, base_price_kobo, unit_price_kobo, quantity, line_total_kobo)
    values (v_order, (v_line->>'product_id')::uuid, v_line->>'name', v_line->'options', (v_line->>'base_price_kobo')::bigint,
            (v_line->>'unit_price_kobo')::bigint, (v_line->>'quantity')::int, (v_line->>'line_total_kobo')::bigint);
  end loop;
  update public.products p set stock_quantity = p.stock_quantity - s.q
    from (select product_id, sum(quantity)::int as q from public.cart_items where cart_id = v_cart.id group by product_id) s
   where p.id = s.product_id and p.stock_quantity is not null;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason)
    values (v_order, null, 'PENDING_PAYMENT', v_actor, 'order_created');
  perform app_private.audit_write(v_actor, 'order.created', 'order', v_order::text,
    jsonb_build_object('vendor_id', v_vendor.id, 'total_kobo', (v_quote->>'total_kobo')::bigint));
  delete from public.cart_items where cart_id = v_cart.id;
  update public.carts set vendor_id = null, updated_at = now() where id = v_cart.id;
  return v_order;
end $$;

create function public.cancel_unpaid_order(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_customer uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select customer_id into v_customer from public.orders where id = p_order;
  if v_customer is distinct from v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if not app_private.cancel_order_and_release(p_order, v_actor, 'customer_cancelled') then
    raise exception 'order_not_cancellable' using errcode = '22023';
  end if;
  perform app_private.audit_write(v_actor, 'order.cancelled', 'order', p_order::text, '{}'::jsonb);
end $$;

-- Releases stock of unpaid orders past their expiry. Service role only; to be scheduled (pg_cron or a
-- server job) in Batch 3/6. Safe to run repeatedly.
create function public.expire_unpaid_orders() returns int
language plpgsql security definer set search_path = ''
as $$
declare r record; v_n int := 0;
begin
  for r in select id from public.orders where status = 'PENDING_PAYMENT' and expires_at <= now() order by expires_at limit 500 loop
    if app_private.cancel_order_and_release(r.id, null, 'expired') then v_n := v_n + 1; end if;
  end loop;
  if v_n > 0 then
    perform app_private.audit_write(null, 'order.expired_batch', 'order', null, jsonb_build_object('count', v_n));
  end if;
  return v_n;
end $$;

-- MOCK payment. Fails closed: requires the database flag mock_payments_enabled = true, which is OFF by
-- default and cannot be changed from the application. The app additionally requires APP_ENV=local.
create function public.mock_pay_order(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if coalesce((select (s.value #>> '{}') = 'true' from public.platform_settings s where s.key = 'mock_payments_enabled'), false) is not true then
    raise exception 'mock_payments_disabled' using errcode = '42501';
  end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_o.status = 'PAID' then return; end if; -- idempotent
  if v_o.status <> 'PENDING_PAYMENT' or v_o.expires_at <= now() then raise exception 'order_not_payable' using errcode = '22023'; end if;
  insert into public.payment_attempts (order_id, provider, amount_kobo, status, idempotency_key)
    values (p_order, 'mock', v_o.total_kobo, 'succeeded', 'mock-' || p_order::text);
  update public.orders set status = 'PAID' where id = p_order;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason)
    values (p_order, 'PENDING_PAYMENT', 'PAID', v_actor, 'mock_payment');
  perform app_private.audit_write(v_actor, 'order.mock_paid', 'order', p_order::text, jsonb_build_object('total_kobo', v_o.total_kobo));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.delivery_point_upsert(uuid, text, text, boolean, int)', 'public.list_delivery_points()',
    'public.cart_add_item(uuid, int, uuid[], boolean)', 'public.cart_set_quantity(uuid, int)', 'public.cart_clear()',
    'public.cart_quote(text, uuid)', 'public.create_order(text, uuid, text)', 'public.cancel_unpaid_order(uuid)',
    'public.mock_pay_order(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke all on function public.expire_unpaid_orders() from public, anon, authenticated;
  grant execute on function public.expire_unpaid_orders() to service_role;
end $$;
