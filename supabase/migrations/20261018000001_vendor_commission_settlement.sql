-- Master Prompt 2, Part 4: the customer no longer pays a platform fee; AFIT Market earns a vendor commission instead.
--
-- Approved model (owner, 2026-10-15):
--   * Customer pays items + delivery - discount. NO extra platform/service fee.
--   * Vendor commission: 4.5% (450 bps) of the eligible product subtotal (items total minus product discounts;
--     delivery is excluded).
--       - AFIT Market allocation: 3.0% (300 bps)
--       - Paystack-cost BUDGETING allowance: 1.5% (150 bps) = commission - AFIT allocation. This is an internal budget, NOT a
--         verified Paystack tariff. The actual Paystack charges are paid by AFIT Market.
--   * Money is integer kobo; the single rounding rule is HALF UP to the kobo (app_private.round_bps).
--
-- Historical data: orders.platform_fee_kobo stays as a column and old orders keep their stored totals untouched (no rewrite,
-- no backfill). New orders always get 0. Commission lines are created only for orders that complete after this migration.
-- Payouts remain disabled: nothing here pays anybody; a line records what is OWED, never that it was paid.

-- ---------------------------------------------------------------------------------------------
-- 1. Customer fee removed at the one place that prices a cart
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.platform_fee(p_items bigint, p_bps bigint) returns bigint
language sql immutable set search_path = ''
as $$ select 0::bigint $$; -- the customer-facing service fee no longer exists; kept so historical callers and signatures still resolve

-- ---------------------------------------------------------------------------------------------
-- 2. Settings: the old fee is pinned to 0, the new rates are explicit, audited settings
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.setting_rule(p_key text) returns table (kind text, lo bigint, hi bigint, choices text[])
language sql immutable set search_path = ''
as $$
  select r.kind, r.lo, r.hi, r.choices from (values
    ('delivery_fee_kobo', 'int', 0::bigint, 1000000::bigint, null::text[]),
    ('platform_fee_bps', 'int', 0, 0, null),               -- pinned: the customer fee is retired
    ('vendor_commission_bps', 'int', 0, 2000, null),
    ('commission_afit_bps', 'int', 0, 2000, null),
    ('unpaid_order_expiry_minutes', 'int', 5, 1440, null),
    ('max_cart_item_quantity', 'int', 1, 100, null),
    ('handover_token_ttl_minutes', 'int', 5, 720, null),
    ('location_max_accuracy_m', 'int', 5, 500, null),
    ('location_max_age_seconds', 'int', 5, 600, null),
    ('location_min_interval_seconds', 'int', 1, 60, null),
    ('location_stale_after_seconds', 'int', 10, 600, null),
    ('arrival_max_accuracy_m', 'int', 5, 200, null),
    ('arrival_max_age_seconds', 'int', 5, 120, null),
    ('default_geofence_radius_m', 'int', 10, 500, null),
    ('location_history_retention_hours', 'int', 1, 720, null),
    ('delivery_proof_ttl_minutes', 'int', 5, 120, null),
    ('refund_support_approval_limit_kobo', 'int', 0, 100000000, null),
    ('typed_signature_enabled', 'bool', null, null, null),
    ('refund_fee_policy', 'enum', null, null, array['none', 'proportional_service_fee']),
    ('return_policy', 'return_policy', null, null, null),
    ('settlement_policy', 'locked', null, null, null),
    ('mock_payments_enabled', 'locked', null, null, null),
    ('rider_terms_current_version', 'locked', null, null, null)
  ) as r(key, kind, lo, hi, choices) where r.key = p_key
$$;

update public.platform_settings set value = '0'::jsonb,
  note = 'RETIRED: the customer-facing platform fee no longer exists (pinned to 0). The vendor commission is vendor_commission_bps.'
 where key = 'platform_fee_bps';
