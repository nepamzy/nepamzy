-- Automatic vendor payouts. Nothing here is switched on by a person: when an order is COMPLETED a payout is scheduled for
-- 24 hours later (setting payout_hold_hours). The customer has that time to report a problem. A scheduled job then pays the shop
-- what it is owed (sales - commission - refunds) with a Paystack transfer, unless a complaint or refund is still open.
-- ADDITIVE ONLY. Only orders completed after this migration get a payout: nothing is created for older (test) orders.
-- The application talks to Paystack; this file only keeps the books and decides what is due.

-- ---------------------------------------------------------------------------------------------
-- 1. Settings: the waiting time (hours) is an audited, bounded setting
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.setting_rule(p_key text) returns table (kind text, lo bigint, hi bigint, choices text[])
language sql immutable set search_path = ''
as $$
  select r.kind, r.lo, r.hi, r.choices from (values
    ('delivery_fee_kobo', 'int', 0::bigint, 1000000::bigint, null::text[]),
    ('platform_fee_bps', 'int', 0, 0, null),
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
    ('rider_terms_current_version', 'locked', null, null, null),
    ('payout_hold_hours', 'int', 1, 720, null)
  ) as r(key, kind, lo, hi, choices) where r.key = p_key
$$;
insert into public.platform_settings (key, value, note) values
  ('payout_hold_hours', '24'::jsonb, 'Owner-approved: hours after an order is completed before the shop is paid. The customer can report a problem during this time.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. The payout book: one row per completed order
-- ---------------------------------------------------------------------------------------------
alter table public.vendor_bank_accounts add column paystack_recipient_code text
  check (paystack_recipient_code is null or paystack_recipient_code ~ '^RCP_[A-Za-z0-9]{6,40}$');

create table public.vendor_payouts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  line_id uuid not null unique references public.order_settlement_lines (id) on delete restrict,
  status text not null default 'scheduled' check (status in ('scheduled', 'held', 'processing', 'paid', 'failed', 'skipped')),
  eligible_at timestamptz not null,
  amount_kobo bigint check (amount_kobo is null or amount_kobo >= 0),         -- worked out when the payout is claimed, after refunds
  attempts int not null default 0 check (attempts >= 0),
  reference text unique check (reference is null or reference ~ '^afitpo-[0-9a-f]{32}-[0-9]{1,3}$'),  -- one per attempt; the same one is reused after a crash so a transfer can never be sent twice
  transfer_code text check (transfer_code is null or char_length(transfer_code) <= 60),
  last_attempt_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_payouts_paid_shape check ((status = 'paid') = (paid_at is not null))
);
create index vendor_payouts_due_idx on public.vendor_payouts (eligible_at) where status in ('scheduled', 'held', 'failed', 'processing');
create index vendor_payouts_vendor_idx on public.vendor_payouts (vendor_id, created_at desc);
alter table public.vendor_payouts enable row level security;
revoke all on public.vendor_payouts from public, anon, authenticated;
grant all on public.vendor_payouts to service_role;

-- A payout is scheduled in the same transaction that completes the order (after the settlement line is written).
create function app_private.schedule_payout() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare l public.order_settlement_lines%rowtype;
begin
  if new.to_status <> 'COMPLETED' then return new; end if;
  select * into l from public.order_settlement_lines where order_id = new.order_id;
  if not found then return new; end if;
  insert into public.vendor_payouts (vendor_id, order_id, line_id, eligible_at)
    values (l.vendor_id, l.order_id, l.id, now() + make_interval(hours => app_private.setting_int('payout_hold_hours', 24)::int))
    on conflict (order_id) do nothing;
  return new;
end $$;
revoke all on function app_private.schedule_payout() from public, anon, authenticated;
-- fires after order_status_history_settle (triggers run in name order), so the settlement line already exists
create trigger order_status_history_zz_payout after insert on public.order_status_history
  for each row execute function app_private.schedule_payout();