insert into public.platform_settings (key, value, note) values
  ('vendor_commission_bps', '450'::jsonb, 'Owner-approved: vendor commission in basis points of the eligible product subtotal (4.50%). Delivery excluded. Copied into each order settlement line.'),
  ('commission_afit_bps', '300'::jsonb, 'Owner-approved: the part of the commission allocated to AFIT Market (3.00%). The remainder of the commission is the Paystack-cost BUDGETING allowance (not an official tariff).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 3. Arithmetic helper (the only rounding rule)
-- ---------------------------------------------------------------------------------------------
create function app_private.round_bps(p_amount bigint, p_bps bigint) returns bigint
language sql immutable set search_path = ''
as $$ select (p_amount * p_bps + 5000) / 10000 $$;  -- half up, integer arithmetic only, non-negative inputs

-- ---------------------------------------------------------------------------------------------
-- 4. Settlement records: one immutable line per completed order, one immutable adjustment per succeeded refund
-- ---------------------------------------------------------------------------------------------
create table public.order_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  base_kobo bigint not null check (base_kobo >= 0),               -- eligible product subtotal after product discounts; delivery excluded
  commission_bps int not null check (commission_bps between 0 and 2000),
  afit_bps int not null check (afit_bps between 0 and 2000),
  paystack_budget_bps int not null check (paystack_budget_bps between 0 and 2000),
  commission_kobo bigint not null check (commission_kobo >= 0),
  afit_allocation_kobo bigint not null check (afit_allocation_kobo >= 0),
  paystack_allowance_kobo bigint not null check (paystack_allowance_kobo >= 0),  -- BUDGET, not a verified provider fee
  delivery_fee_kobo bigint not null check (delivery_fee_kobo >= 0), -- informational; never part of the base
  created_at timestamptz not null default now(),
  constraint settlement_rates_consistent check (commission_bps = afit_bps + paystack_budget_bps),
  constraint settlement_amounts_consistent check (commission_kobo = afit_allocation_kobo + paystack_allowance_kobo and commission_kobo <= base_kobo)
);
create index order_settlement_lines_vendor_idx on public.order_settlement_lines (vendor_id, created_at desc);

create table public.order_settlement_adjustments (
  id bigint generated always as identity primary key,
  line_id uuid not null references public.order_settlement_lines (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,
  refund_id uuid not null unique references public.refunds (id) on delete restrict,  -- one adjustment per refund: retries cannot duplicate
  base_reversed_kobo bigint not null check (base_reversed_kobo >= 0),
  commission_reversed_kobo bigint not null check (commission_reversed_kobo >= 0),
  afit_reversed_kobo bigint not null check (afit_reversed_kobo >= 0),
  paystack_reversed_kobo bigint not null check (paystack_reversed_kobo >= 0),
  reason text not null check (char_length(reason) between 3 and 200),
  created_at timestamptz not null default now(),
  constraint settlement_adjustment_consistent check (commission_reversed_kobo = afit_reversed_kobo + paystack_reversed_kobo)
);
create index order_settlement_adjustments_order_idx on public.order_settlement_adjustments (order_id);

create trigger order_settlement_lines_immutable before update or delete on public.order_settlement_lines
  for each row execute function app_private.deny_mutation();
create trigger order_settlement_lines_no_truncate before truncate on public.order_settlement_lines
  for each statement execute function app_private.deny_mutation();
create trigger order_settlement_adjustments_immutable before update or delete on public.order_settlement_adjustments
  for each row execute function app_private.deny_mutation();
create trigger order_settlement_adjustments_no_truncate before truncate on public.order_settlement_adjustments
  for each statement execute function app_private.deny_mutation();

-- Product amount a refund item takes out of the commission base: price x quantity less its share of any product discount.
-- (The refund itself may also carry a share of a historical service fee; that is not product sales and is excluded here.)
create function app_private.refund_item_base(p_item uuid, p_qty int) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare i public.order_items%rowtype; o public.orders%rowtype; v_gross bigint; v_disc bigint;
begin
  select * into i from public.order_items where id = p_item;
  select * into o from public.orders where id = i.order_id;
  v_gross := i.unit_price_kobo * p_qty;
  v_disc := case when o.items_total_kobo > 0 then (v_gross * o.discount_kobo) / o.items_total_kobo else 0 end;
  return v_gross - v_disc;
end $$;

-- Records the reversal for ONE succeeded refund. Idempotent (unique refund_id). Uses cumulative rounding so that the
-- commission left after all refunds always equals round_bps(remaining base), and a full refund reverses exactly everything.
create function app_private.settle_refund(p_refund uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.refunds%rowtype; l public.order_settlement_lines%rowtype;
  v_prior_base bigint; v_prior_comm bigint; v_prior_afit bigint;
  v_rev_base bigint; v_net_base bigint; v_comm_now bigint; v_afit_now bigint;
  v_comm_after bigint; v_afit_after bigint;
begin
  select * into r from public.refunds where id = p_refund;
  if not found or r.status <> 'succeeded' then return; end if;
  select * into l from public.order_settlement_lines where order_id = r.order_id;
  if not found then return; end if;                       -- order not completed yet: the line is created later, with this refund applied
  if exists (select 1 from public.order_settlement_adjustments where refund_id = p_refund) then return; end if;

  select coalesce(sum(base_reversed_kobo), 0), coalesce(sum(commission_reversed_kobo), 0), coalesce(sum(afit_reversed_kobo), 0)
    into v_prior_base, v_prior_comm, v_prior_afit from public.order_settlement_adjustments where line_id = l.id;
  select coalesce(sum(app_private.refund_item_base(ri.order_item_id, ri.quantity)), 0) into v_rev_base
    from public.refund_items ri where ri.refund_id = p_refund;
  if not exists (select 1 from public.refund_items where refund_id = p_refund) then
    -- A refund with no item breakdown (whole-order or an amount-only finance refund) is applied to product sales first: delivery is
    -- never part of the commission base, so only the part that falls on product value reverses commission.
    v_rev_base := r.amount_kobo;
  end if;
  v_rev_base := least(v_rev_base, l.base_kobo - v_prior_base);       -- never reverse more product sales than were counted
  if v_rev_base <= 0 then return; end if;

  v_net_base := l.base_kobo - v_prior_base - v_rev_base;
  v_comm_after := app_private.round_bps(v_net_base, l.commission_bps);
  v_afit_after := app_private.round_bps(v_net_base, l.afit_bps);
  v_comm_now := (l.commission_kobo - v_prior_comm) - v_comm_after;   -- how much commission disappears with this refund
  v_afit_now := (l.afit_allocation_kobo - v_prior_afit) - v_afit_after;
  insert into public.order_settlement_adjustments (line_id, order_id, refund_id, base_reversed_kobo, commission_reversed_kobo,
                                                   afit_reversed_kobo, paystack_reversed_kobo, reason)
    values (l.id, l.order_id, p_refund, v_rev_base, v_comm_now, v_afit_now, v_comm_now - v_afit_now, 'refund_succeeded')
    on conflict (refund_id) do nothing;
end $$;

-- A line is created once, in the same transaction that records the order as COMPLETED.
create function app_private.settle_completed_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype; v_comm_bps bigint; v_afit_bps bigint; v_base bigint; v_comm bigint; v_afit bigint; v_line uuid; r record;
begin
  if new.to_status <> 'COMPLETED' then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if not found then return new; end if;
  v_comm_bps := app_private.setting_int('vendor_commission_bps', 450);
  v_afit_bps := app_private.setting_int('commission_afit_bps', 300);
  if v_afit_bps > v_comm_bps then raise exception 'commission settings invalid: afit share exceeds commission' using errcode = '22023'; end if;
  v_base := o.items_total_kobo - o.discount_kobo;
  v_comm := app_private.round_bps(v_base, v_comm_bps);
  v_afit := app_private.round_bps(v_base, v_afit_bps);
  if v_afit > v_comm then v_afit := v_comm; end if;
  insert into public.order_settlement_lines (order_id, vendor_id, base_kobo, commission_bps, afit_bps, paystack_budget_bps,
                                             commission_kobo, afit_allocation_kobo, paystack_allowance_kobo, delivery_fee_kobo)
    values (o.id, o.vendor_id, v_base, v_comm_bps, v_afit_bps, v_comm_bps - v_afit_bps, v_comm, v_afit, v_comm - v_afit, o.delivery_fee_kobo)
    on conflict (order_id) do nothing returning id into v_line;
  if v_line is not null then
    for r in select id from public.refunds where order_id = o.id and status = 'succeeded' order by created_at, id loop
      perform app_private.settle_refund(r.id);              -- refunds that succeeded before completion are applied now
    end loop;
  end if;
  return new;
end $$;
create trigger order_status_history_settle after insert on public.order_status_history
  for each row execute function app_private.settle_completed_order();

create function app_private.refunds_settle() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' then perform app_private.settle_refund(new.id); end if;
  return new;
end $$;
create trigger refunds_settle after update on public.refunds
  for each row execute function app_private.refunds_settle();

-- ---------------------------------------------------------------------------------------------
-- 5. Read functions (the only way the interface sees settlement data)
-- ---------------------------------------------------------------------------------------------
-- Paid orders that are not completed yet and have no line (kept in app_private so the public API never names order states).
create function app_private.vendor_pending_sales(p_vendor uuid) returns table (base bigint, n bigint)
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(o.items_total_kobo - o.discount_kobo), 0)::bigint, count(*)::bigint
    from public.orders o
   where o.vendor_id = p_vendor
     and o.status in ('PAID', 'VENDOR_REVIEW', 'ACCEPTED', 'PREPARING', 'READY', 'AWAITING_RIDER', 'RIDER_ASSIGNED', 'PICKED_UP_BY_RIDER',
                      'EN_ROUTE', 'ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF', 'DELIVERED', 'PICKUP_AWAITING_HANDOVER')
     and not exists (select 1 from public.order_settlement_lines x where x.order_id = o.id)
$$;

-- Vendor: their own shop only. Finalised = completed orders (immutable lines). Pending = paid, not yet completed, an ESTIMATE
-- at the current rate. Nothing here means money was paid: payouts are disabled.
create function public.vendor_settlement_summary(p_vendor uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_comm_bps bigint := app_private.setting_int('vendor_commission_bps', 450); v_pend_base bigint; v_pend_n bigint;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.is_vendor_member(p_vendor) then raise exception 'forbidden' using errcode = '42501'; end if;
  select p.base, p.n into v_pend_base, v_pend_n from app_private.vendor_pending_sales(p_vendor) p;
  return jsonb_build_object(
    'rates', jsonb_build_object('commission_bps', v_comm_bps),
    'finalised', (select jsonb_build_object(
        'orders', count(*),
        'gross_sales_kobo', coalesce(sum(l.base_kobo), 0),
        'commission_kobo', coalesce(sum(l.commission_kobo), 0),
        'refunded_sales_kobo', coalesce(sum(a.base), 0),
        'commission_reversed_kobo', coalesce(sum(a.comm), 0),
        'payable_kobo', coalesce(sum(l.base_kobo - l.commission_kobo - coalesce(a.base, 0) + coalesce(a.comm, 0)), 0),
        'delivery_fees_kobo', coalesce(sum(l.delivery_fee_kobo), 0))
      from public.order_settlement_lines l
      left join lateral (select sum(base_reversed_kobo) as base, sum(commission_reversed_kobo) as comm
                           from public.order_settlement_adjustments j where j.line_id = l.id) a on true
     where l.vendor_id = p_vendor),
    'pending', jsonb_build_object('orders', v_pend_n, 'gross_sales_kobo', v_pend_base,
                                  'estimated_commission_kobo', app_private.round_bps(v_pend_base, v_comm_bps),
                                  'note', 'Estimate at the current rate until each order is completed.'),
    'payout', jsonb_build_object('status', 'not_enabled', 'note', 'Payouts are not enabled. Amounts show what is calculated, not what has been paid.'),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
        'order_id', z.order_id, 'order_number', z.order_number, 'completed_at', z.created_at, 'gross_kobo', z.base_kobo,
        'commission_kobo', z.commission_kobo, 'commission_bps', z.commission_bps, 'refunded_kobo', z.rb, 'commission_reversed_kobo', z.rc,
        'payable_kobo', z.base_kobo - z.commission_kobo - z.rb + z.rc, 'delivery_fee_kobo', z.delivery_fee_kobo) order by z.created_at desc), '[]'::jsonb)
      from (select l.*, o.order_number,
                   coalesce((select sum(base_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id), 0) as rb,
                   coalesce((select sum(commission_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id), 0) as rc
              from public.order_settlement_lines l join public.orders o on o.id = l.order_id
             where l.vendor_id = p_vendor order by l.created_at desc limit 50) z));