-- ---------------------------------------------------------------------------------------------
-- 3. What the job may do (service role only)
-- ---------------------------------------------------------------------------------------------
-- Hands the job the payouts that are due. A complaint or refund that is still open HOLDS the payout (it is looked at again next run).
-- The amount is worked out here, from the books, never from the browser: sales - commission - refunded sales + commission given back.
create function public.payout_claim_due(p_limit int default 20)
returns table (o_id uuid, o_vendor uuid, o_amount bigint, o_reference text, o_attempts int, o_resume boolean)
language plpgsql security definer set search_path = ''
as $$
declare r public.vendor_payouts%rowtype; v_amount bigint; v_ref text; v_att int;
begin
  for r in
    select p.* from public.vendor_payouts p
     where p.eligible_at <= now()
       and (p.status in ('scheduled', 'held')
            or (p.status = 'failed' and p.attempts < 5 and p.last_attempt_at < now() - interval '6 hours')
            or (p.status = 'processing' and p.last_attempt_at < now() - interval '30 minutes'))
     order by p.eligible_at, p.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     for update skip locked
  loop
    if exists (select 1 from public.support_cases c where c.order_id = r.order_id and c.status in ('open', 'under_review'))
       or exists (select 1 from public.refunds f where f.order_id = r.order_id
                   and f.status in ('requested', 'under_review', 'approved', 'processing', 'reconciliation_required')) then
      if r.status <> 'held' then
        update public.vendor_payouts set status = 'held', updated_at = now() where id = r.id;
      end if;
      continue;
    end if;
    select l.base_kobo - l.commission_kobo
           - coalesce((select sum(j.base_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id), 0)
           + coalesce((select sum(j.commission_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id), 0)
      into v_amount from public.order_settlement_lines l where l.id = r.line_id;
    if coalesce(v_amount, 0) <= 0 then
      update public.vendor_payouts set status = 'skipped', amount_kobo = 0, updated_at = now() where id = r.id;
      continue;
    end if;
    if r.status = 'processing' then
      -- a run that stopped half way: ask Paystack about the SAME reference instead of starting a second transfer
      update public.vendor_payouts set amount_kobo = v_amount, last_attempt_at = now(), updated_at = now() where id = r.id;
      return query select r.id, r.vendor_id, v_amount, r.reference, r.attempts, true;
    else
      v_att := r.attempts + 1;
      v_ref := 'afitpo-' || replace(r.id::text, '-', '') || '-' || v_att::text;
      update public.vendor_payouts set status = 'processing', amount_kobo = v_amount, attempts = v_att, reference = v_ref,
             last_attempt_at = now(), last_error = null, updated_at = now() where id = r.id;
      return query select r.id, r.vendor_id, v_amount, v_ref, v_att, false;
    end if;
  end loop;
end $$;
revoke all on function public.payout_claim_due(int) from public, anon, authenticated;
grant execute on function public.payout_claim_due(int) to service_role;

-- Records what Paystack said. paid <- anything; failed <- processing/scheduled, or paid only when Paystack reversed the transfer.
create function public.payout_mark(p_reference text, p_status text, p_code text, p_error text) returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.vendor_payouts%rowtype;
begin
  if p_status not in ('paid', 'failed', 'processing') then raise exception 'invalid status' using errcode = '22023'; end if;
  select * into r from public.vendor_payouts where reference = p_reference for update;
  if not found then return 'unknown'; end if;
  if r.status = 'paid' and not (p_status = 'failed' and p_error = 'reversed') then return 'unchanged'; end if;
  update public.vendor_payouts set
      status = p_status,
      transfer_code = coalesce(nullif(left(p_code, 60), ''), transfer_code),
      last_error = case when p_status = 'paid' then null else nullif(left(p_error, 300), '') end,
      paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else null end,
      updated_at = now()
    where id = r.id;
  perform app_private.audit_write(null, 'payout.' || p_status, 'vendor_payout', r.id::text,
    jsonb_build_object('vendor_id', r.vendor_id, 'order_id', r.order_id, 'amount_kobo', r.amount_kobo, 'attempt', r.attempts));
  return p_status;
end $$;
revoke all on function public.payout_mark(text, text, text, text) from public, anon, authenticated;
grant execute on function public.payout_mark(text, text, text, text) to service_role;

create function public.payout_set_recipient(p_vendor uuid, p_code text) returns void
language sql security definer set search_path = ''
as $$ update public.vendor_bank_accounts set paystack_recipient_code = p_code where vendor_id = p_vendor $$;
revoke all on function public.payout_set_recipient(uuid, text) from public, anon, authenticated;
grant execute on function public.payout_set_recipient(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Who may look: a shop sees its own, finance and platform administrators see all (and can ask for another try)
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_payouts(p_status text default null, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['finance_admin', 'platform_admin']::public.app_role[]);
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) n from public.vendor_payouts group by status) s),
    'paid_kobo', (select coalesce(sum(amount_kobo), 0) from public.vendor_payouts where status = 'paid'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id, 'vendor_name', z.vendor_name, 'order_number', z.order_number, 'status', z.status, 'amount_kobo', z.amount_kobo,
        'eligible_at', z.eligible_at, 'attempts', z.attempts, 'last_error', z.last_error, 'paid_at', z.paid_at) order by z.eligible_at desc), '[]'::jsonb)
      from (select p.*, v.name as vendor_name, o.order_number
              from public.vendor_payouts p join public.vendors v on v.id = p.vendor_id join public.orders o on o.id = p.order_id
             where p_status is null or p.status = p_status
             order by p.eligible_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) z));