end $$;

-- Finance and platform administrators: totals per vendor (bounded). No payout controls exist.
create function public.admin_settlement_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['finance_admin', 'platform_admin']::public.app_role[]);
  return jsonb_build_object(
    'note', 'Calculated amounts only. Payouts are disabled and nothing has been paid.',
    'totals', (select jsonb_build_object('orders', count(*), 'gross_sales_kobo', coalesce(sum(l.base_kobo), 0),
                 'commission_kobo', coalesce(sum(l.commission_kobo), 0), 'afit_allocation_kobo', coalesce(sum(l.afit_allocation_kobo), 0),
                 'paystack_budget_kobo', coalesce(sum(l.paystack_allowance_kobo), 0),
                 'commission_reversed_kobo', coalesce((select sum(commission_reversed_kobo) from public.order_settlement_adjustments), 0))
                 from public.order_settlement_lines l),
    'vendors', (select coalesce(jsonb_agg(jsonb_build_object('vendor_id', x.vendor_id, 'vendor_name', x.name, 'orders', x.n, 'gross_sales_kobo', x.base,
                 'commission_kobo', x.comm, 'payable_kobo', x.base - x.comm - x.rb + x.rc) order by x.base desc), '[]'::jsonb)
                from (select l.vendor_id, v.name, count(*) as n, sum(l.base_kobo) as base, sum(l.commission_kobo) as comm,
                             coalesce(sum((select sum(base_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id)), 0) as rb,
                             coalesce(sum((select sum(commission_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id)), 0) as rc
                        from public.order_settlement_lines l join public.vendors v on v.id = l.vendor_id
                       group by l.vendor_id, v.name order by sum(l.base_kobo) desc limit 100) x));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Privileges and RLS (same pattern as the other append-only financial tables)
-- ---------------------------------------------------------------------------------------------
do $$
declare t text; f text;
begin
  foreach t in array array['order_settlement_lines', 'order_settlement_adjustments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (app_private.is_aal2())', t || '_aal2', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  grant usage, select on all sequences in schema public to service_role;
  foreach f in array array['public.vendor_settlement_summary(uuid)', 'public.admin_settlement_overview()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['app_private.round_bps(bigint, bigint)', 'app_private.refund_item_base(uuid, int)', 'app_private.settle_refund(uuid)',
                           'app_private.settle_completed_order()', 'app_private.refunds_settle()', 'app_private.vendor_pending_sales(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