end $$;
revoke all on function public.admin_list_payouts(text, int) from public, anon;
grant execute on function public.admin_list_payouts(text, int) to authenticated, service_role;

create function public.admin_payout_retry(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid;
begin
  v_actor := app_private.require_staff(array['finance_admin', 'platform_admin']::public.app_role[]);
  update public.vendor_payouts set status = 'scheduled', eligible_at = now(), attempts = least(attempts, 4), last_error = null, updated_at = now()
   where id = p_id and status in ('failed', 'held');
  if not found then raise exception 'payout cannot be retried' using errcode = 'P0002'; end if;
  perform app_private.audit_write(v_actor, 'payout.retry_requested', 'vendor_payout', p_id::text, '{}'::jsonb);
end $$;
revoke all on function public.admin_payout_retry(uuid) from public, anon;
grant execute on function public.admin_payout_retry(uuid) to authenticated, service_role;

-- How many hours a customer has to report a problem (shown on the order pages).
create function public.payout_hold_hours() returns int
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return app_private.setting_int('payout_hold_hours', 24)::int;
end $$;
revoke all on function public.payout_hold_hours() from public, anon;
grant execute on function public.payout_hold_hours() to authenticated, service_role;

-- The shop's own earnings page now says what will happen and what has happened.
create or replace function public.vendor_settlement_summary(p_vendor uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_comm_bps bigint := app_private.setting_int('vendor_commission_bps', 450); v_pend_base bigint; v_pend_n bigint; v_hold int := app_private.setting_int('payout_hold_hours', 24)::int;
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
    'payout', jsonb_build_object(
        'status', 'automatic',
        'hold_hours', v_hold,
        'note', 'You are paid automatically ' || v_hold || ' hours after each order is completed, so the customer has time to report a problem. A complaint that is still open holds that payment until it is settled.',
        'scheduled_orders', (select count(*) from public.vendor_payouts where vendor_id = p_vendor and status in ('scheduled', 'processing')),
        'held_orders', (select count(*) from public.vendor_payouts where vendor_id = p_vendor and status = 'held'),
        'failed_orders', (select count(*) from public.vendor_payouts where vendor_id = p_vendor and status = 'failed'),
        'paid_orders', (select count(*) from public.vendor_payouts where vendor_id = p_vendor and status = 'paid'),
        'paid_kobo', (select coalesce(sum(amount_kobo), 0) from public.vendor_payouts where vendor_id = p_vendor and status = 'paid'),
        'next_at', (select min(eligible_at) from public.vendor_payouts where vendor_id = p_vendor and status in ('scheduled', 'processing', 'held'))),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
        'order_id', z.order_id, 'order_number', z.order_number, 'completed_at', z.created_at, 'gross_kobo', z.base_kobo,
        'commission_kobo', z.commission_kobo, 'commission_bps', z.commission_bps, 'refunded_kobo', z.rb, 'commission_reversed_kobo', z.rc,
        'payable_kobo', z.base_kobo - z.commission_kobo - z.rb + z.rc, 'delivery_fee_kobo', z.delivery_fee_kobo,
        'payout_status', z.payout_status, 'payout_at', z.payout_at) order by z.created_at desc), '[]'::jsonb)
      from (select l.*, o.order_number,
                   coalesce((select sum(base_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id), 0) as rb,
                   coalesce((select sum(commission_reversed_kobo) from public.order_settlement_adjustments j where j.line_id = l.id), 0) as rc,
                   (select p.status from public.vendor_payouts p where p.order_id = l.order_id) as payout_status,
                   (select coalesce(p.paid_at, p.eligible_at) from public.vendor_payouts p where p.order_id = l.order_id) as payout_at
              from public.order_settlement_lines l join public.orders o on o.id = l.order_id
             where l.vendor_id = p_vendor order by l.created_at desc limit 50) z));
end $$;

-- the finance overview no longer says payouts are disabled
create or replace function public.admin_settlement_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['finance_admin', 'platform_admin']::public.app_role[]);
  return jsonb_build_object(
    'note', 'Calculated amounts. Shops are paid automatically after the waiting time; see the Payouts page for what has been paid.',
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
-- 5. Job monitoring knows about the new job (a daily scheduler is expected to call it)
-- ---------------------------------------------------------------------------------------------
alter table public.job_runs drop constraint if exists job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check
  check (job in ('expire-orders', 'purge-location', 'process-notifications', 'release-payouts', 'dispatch-notifications'));
create or replace function app_private.job_expectations() returns table (job text, max_age_minutes int)
language sql immutable set search_path = ''
as $$ select * from (values ('expire-orders', 1560), ('process-notifications', 1560), ('purge-location', 1560), ('release-payouts', 1560)) as v(job, max_age_minutes) $$;
