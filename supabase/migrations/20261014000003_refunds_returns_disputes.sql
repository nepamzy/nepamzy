-- Batch 5, Phase 10: refunds, returns, disputes and support cases.
-- Principles enforced HERE (not in the browser):
--   * a refund REQUEST, its APPROVAL and its PROVIDER EXECUTION are three separate steps with their own permissions;
--     nothing in this release talks to a real provider (only a clearly labelled FAKE mode exists) and no real money moves;
--   * cumulative refunds can never exceed what the ledger shows as received (function lock + trigger lock + check),
--     item quantities can never exceed what was bought, and a refund can only move along legal state transitions;
--   * a return is a different record from a refund (a return is never proof that money moved) and nothing is restocked;
--   * a dispute never edits the original delivery proof; decisions carry a maker, a reason and a timestamp;
--   * no automatic guilt decisions: GPS or a missing location update never decides a case.

-- ---------------------------------------------------------------------------------------------
-- Settings (placeholders / owner decisions)
-- ---------------------------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('refund_fee_policy', '"none"'::jsonb,
   'OWNER DECISION: "none" refunds item prices only (net of discount); "proportional_service_fee" also refunds a pro-rata share of the service fee. The delivery fee is only refunded in a full refund.'),
  ('refund_support_approval_limit_kobo', '0'::jsonb,
   'PLACEHOLDER: support agents may approve refunds up to this amount; 0 means only finance/admin may approve.'),
  ('return_policy', '{"default": "case_by_case", "categories": {}}'::jsonb,
   'OWNER DECISION: per shop-category return rule: returnable | not_returnable | case_by_case. No food/hygiene rule is invented here.')
on conflict (key) do nothing;

create or replace function public.set_platform_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_n bigint;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_key = 'settlement_policy' and p_value is distinct from '"DISABLED"'::jsonb then
    raise exception 'settlement_policy is locked to DISABLED pending provider and legal approval' using errcode = '42501';
  end if;
  if p_key = 'mock_payments_enabled' then
    raise exception 'mock_payments_enabled can only be changed with direct database access' using errcode = '42501';
  end if;
  if p_key = 'typed_signature_enabled' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'invalid value for %', p_key using errcode = '22023';
  end if;
  if p_key = 'refund_fee_policy' and (jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('none', 'proportional_service_fee')) then
    raise exception 'invalid value for %', p_key using errcode = '22023';
  end if;
  if p_key = 'return_policy' then
    if jsonb_typeof(p_value) <> 'object' or jsonb_typeof(p_value -> 'default') is distinct from 'string'
       or (p_value ->> 'default') not in ('returnable', 'not_returnable', 'case_by_case')
       or (p_value ? 'categories' and jsonb_typeof(p_value -> 'categories') <> 'object') then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
    if p_value ? 'categories' and exists (select 1 from jsonb_each(p_value -> 'categories') e
                                           where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') not in ('returnable', 'not_returnable', 'case_by_case')) then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
  end if;
  if p_key in ('delivery_fee_kobo', 'platform_fee_bps', 'unpaid_order_expiry_minutes', 'max_cart_item_quantity',
               'handover_token_ttl_minutes', 'location_max_accuracy_m', 'location_max_age_seconds',
               'location_min_interval_seconds', 'location_stale_after_seconds', 'arrival_max_accuracy_m',
               'arrival_max_age_seconds', 'default_geofence_radius_m', 'location_history_retention_hours', 'delivery_proof_ttl_minutes', 'refund_support_approval_limit_kobo') then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,9}$' then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
    v_n := (p_value #>> '{}')::bigint;
    if (p_key = 'delivery_fee_kobo' and v_n > 1000000) or (p_key = 'platform_fee_bps' and v_n > 3000)
       or (p_key = 'unpaid_order_expiry_minutes' and v_n not between 5 and 1440)
       or (p_key = 'max_cart_item_quantity' and v_n not between 1 and 100)
       or (p_key = 'handover_token_ttl_minutes' and v_n not between 5 and 720)
       or (p_key = 'location_max_accuracy_m' and v_n not between 5 and 500)
       or (p_key = 'location_max_age_seconds' and v_n not between 5 and 600)
       or (p_key = 'location_min_interval_seconds' and v_n not between 1 and 60)
       or (p_key = 'location_stale_after_seconds' and v_n not between 10 and 600)
       or (p_key = 'arrival_max_accuracy_m' and v_n not between 5 and 200)
       or (p_key = 'arrival_max_age_seconds' and v_n not between 5 and 120)
       or (p_key = 'default_geofence_radius_m' and v_n not between 10 and 500)
       or (p_key = 'location_history_retention_hours' and v_n not between 1 and 720)
       or (p_key = 'delivery_proof_ttl_minutes' and v_n not between 5 and 120)
       or (p_key = 'refund_support_approval_limit_kobo' and v_n > 100000000) then
      raise exception 'value out of range for %', p_key using errcode = '22023';
    end if;
  end if;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, v_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform app_private.audit_write(v_actor, 'setting.changed', 'platform_setting', p_key, jsonb_build_object('value', p_value));
end $$;

alter table public.reconciliation_flags drop constraint reconciliation_flags_reason_check;
alter table public.reconciliation_flags add constraint reconciliation_flags_reason_check check (reason in (
  'amount_mismatch', 'late_payment', 'duplicate_payment', 'unknown_reference', 'vendor_rejected_paid_order',
  'refund_outcome_unknown', 'refund_outcome_conflict'));

-- ---------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------
create function app_private.require_staff(p_roles public.app_role[]) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_any_role(p_roles) then raise exception 'forbidden' using errcode = '42501'; end if;
  return v_actor;
end $$;

create function app_private.order_received(p_order uuid) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(amount_kobo), 0)::bigint from public.ledger_entries where order_id = p_order and entry_type = 'payment_received' $$;

-- Refunds that still count against the cap (everything except rejected and failed).
create function app_private.refund_active_total(p_order uuid, p_except uuid default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount_kobo), 0)::bigint from public.refunds
   where order_id = p_order and (p_except is null or id <> p_except)
     and status in ('requested', 'under_review', 'approved', 'processing', 'succeeded', 'reconciliation_required')
$$;

-- Moves the order only if it is currently in one of the expected states (never forces a state).
create function app_private.try_step_order(p_order uuid, p_from text[], p_to text, p_actor uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_cur text;
begin
  select status into v_cur from public.orders where id = p_order;
  if v_cur is null or not (v_cur = any (p_from)) then return false; end if;
  perform app_private.step_order(p_order, v_cur, p_to, p_actor, p_reason);
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Refunds: richer state machine on the existing table
-- ---------------------------------------------------------------------------------------------
alter table public.refunds drop constraint refunds_status_check;
update public.refunds set status = 'processing' where status = 'pending';
update public.refunds set status = 'succeeded' where status = 'processed';
alter table public.refunds add constraint refunds_status_check check (status in (
  'requested', 'under_review', 'approved', 'rejected', 'processing', 'succeeded', 'failed', 'reconciliation_required'));
alter table public.refunds
  add column source text not null default 'finance' check (source in ('customer', 'finance', 'case')),
  add column case_id uuid,
  add column idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 80),
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add column decided_by uuid,
  add column decided_at timestamptz,
  add column decision_reason text,
  add column provider_mode text not null default 'none' check (provider_mode in ('none', 'fake', 'paystack_test', 'paystack_live')),
  add column executed_by uuid,
  add column executed_at timestamptz,
  add column outcome_at timestamptz,
  add column outcome_detail text;
create unique index refunds_idempotency_uq on public.refunds (requested_by, idempotency_key) where idempotency_key is not null;
create unique index refunds_provider_ref_uq on public.refunds (provider_refund_ref) where provider_refund_ref is not null;
alter table public.refunds add constraint refunds_decision_shape check ((status in ('requested', 'under_review')) = (decided_at is null));
alter table public.refunds add constraint refunds_success_has_ref check (status <> 'succeeded' or provider_refund_ref is not null);

alter table public.ledger_entries add column refund_id uuid references public.refunds (id) on delete restrict;
create unique index ledger_one_refund_paid on public.ledger_entries (refund_id) where entry_type = 'refund_paid';

create table public.refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  quantity int not null check (quantity between 1 and 100),
  amount_kobo bigint not null check (amount_kobo > 0),
  unique (refund_id, order_item_id)
);
create trigger refund_items_immutable before update or delete on public.refund_items
  for each row execute function app_private.deny_mutation();

-- Append-only record of every step (staff only).
create table public.refund_events (
  id bigint generated always as identity primary key,
  refund_id uuid not null references public.refunds (id) on delete restrict,
  actor_id uuid,
  action text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);
create index refund_events_refund_idx on public.refund_events (refund_id);
create trigger refund_events_append_only before update or delete on public.refund_events
  for each row execute function app_private.deny_mutation();

create function app_private.refund_log(p_refund uuid, p_actor uuid, p_action text, p_from text, p_to text, p_note text) returns void
language sql security definer set search_path = ''
as $$ insert into public.refund_events (refund_id, actor_id, action, from_status, to_status, note) values (p_refund, p_actor, p_action, p_from, p_to, left(p_note, 500)) $$;

-- BACKSTOP 1 (amount): whatever path inserts or updates a refund, the order row is locked and the cap is re-checked.
create function app_private.refunds_cap_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status in ('requested', 'under_review', 'approved', 'processing', 'succeeded', 'reconciliation_required') then
    perform 1 from public.orders where id = new.order_id for update;
    if new.amount_kobo + app_private.refund_active_total(new.order_id, new.id) > app_private.order_received(new.order_id) then
      raise exception 'refund_exceeds_received' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger refunds_cap before insert or update on public.refunds for each row execute function app_private.refunds_cap_guard();

-- BACKSTOP 2 (state machine): only legal transitions, and the core facts never change.
create function app_private.refunds_state_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.amount_kobo <> old.amount_kobo or new.order_id <> old.order_id or new.requested_by <> old.requested_by then
    raise exception 'refund_core_immutable' using errcode = '42501';
  end if;
  if new.status = old.status then return new; end if;
  if not ((old.status, new.status) in (
      ('requested', 'under_review'), ('requested', 'approved'), ('requested', 'rejected'),
      ('under_review', 'approved'), ('under_review', 'rejected'),
      ('approved', 'processing'),
      ('processing', 'succeeded'), ('processing', 'failed'), ('processing', 'reconciliation_required'),
      ('reconciliation_required', 'succeeded'), ('reconciliation_required', 'failed'))) then
    raise exception 'refund_invalid_transition' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger refunds_state before update on public.refunds for each row execute function app_private.refunds_state_guard();

-- BACKSTOP 3 (quantity): item quantities across live refunds never exceed what was bought.
create function app_private.refund_items_cap_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_order uuid; v_bought int; v_used int;
begin
  select order_id into v_order from public.refunds where id = new.refund_id;
  perform 1 from public.orders where id = v_order for update;
  select quantity into v_bought from public.order_items where id = new.order_item_id and order_id = v_order;
  if v_bought is null then raise exception 'refund_invalid_item' using errcode = '22023'; end if;
  select coalesce(sum(ri.quantity), 0) into v_used from public.refund_items ri join public.refunds r on r.id = ri.refund_id
   where ri.order_item_id = new.order_item_id and ri.id <> new.id
     and r.status in ('requested', 'under_review', 'approved', 'processing', 'succeeded', 'reconciliation_required');
  if v_used + new.quantity > v_bought then raise exception 'refund_quantity_exceeds_purchased' using errcode = '22023'; end if;
  return new;
end $$;
create trigger refund_items_cap before insert on public.refund_items for each row execute function app_private.refund_items_cap_guard();

-- Item amount: price x quantity, less its share of any order discount, plus (if the owner chose it) a share of the service fee.
create function app_private.refund_item_amount(p_item uuid, p_qty int) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare i public.order_items%rowtype; o public.orders%rowtype; v_gross bigint; v_disc bigint; v_net bigint; v_fee bigint := 0;
begin
  select * into i from public.order_items where id = p_item;
  select * into o from public.orders where id = i.order_id;
  v_gross := i.unit_price_kobo * p_qty;
  v_disc := case when o.items_total_kobo > 0 then (v_gross * o.discount_kobo) / o.items_total_kobo else 0 end;
  v_net := v_gross - v_disc;
  if (select (s.value #>> '{}') from public.platform_settings s where s.key = 'refund_fee_policy') = 'proportional_service_fee'
     and o.items_total_kobo - o.discount_kobo > 0 then
    v_fee := (o.platform_fee_kobo * v_net) / (o.items_total_kobo - o.discount_kobo);
  end if;
  return v_net + v_fee;
end $$;

-- Core creation used by customers, finance and case decisions. Primary control: the order-row lock.
create function app_private.create_refund(p_order uuid, p_actor uuid, p_source text, p_items jsonb, p_reason text,
                                          p_key text, p_case uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_existing public.refunds%rowtype; v_amount bigint := 0; v_id uuid; v_item jsonb; v_oi uuid; v_q int; v_a bigint; v_balance bigint;
begin
  perform app_private.lock_order_row(p_order);
  if p_key is not null then
    select * into v_existing from public.refunds where requested_by = p_actor and idempotency_key = p_key;
    if found then
      if v_existing.order_id <> p_order then raise exception 'idempotency_conflict' using errcode = '23505'; end if;
      return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'amount_kobo', v_existing.amount_kobo, 'replayed', true);
    end if;
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  v_balance := app_private.order_received(p_order) - app_private.refund_active_total(p_order);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    v_amount := v_balance; -- everything still refundable
  else
    if jsonb_array_length(p_items) > 50 then raise exception 'refund_invalid_item' using errcode = '22023'; end if;
    for v_item in select * from jsonb_array_elements(p_items) loop
      begin
        v_oi := (v_item ->> 'order_item_id')::uuid;
        v_q := (v_item ->> 'quantity')::int;
      exception when others then
        raise exception 'refund_invalid_item' using errcode = '22023';
      end;
      if v_q is null or v_q < 1 then raise exception 'refund_invalid_item' using errcode = '22023'; end if;
      if not exists (select 1 from public.order_items where id = v_oi and order_id = p_order) then
        raise exception 'refund_invalid_item' using errcode = '22023';
      end if;
      v_amount := v_amount + app_private.refund_item_amount(v_oi, v_q);
    end loop;
  end if;
  if v_amount <= 0 then raise exception 'nothing_to_refund' using errcode = '22023'; end if;
  if v_amount > v_balance then raise exception 'refund_exceeds_received' using errcode = '22023'; end if;
  perform app_private.test_seam('refund_after_balance_check');
  insert into public.refunds (order_id, transaction_id, amount_kobo, reason, requested_by, source, case_id, idempotency_key)
    values (p_order, (select transaction_id from public.ledger_entries where order_id = p_order and entry_type = 'payment_received' order by id limit 1),
            v_amount, btrim(p_reason), p_actor, p_source, p_case, p_key)
    returning id into v_id;
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_oi := (v_item ->> 'order_item_id')::uuid; v_q := (v_item ->> 'quantity')::int;
      v_a := app_private.refund_item_amount(v_oi, v_q);
      insert into public.refund_items (refund_id, order_item_id, quantity, amount_kobo) values (v_id, v_oi, v_q, v_a);
    end loop;
  end if;
  perform app_private.refund_log(v_id, p_actor, 'requested', null, 'requested', p_source || ': ' || btrim(p_reason));
  perform app_private.audit_write(p_actor, 'refund.requested', 'order', p_order::text,
    jsonb_build_object('refund', v_id, 'amount_kobo', v_amount, 'source', p_source));
  return jsonb_build_object('id', v_id, 'status', 'requested', 'amount_kobo', v_amount, 'replayed', false);
end $$;

-- The Batch 3 finance entry point keeps its name and cap message; it now goes through the same core.
create or replace function public.refund_request(p_order uuid, p_amount bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_finance(); v_id uuid; v_received bigint;
begin
  perform app_private.lock_order_row(p_order);
  v_received := app_private.order_received(p_order);
  if p_amount is null or p_amount <= 0 or p_amount > v_received - app_private.refund_active_total(p_order) then
    raise exception 'refund_exceeds_received' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  perform app_private.test_seam('refund_after_balance_check');
  insert into public.refunds (order_id, transaction_id, amount_kobo, reason, requested_by, source)
    values (p_order, (select transaction_id from public.ledger_entries where order_id = p_order and entry_type = 'payment_received' order by id limit 1),
            p_amount, left(btrim(p_reason), 500), v_actor, 'finance') returning id into v_id;
  perform app_private.refund_log(v_id, v_actor, 'requested', null, 'requested', 'finance: ' || left(btrim(p_reason), 200));
  perform app_private.audit_write(v_actor, 'refund.requested', 'order', p_order::text,
    jsonb_build_object('refund', v_id, 'amount_kobo', p_amount, 'source', 'finance'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Refund workflow functions
-- ---------------------------------------------------------------------------------------------
create function public.customer_request_refund(p_order uuid, p_items jsonb, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if v_o.status not in ('COMPLETED', 'DELIVERED', 'CANCELLED', 'DISPUTED', 'RETURN_REQUESTED', 'RETURN_IN_PROGRESS',
                        'RETURNED_TO_VENDOR', 'PARTIALLY_REFUNDED', 'REFUND_PENDING') then
    raise exception 'order_not_refundable' using errcode = '22023';
  end if;
  if app_private.order_received(p_order) <= 0 then raise exception 'order_not_refundable' using errcode = '22023'; end if;
  return app_private.create_refund(p_order, v_actor, 'customer', p_items, p_reason, p_key, null);
end $$;

create function public.refund_start_review(p_refund uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'finance_admin', 'platform_admin']::public.app_role[]);
        v_r public.refunds%rowtype;
begin
  select * into v_r from public.refunds where id = p_refund for update;
  if not found then raise exception 'unknown refund' using errcode = 'P0002'; end if;
  if v_r.requested_by = v_actor then raise exception 'cannot review your own request' using errcode = '42501'; end if;
  if v_r.status <> 'requested' then raise exception 'refund_invalid_transition' using errcode = '22023'; end if;
  update public.refunds set status = 'under_review', reviewed_by = v_actor, reviewed_at = now() where id = p_refund;
  perform app_private.refund_log(p_refund, v_actor, 'review_started', 'requested', 'under_review', p_note);
end $$;

create function public.refund_decide(p_refund uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'finance_admin', 'platform_admin']::public.app_role[]);
        v_r public.refunds%rowtype; v_limit bigint := app_private.setting_int('refund_support_approval_limit_kobo', 0);
begin
  if p_decision not in ('approve', 'reject') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v_r from public.refunds where id = p_refund for update;
  if not found then raise exception 'unknown refund' using errcode = 'P0002'; end if;
  if v_r.requested_by = v_actor then raise exception 'cannot decide your own request' using errcode = '42501'; end if;
  if v_r.status not in ('requested', 'under_review') then raise exception 'refund_invalid_transition' using errcode = '22023'; end if;
  if p_decision = 'approve'
     and not (app_private.has_any_role(array['finance_admin', 'platform_admin']::public.app_role[])
              or (app_private.has_role('support_agent') and v_r.amount_kobo <= v_limit)) then
    raise exception 'forbidden' using errcode = '42501'; -- approving money movement is finance's call (or support within the configured limit)
  end if;
  update public.refunds set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
         decided_by = v_actor, decided_at = now(), decision_reason = btrim(p_reason) where id = p_refund;
  perform app_private.refund_log(p_refund, v_actor, p_decision, v_r.status, case p_decision when 'approve' then 'approved' else 'rejected' end, p_reason);
  perform app_private.audit_write(v_actor, case p_decision when 'approve' then 'refund.approved' else 'refund.rejected' end, 'order', v_r.order_id::text,
    jsonb_build_object('refund', p_refund, 'amount_kobo', v_r.amount_kobo));
end $$;

-- Approval is NOT execution. Execution is a separate, finance-only step; only the FAKE mode exists in this release.
create function public.refund_begin_execution(p_refund uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_finance(); v_r public.refunds%rowtype;
begin
  if p_mode is distinct from 'fake' then raise exception 'provider_not_enabled' using errcode = '42501'; end if;
  select * into v_r from public.refunds where id = p_refund for update;
  if not found then raise exception 'unknown refund' using errcode = 'P0002'; end if;
  if v_r.requested_by = v_actor then raise exception 'cannot execute your own request' using errcode = '42501'; end if;
  if v_r.status <> 'approved' then raise exception 'refund_invalid_transition' using errcode = '22023'; end if;
  update public.refunds set status = 'processing', provider_mode = p_mode, executed_by = v_actor, executed_at = now() where id = p_refund;
  perform app_private.refund_log(p_refund, v_actor, 'execution_started', 'approved', 'processing', 'mode: ' || p_mode || ' (no real money moves)');
  return jsonb_build_object('id', p_refund, 'amount_kobo', v_r.amount_kobo, 'mode', p_mode);
end $$;

-- Shared by the finance session and the (service-only) provider-event path. Idempotent for the same outcome.
create function app_private.refund_outcome_core(p_refund uuid, p_outcome text, p_ref text, p_detail text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r public.refunds%rowtype; v_received bigint; v_paid bigint;
begin
  if p_outcome not in ('succeeded', 'failed', 'unknown') then raise exception 'invalid outcome' using errcode = '22023'; end if;
  select * into v_r from public.refunds where id = p_refund for update;
  if not found then raise exception 'unknown refund' using errcode = 'P0002'; end if;
  perform app_private.lock_order_row(v_r.order_id);
  if v_r.status in ('succeeded', 'failed') then
    if (p_outcome = 'succeeded' and v_r.status = 'succeeded' and (p_ref is null or p_ref = v_r.provider_refund_ref))
       or (p_outcome = 'failed' and v_r.status = 'failed') or p_outcome = 'unknown' then
      return jsonb_build_object('ok', true, 'replayed', true, 'status', v_r.status);
    end if;
    insert into public.reconciliation_flags (order_id, reason, details)
      values (v_r.order_id, 'refund_outcome_conflict', jsonb_build_object('refund', p_refund, 'had', v_r.status, 'reported', p_outcome));
    perform app_private.refund_log(p_refund, p_actor, 'conflicting_outcome', v_r.status, v_r.status, 'reported: ' || p_outcome);
    return jsonb_build_object('ok', false, 'conflict', true, 'status', v_r.status);
  end if;
  if v_r.status not in ('processing', 'reconciliation_required') then raise exception 'refund_invalid_transition' using errcode = '22023'; end if;
  if p_outcome = 'unknown' then
    if v_r.status = 'reconciliation_required' then return jsonb_build_object('ok', true, 'replayed', true, 'status', v_r.status); end if;
    update public.refunds set status = 'reconciliation_required', outcome_at = now(), outcome_detail = left(p_detail, 300) where id = p_refund;
    insert into public.reconciliation_flags (order_id, reason, details)
      values (v_r.order_id, 'refund_outcome_unknown', jsonb_build_object('refund', p_refund));
    perform app_private.refund_log(p_refund, p_actor, 'outcome_unknown', v_r.status, 'reconciliation_required', p_detail);
    return jsonb_build_object('ok', true, 'status', 'reconciliation_required');
  end if;
  if p_outcome = 'failed' then
    update public.refunds set status = 'failed', outcome_at = now(), outcome_detail = left(p_detail, 300) where id = p_refund;
    perform app_private.refund_log(p_refund, p_actor, 'failed', v_r.status, 'failed', p_detail);
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
  if p_ref is null or char_length(btrim(p_ref)) < 3 then raise exception 'provider_reference_required' using errcode = '22023'; end if;
  update public.refunds set status = 'succeeded', provider_refund_ref = btrim(p_ref), outcome_at = now(), outcome_detail = left(p_detail, 300)
   where id = p_refund;
  insert into public.ledger_entries (order_id, transaction_id, entry_type, amount_kobo, refund_id)
    values (v_r.order_id, v_r.transaction_id, 'refund_paid', v_r.amount_kobo, p_refund);
  perform app_private.refund_log(p_refund, p_actor, 'succeeded', v_r.status, 'succeeded', 'provider ref ' || btrim(p_ref) || ' (' || v_r.provider_mode || ')');
  -- the order shows the money position, but only for orders that finished their journey (never forces other states)
  v_received := app_private.order_received(v_r.order_id);
  select coalesce(sum(amount_kobo), 0) into v_paid from public.ledger_entries where order_id = v_r.order_id and entry_type = 'refund_paid';
  perform app_private.try_step_order(v_r.order_id, array['COMPLETED', 'DELIVERED', 'DISPUTED', 'RETURNED_TO_VENDOR', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'],
    case when v_paid >= v_received then 'REFUNDED' else 'PARTIALLY_REFUNDED' end, p_actor, 'refund_succeeded');
  return jsonb_build_object('ok', true, 'status', 'succeeded');
end $$;

create function public.refund_record_outcome(p_refund uuid, p_outcome text, p_provider_ref text, p_detail text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_finance();
begin
  return app_private.refund_outcome_core(p_refund, p_outcome, p_provider_ref, p_detail, v_actor);
end $$;

-- Service role only: the path a verified provider event would use (not wired to any real provider).
create function public.refund_provider_outcome(p_refund uuid, p_outcome text, p_provider_ref text, p_detail text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  return app_private.refund_outcome_core(p_refund, p_outcome, p_provider_ref, p_detail, null);
end $$;

create function public.refund_reconcile(p_refund uuid, p_resolution text, p_provider_ref text, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_finance(); v_r public.refunds%rowtype; v_res jsonb;
begin
  if p_resolution not in ('succeeded', 'failed') then raise exception 'invalid outcome' using errcode = '22023'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_r from public.refunds where id = p_refund for update;
  if not found then raise exception 'unknown refund' using errcode = 'P0002'; end if;
  if v_r.status <> 'reconciliation_required' then raise exception 'refund_invalid_transition' using errcode = '22023'; end if;
  v_res := app_private.refund_outcome_core(p_refund, p_resolution, p_provider_ref, 'reconciled: ' || btrim(p_note), v_actor);
  update public.reconciliation_flags set resolved_at = now(), resolved_by = v_actor, resolution_note = left(btrim(p_note), 300)
   where reason = 'refund_outcome_unknown' and resolved_at is null and details ->> 'refund' = p_refund::text;
  perform app_private.audit_write(v_actor, 'refund.reconciled', 'order', v_r.order_id::text, jsonb_build_object('refund', p_refund, 'resolution', p_resolution));
  return v_res;
end $$;

create function public.staff_list_refunds(p_status text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'finance_admin', 'platform_admin']::public.app_role[]);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'order_id', r.order_id, 'order_number', o.order_number, 'amount_kobo', r.amount_kobo, 'status', r.status,
      'reason', r.reason, 'source', r.source, 'provider_mode', r.provider_mode, 'created_at', r.created_at,
      'decision_reason', r.decision_reason, 'own_request', r.requested_by = v_actor,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', oi.product_name, 'quantity', ri.quantity, 'amount_kobo', ri.amount_kobo)), '[]'::jsonb)
                  from public.refund_items ri join public.order_items oi on oi.id = ri.order_item_id where ri.refund_id = r.id),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'to', e.to_status, 'note', e.note, 'at', e.created_at) order by e.id), '[]'::jsonb)
                   from public.refund_events e where e.refund_id = r.id))
      order by r.created_at desc), '[]'::jsonb)
    from public.refunds r join public.orders o on o.id = r.order_id
   where p_status is null or r.status = p_status);
end $$;

create function public.my_order_refunds(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not exists (select 1 from public.orders where id = p_order and customer_id = v_actor) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'refundable_kobo', greatest(0, app_private.order_received(p_order) - app_private.refund_active_total(p_order)),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount_kobo', r.amount_kobo, 'status', r.status, 'reason', r.reason,
                  'decision_reason', r.decision_reason, 'provider_mode', r.provider_mode, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                from public.refunds r where r.order_id = p_order));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Support cases (disputes)
-- ---------------------------------------------------------------------------------------------
create sequence public.support_case_seq start 1000;
create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique default ('CASE-' || nextval('public.support_case_seq')::text),
  order_id uuid not null references public.orders (id) on delete restrict,
  reporter_id uuid not null references auth.users (id) on delete restrict,
  case_type text not null check (case_type in ('missing_item', 'wrong_item', 'damaged', 'not_received', 'quality', 'delivery_problem', 'other')),
  description text not null check (char_length(description) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'under_review', 'decided', 'closed')),
  assigned_to uuid references auth.users (id) on delete set null,
  decision text check (decision in ('full_refund', 'partial_refund', 'replacement', 'return', 'reject', 'no_action')),
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 10 and 1000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  closed_at timestamptz,
  prior_order_status text,
  opened_by_staff uuid references auth.users (id) on delete set null,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_cases_decision_shape check ((decision is null) = (decided_at is null) and (decision is null) = (decision_reason is null))
);
create unique index support_cases_one_open on public.support_cases (order_id, case_type) where status in ('open', 'under_review');
create unique index support_cases_idem on public.support_cases (reporter_id, idempotency_key) where idempotency_key is not null;
create index support_cases_status_idx on public.support_cases (status, created_at);
create trigger support_cases_touch before update on public.support_cases for each row execute function app_private.touch_updated_at();
alter table public.refunds add constraint refunds_case_fk foreign key (case_id) references public.support_cases (id) on delete restrict;

create table public.case_statements (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.support_cases (id) on delete restrict,
  author_id uuid not null references auth.users (id) on delete restrict,
  party text not null check (party in ('customer', 'vendor', 'rider', 'support')),
  visibility text not null default 'parties' check (visibility in ('parties', 'internal')),
  body text not null check (char_length(body) between 3 and 1000),
  created_at timestamptz not null default now(),
  constraint case_statements_internal_support check (visibility = 'parties' or party = 'support')
);
create index case_statements_case_idx on public.case_statements (case_id, id);
create trigger case_statements_append_only before update or delete on public.case_statements for each row execute function app_private.deny_mutation();

create table public.case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.support_cases (id) on delete restrict,
  actor_id uuid,
  action text not null,
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);
create index case_events_case_idx on public.case_events (case_id, id);
create trigger case_events_append_only before update or delete on public.case_events for each row execute function app_private.deny_mutation();

create function app_private.case_log(p_case uuid, p_actor uuid, p_action text, p_from text, p_to text, p_note text) returns void
language sql security definer set search_path = ''
as $$ insert into public.case_events (case_id, actor_id, action, from_status, to_status, note) values (p_case, p_actor, p_action, p_from, p_to, left(p_note, 500)) $$;

-- Opened by the customer for their own paid order. Completed orders are flagged DISPUTED (restored when the case closes).
create function public.open_support_case(p_order uuid, p_type text, p_description text, p_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_ex public.support_cases%rowtype; v_id uuid; v_no text; v_prior text;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if p_key is not null then
    select * into v_ex from public.support_cases where reporter_id = v_actor and idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_ex.id, 'case_no', v_ex.case_no, 'replayed', true); end if;
  end if;
  if v_o.status in ('PENDING_PAYMENT') then raise exception 'order_not_refundable' using errcode = '22023'; end if;
  if p_type not in ('missing_item', 'wrong_item', 'damaged', 'not_received', 'quality', 'delivery_problem', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if p_description is null or char_length(btrim(p_description)) < 10 or char_length(p_description) > 1000 then
    raise exception 'description_required' using errcode = '22023';
  end if;
  if (select count(*) from public.support_cases c where c.reporter_id = v_actor and c.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_cases' using errcode = '22023';
  end if;
  v_prior := v_o.status;
  begin
    insert into public.support_cases (order_id, reporter_id, case_type, description, prior_order_status, idempotency_key)
      values (p_order, v_actor, p_type, btrim(p_description), v_prior, p_key) returning id, case_no into v_id, v_no;
  exception when unique_violation then
    raise exception 'case_already_open' using errcode = '23505';
  end;
  perform app_private.try_step_order(p_order, array['COMPLETED', 'DELIVERED'], 'DISPUTED', v_actor, 'case_opened:' || v_no);
  perform app_private.case_log(v_id, v_actor, 'opened', null, 'open', p_type);
  perform app_private.audit_write(v_actor, 'case.opened', 'order', p_order::text, jsonb_build_object('case', v_id, 'type', p_type));
  return jsonb_build_object('id', v_id, 'case_no', v_no, 'replayed', false);
end $$;

create function app_private.case_party(p_case uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); c public.support_cases%rowtype; o public.orders%rowtype;
begin
  select * into c from public.support_cases where id = p_case;
  if not found then return null; end if;
  if app_private.has_any_role(array['support_agent', 'platform_admin']::public.app_role[]) then return 'support'; end if;
  if c.reporter_id = v_actor then return 'customer'; end if;
  select * into o from public.orders where id = c.order_id;
  if app_private.is_vendor_member(o.vendor_id) then return 'vendor'; end if;
  if exists (select 1 from public.delivery_assignments d where d.order_id = c.order_id and d.rider_id = v_actor) then return 'rider'; end if;
  return null;
end $$;

create function public.case_add_statement(p_case uuid, p_body text, p_internal boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_party text; c public.support_cases%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  v_party := app_private.case_party(p_case);
  if v_party is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.support_cases where id = p_case for update;
  if c.status = 'closed' then raise exception 'case_closed' using errcode = '22023'; end if;
  if p_body is null or char_length(btrim(p_body)) < 3 or char_length(p_body) > 1000 then raise exception 'statement_required' using errcode = '22023'; end if;
  if coalesce(p_internal, false) and v_party <> 'support' then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from public.case_statements s where s.case_id = p_case and s.author_id = v_actor) >= 20 then
    raise exception 'too_many_statements' using errcode = '22023';
  end if;
  insert into public.case_statements (case_id, author_id, party, visibility, body)
    values (p_case, v_actor, v_party, case when coalesce(p_internal, false) then 'internal' else 'parties' end, btrim(p_body));
  perform app_private.case_log(p_case, v_actor, 'statement_added', c.status, c.status, v_party);
end $$;

-- Role-scoped view: each side sees its own statements and support's public ones, never the other side's private statements.
create function public.get_case(p_case uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_party text; c public.support_cases%rowtype; o public.orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  v_party := app_private.case_party(p_case);
  if v_party is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.support_cases where id = p_case;
  select * into o from public.orders where id = c.order_id;
  return jsonb_build_object(
    'id', c.id, 'case_no', c.case_no, 'viewer', v_party, 'order_id', o.id, 'order_number', o.order_number,
    'case_type', c.case_type, 'status', c.status, 'created_at', c.created_at,
    'description', case when v_party in ('customer', 'support') then c.description end,
    'decision', c.decision, 'decision_reason', case when c.status in ('decided', 'closed') then c.decision_reason end,
    'statements', (select coalesce(jsonb_agg(jsonb_build_object('party', s.party, 'body', s.body, 'visibility', s.visibility, 'at', s.created_at) order by s.id), '[]'::jsonb)
                     from public.case_statements s where s.case_id = c.id
                      and (v_party = 'support' or s.party = v_party or (s.party = 'support' and s.visibility = 'parties'))),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'to', e.to_status, 'at', e.created_at) order by e.id), '[]'::jsonb)
                   from public.case_events e where e.case_id = c.id and e.action <> 'statement_added'),
    'order_progress', (select coalesce(jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.created_at) order by h.id), '[]'::jsonb)
                         from public.order_status_history h where h.order_id = c.order_id));
end $$;

-- A neutral list of the cases the caller is a party to.
create function public.list_my_cases() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'case_no', c.case_no, 'order_number', o.order_number, 'case_type', c.case_type,
            'status', c.status, 'created_at', c.created_at, 'role', app_private.case_party(c.id)) order by c.created_at desc), '[]'::jsonb)
          from public.support_cases c join public.orders o on o.id = c.order_id
         where app_private.case_party(c.id) is not null and not app_private.has_any_role(array['support_agent', 'platform_admin']::public.app_role[]));
end $$;

create function public.staff_list_cases(p_status text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'case_no', c.case_no, 'order_number', o.order_number, 'case_type', c.case_type,
            'status', c.status, 'created_at', c.created_at, 'decision', c.decision, 'assigned_to_me', c.assigned_to = v_actor) order by c.created_at), '[]'::jsonb)
          from public.support_cases c join public.orders o on o.id = c.order_id where p_status is null or c.status = p_status);
end $$;

create function public.case_start_review(p_case uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]); c public.support_cases%rowtype;
begin
  select * into c from public.support_cases where id = p_case for update;
  if not found then raise exception 'unknown case' using errcode = 'P0002'; end if;
  if c.reporter_id = v_actor then raise exception 'cannot review your own case' using errcode = '42501'; end if;
  if c.status <> 'open' then raise exception 'case_invalid_transition' using errcode = '22023'; end if;
  update public.support_cases set status = 'under_review', assigned_to = v_actor where id = p_case;
  perform app_private.case_log(p_case, v_actor, 'review_started', 'open', 'under_review', null);
end $$;

-- Neutral evidence bundle for staff. No raw GPS, no plaintext secrets, no signature image (that needs the audited proof function).
create function public.staff_case_bundle(p_case uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]); c public.support_cases%rowtype; o public.orders%rowtype;
begin
  select * into c from public.support_cases where id = p_case;
  if not found then raise exception 'unknown case' using errcode = 'P0002'; end if;
  select * into o from public.orders where id = c.order_id;
  perform app_private.audit_write(v_actor, 'case.bundle_viewed', 'order', o.id::text, jsonb_build_object('case', p_case));
  return jsonb_build_object(
    'case', jsonb_build_object('id', c.id, 'case_no', c.case_no, 'type', c.case_type, 'status', c.status, 'description', c.description,
                                'decision', c.decision, 'decision_reason', c.decision_reason, 'reporter', c.reporter_id),
    'order', jsonb_build_object('id', o.id, 'number', o.order_number, 'status', o.status, 'fulfilment', o.fulfilment, 'vendor', o.vendor_name,
                                 'items_total_kobo', o.items_total_kobo, 'delivery_fee_kobo', o.delivery_fee_kobo, 'platform_fee_kobo', o.platform_fee_kobo,
                                 'discount_kobo', o.discount_kobo, 'total_kobo', o.total_kobo, 'deliver_to', o.delivery_point_label, 'placed_at', o.created_at),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.product_name, 'quantity', i.quantity, 'unit_price_kobo', i.unit_price_kobo,
                'line_total_kobo', i.line_total_kobo) order by i.product_name), '[]'::jsonb) from public.order_items i where i.order_id = o.id),
    'payment', jsonb_build_object('received_kobo', app_private.order_received(o.id),
                'refunded_kobo', (select coalesce(sum(amount_kobo), 0) from public.ledger_entries where order_id = o.id and entry_type = 'refund_paid'),
                'refundable_kobo', greatest(0, app_private.order_received(o.id) - app_private.refund_active_total(o.id)),
                'transactions', (select coalesce(jsonb_agg(jsonb_build_object('status', t.status, 'amount_kobo', t.amount_kobo, 'at', t.created_at) order by t.created_at), '[]'::jsonb)
                                   from public.payment_transactions t where t.order_id = o.id)),
    'order_timeline', (select coalesce(jsonb_agg(jsonb_build_object('from', h.from_status, 'to', h.to_status, 'reason', h.reason, 'at', h.created_at) order by h.id), '[]'::jsonb)
                         from public.order_status_history h where h.order_id = o.id),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('no', d.assignment_no, 'status', d.status, 'rider', rp.full_name, 'accepted_at', d.accepted_at,
                'picked_up_at', d.picked_up_at, 'en_route_at', d.en_route_at, 'arrival_detected_at', d.arrival_detected_at, 'completed_at', d.completed_at,
                'released_at', d.released_at, 'release_reason', d.release_reason, 'geofence_radius_m', d.dest_radius_m) order by d.assignment_no), '[]'::jsonb)
                      from public.delivery_assignments d left join public.rider_profiles rp on rp.user_id = d.rider_id where d.order_id = o.id),
    'delivery_proof', (select jsonb_build_object('kind', e.evidence_kind, 'method', e.capture_method, 'recipient', e.recipient_name, 'completed_at', e.completed_at,
                'arrival_detected_at', e.arrival_detected_at, 'signature_sha256', e.signature_sha256) from public.handover_evidence e where e.order_id = o.id),
    'code_outcomes', jsonb_build_object(
        'pickup_code_failed_attempts', (select failed_attempts from public.pickup_codes where order_id = o.id),
        'proof_sessions', (select coalesce(jsonb_agg(jsonb_build_object('failed_attempts', s.failed_attempts, 'used', s.used_at is not null,
                'invalidated', s.invalidated_at is not null, 'expired', s.expires_at <= now() and s.used_at is null) order by s.created_at), '[]'::jsonb)
                           from public.delivery_proof_sessions s where s.order_id = o.id)),
    'rider_issues', (select coalesce(jsonb_agg(jsonb_build_object('reason', ri.reason, 'note', ri.note, 'status', ri.status, 'at', ri.created_at) order by ri.created_at), '[]'::jsonb)
                       from public.rider_issues ri where ri.order_id = o.id),
    'statements', (select coalesce(jsonb_agg(jsonb_build_object('party', s.party, 'visibility', s.visibility, 'body', s.body, 'at', s.created_at) order by s.id), '[]'::jsonb)
                     from public.case_statements s where s.case_id = c.id),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount_kobo', r.amount_kobo, 'status', r.status, 'provider_mode', r.provider_mode) order by r.created_at), '[]'::jsonb)
                  from public.refunds r where r.order_id = o.id),
    'other_cases', (select coalesce(jsonb_agg(jsonb_build_object('case_no', x.case_no, 'type', x.case_type, 'status', x.status)), '[]'::jsonb)
                      from public.support_cases x where x.order_id = o.id and x.id <> c.id),
    'note', 'GPS and location data are not used to decide a case. No decision is automatic.');
end $$;

create function public.case_decide(p_case uuid, p_decision text, p_reason text, p_items jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]);
        c public.support_cases%rowtype; v_refund jsonb; v_ret jsonb;
begin
  if p_decision not in ('full_refund', 'partial_refund', 'replacement', 'return', 'reject', 'no_action') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(p_reason) > 1000 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into c from public.support_cases where id = p_case for update;
  if not found then raise exception 'unknown case' using errcode = 'P0002'; end if;
  if c.reporter_id = v_actor then raise exception 'cannot decide your own case' using errcode = '42501'; end if;
  if c.status not in ('open', 'under_review') then raise exception 'case_invalid_transition' using errcode = '22023'; end if;
  if p_decision = 'full_refund' then
    v_refund := app_private.create_refund(c.order_id, v_actor, 'case', null, 'Case ' || c.case_no || ': ' || btrim(p_reason), 'case-' || c.id || '-full', p_case);
  elsif p_decision = 'partial_refund' then
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'refund_invalid_item' using errcode = '22023'; end if;
    v_refund := app_private.create_refund(c.order_id, v_actor, 'case', p_items, 'Case ' || c.case_no || ': ' || btrim(p_reason), 'case-' || c.id || '-part', p_case);
  elsif p_decision = 'return' then
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'return_invalid_item' using errcode = '22023'; end if;
    v_ret := app_private.create_return(c.order_id, c.reporter_id, v_actor, p_items, 'Case ' || c.case_no || ': ' || btrim(p_reason), 'case-' || c.id || '-ret', p_case, true);
  end if;
  update public.support_cases set status = 'decided', decision = p_decision, decision_reason = btrim(p_reason), decided_by = v_actor, decided_at = now(),
         assigned_to = coalesce(assigned_to, v_actor) where id = p_case;
  perform app_private.case_log(p_case, v_actor, 'decided', c.status, 'decided', p_decision || ': ' || btrim(p_reason));
  perform app_private.audit_write(v_actor, 'case.decided', 'order', c.order_id::text, jsonb_build_object('case', p_case, 'decision', p_decision));
  return jsonb_build_object('decision', p_decision, 'refund', v_refund, 'return', v_ret);
end $$;

create function public.case_close(p_case uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]); c public.support_cases%rowtype;
begin
  select * into c from public.support_cases where id = p_case for update;
  if not found then raise exception 'unknown case' using errcode = 'P0002'; end if;
  if c.status <> 'decided' then raise exception 'case_invalid_transition' using errcode = '22023'; end if;
  update public.support_cases set status = 'closed', closed_at = now() where id = p_case;
  -- hand the order back to the state it was flagged from, unless a refund or return already moved it
  if c.prior_order_status in ('COMPLETED', 'DELIVERED') and not exists (
       select 1 from public.support_cases x where x.order_id = c.order_id and x.id <> c.id and x.status in ('open', 'under_review', 'decided')) then
    perform app_private.try_step_order(c.order_id, array['DISPUTED'], 'COMPLETED', v_actor, 'case_closed:' || c.case_no);
  end if;
  perform app_private.case_log(p_case, v_actor, 'closed', 'decided', 'closed', p_note);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Returns (a separate record from refunds; a return is never proof that money moved; nothing is restocked)
-- ---------------------------------------------------------------------------------------------
create table public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  case_id uuid references public.support_cases (id) on delete restrict,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'received_by_vendor', 'closed')),
  method text not null default 'customer_brings' check (method in ('customer_brings')),
  reason text not null check (char_length(reason) between 5 and 500),
  prior_order_status text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 5 and 500),
  vendor_confirmed_by uuid references auth.users (id) on delete set null,
  vendor_confirmed_at timestamptz,
  vendor_condition text check (vendor_condition is null or char_length(vendor_condition) between 3 and 300),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index return_requests_idem on public.return_requests (customer_id, idempotency_key) where idempotency_key is not null;
create index return_requests_order_idx on public.return_requests (order_id);
create trigger return_requests_touch before update on public.return_requests for each row execute function app_private.touch_updated_at();

create table public.return_request_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.return_requests (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  quantity int not null check (quantity between 1 and 100),
  unique (return_id, order_item_id)
);
create trigger return_items_immutable before update or delete on public.return_request_items for each row execute function app_private.deny_mutation();

-- Quantity backstop: returned quantities across live (non-rejected) requests never exceed what was bought.
create function app_private.return_items_cap_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_order uuid; v_bought int; v_used int;
begin
  select order_id into v_order from public.return_requests where id = new.return_id;
  perform 1 from public.orders where id = v_order for update;
  select quantity into v_bought from public.order_items where id = new.order_item_id and order_id = v_order;
  if v_bought is null then raise exception 'return_invalid_item' using errcode = '22023'; end if;
  select coalesce(sum(ri.quantity), 0) into v_used from public.return_request_items ri join public.return_requests r on r.id = ri.return_id
   where ri.order_item_id = new.order_item_id and ri.id <> new.id and r.status <> 'rejected';
  if v_used + new.quantity > v_bought then raise exception 'return_quantity_exceeds_purchased' using errcode = '22023'; end if;
  return new;
end $$;
create trigger return_items_cap before insert on public.return_request_items for each row execute function app_private.return_items_cap_guard();

create function app_private.return_state_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.order_id <> old.order_id or new.customer_id <> old.customer_id then raise exception 'return_core_immutable' using errcode = '42501'; end if;
  if new.status = old.status then return new; end if;
  if not ((old.status, new.status) in (('requested', 'approved'), ('requested', 'rejected'), ('approved', 'received_by_vendor'), ('received_by_vendor', 'closed'))) then
    raise exception 'return_invalid_transition' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger return_requests_state before update on public.return_requests for each row execute function app_private.return_state_guard();

-- 'returnable' | 'not_returnable' | 'case_by_case' for the order's shop category (no rule is invented: the default is a human decision).
create function app_private.return_rule_for_order(p_order uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select s.value -> 'categories' ->> cat.slug from public.platform_settings s where s.key = 'return_policy'),
    (select s.value ->> 'default' from public.platform_settings s where s.key = 'return_policy'),
    'case_by_case')
  from public.orders o join public.vendors v on v.id = o.vendor_id join public.categories cat on cat.id = v.category_id where o.id = p_order
$$;

create function app_private.create_return(p_order uuid, p_customer uuid, p_actor uuid, p_items jsonb, p_reason text, p_key text,
                                          p_case uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o public.orders%rowtype; v_ex public.return_requests%rowtype; v_id uuid; v_item jsonb; v_oi uuid; v_q int; v_rule text;
begin
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if p_key is not null then
    select * into v_ex from public.return_requests where customer_id = p_customer and idempotency_key = p_key;
    if found then
      if v_ex.order_id <> p_order then raise exception 'idempotency_conflict' using errcode = '23505'; end if;
      return jsonb_build_object('id', v_ex.id, 'status', v_ex.status, 'replayed', true);
    end if;
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'return_invalid_item' using errcode = '22023';
  end if;
  v_rule := app_private.return_rule_for_order(p_order);
  if p_approve and v_rule = 'not_returnable' then raise exception 'return_not_permitted' using errcode = '22023'; end if;
  insert into public.return_requests (order_id, customer_id, case_id, reason, prior_order_status, idempotency_key, status, decided_by, decided_at, decision_reason)
    values (p_order, p_customer, p_case, btrim(p_reason), v_o.status, p_key, case when p_approve then 'approved' else 'requested' end,
            case when p_approve then p_actor end, case when p_approve then now() end, case when p_approve then left(btrim(p_reason), 500) end)
    returning id into v_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_oi := (v_item ->> 'order_item_id')::uuid; v_q := (v_item ->> 'quantity')::int;
    exception when others then raise exception 'return_invalid_item' using errcode = '22023';
    end;
    if v_q is null or v_q < 1 then raise exception 'return_invalid_item' using errcode = '22023'; end if;
    insert into public.return_request_items (return_id, order_item_id, quantity) values (v_id, v_oi, v_q);
  end loop;
  perform app_private.try_step_order(p_order, array['COMPLETED', 'DELIVERED', 'DISPUTED'], case when p_approve then 'RETURN_IN_PROGRESS' else 'RETURN_REQUESTED' end,
                                     p_actor, 'return:' || v_id);
  perform app_private.audit_write(p_actor, 'return.requested', 'order', p_order::text, jsonb_build_object('return', v_id, 'approved', p_approve));
  return jsonb_build_object('id', v_id, 'status', case when p_approve then 'approved' else 'requested' end, 'replayed', false);
end $$;

create function public.customer_request_return(p_order uuid, p_items jsonb, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if v_o.status not in ('COMPLETED', 'DELIVERED', 'DISPUTED', 'RETURN_REQUESTED', 'RETURN_IN_PROGRESS', 'RETURNED_TO_VENDOR',
                        'PARTIALLY_REFUNDED') then
    raise exception 'order_not_returnable' using errcode = '22023';
  end if;
  return app_private.create_return(p_order, v_actor, v_actor, p_items, p_reason, p_key, null, false);
end $$;

create function public.staff_decide_return(p_return uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_staff(array['support_agent', 'platform_admin']::public.app_role[]); r public.return_requests%rowtype;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(p_reason) > 500 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into r from public.return_requests where id = p_return for update;
  if not found then raise exception 'unknown return' using errcode = 'P0002'; end if;
  if r.customer_id = v_actor then raise exception 'cannot decide your own request' using errcode = '42501'; end if;
  if r.status <> 'requested' then raise exception 'return_invalid_transition' using errcode = '22023'; end if;
  perform app_private.lock_order_row(r.order_id);
  if p_decision = 'approve' then
    if app_private.return_rule_for_order(r.order_id) = 'not_returnable' then raise exception 'return_not_permitted' using errcode = '22023'; end if;
    update public.return_requests set status = 'approved', decided_by = v_actor, decided_at = now(), decision_reason = btrim(p_reason) where id = p_return;
    perform app_private.try_step_order(r.order_id, array['RETURN_REQUESTED'], 'RETURN_IN_PROGRESS', v_actor, 'return_approved:' || p_return);
  else
    update public.return_requests set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_reason = btrim(p_reason) where id = p_return;
    if r.prior_order_status in ('COMPLETED', 'DELIVERED', 'DISPUTED') then
      perform app_private.try_step_order(r.order_id, array['RETURN_REQUESTED'], r.prior_order_status, v_actor, 'return_rejected:' || p_return);
    end if;
  end if;
  perform app_private.audit_write(v_actor, case p_decision when 'approve' then 'return.approved' else 'return.rejected' end, 'order', r.order_id::text, jsonb_build_object('return', p_return));
end $$;

create function public.vendor_confirm_return_received(p_return uuid, p_condition text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); r public.return_requests%rowtype; o public.orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into r from public.return_requests where id = p_return;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.orders where id = r.order_id;
  perform app_private.require_vendor_actor(o.vendor_id);
  if p_condition is null or char_length(btrim(p_condition)) < 3 or char_length(p_condition) > 300 then raise exception 'note_required' using errcode = '22023'; end if;
  select * into r from public.return_requests where id = p_return for update;
  if r.status <> 'approved' then raise exception 'return_invalid_transition' using errcode = '22023'; end if;
  update public.return_requests set status = 'received_by_vendor', vendor_confirmed_by = v_actor, vendor_confirmed_at = now(), vendor_condition = btrim(p_condition)
   where id = p_return;
  perform app_private.try_step_order(r.order_id, array['RETURN_IN_PROGRESS'], 'RETURNED_TO_VENDOR', v_actor, 'return_received:' || p_return);
  perform app_private.audit_write(v_actor, 'return.received_by_vendor', 'order', r.order_id::text, jsonb_build_object('return', p_return));
end $$;

create function public.list_returns(p_order uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_staff boolean;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  v_staff := app_private.has_any_role(array['support_agent', 'platform_admin']::public.app_role[]);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'order_id', r.order_id, 'order_number', o.order_number, 'status', r.status, 'reason', r.reason,
            'decision_reason', r.decision_reason, 'vendor_condition', r.vendor_condition, 'created_at', r.created_at,
            'return_rule', app_private.return_rule_for_order(o.id),
            'items', (select coalesce(jsonb_agg(jsonb_build_object('name', oi.product_name, 'quantity', ri.quantity)), '[]'::jsonb)
                        from public.return_request_items ri join public.order_items oi on oi.id = ri.order_item_id where ri.return_id = r.id)) order by r.created_at desc), '[]'::jsonb)
          from public.return_requests r join public.orders o on o.id = r.order_id
         where (p_order is null or r.order_id = p_order)
           and (r.customer_id = v_actor or v_staff or app_private.is_vendor_member(o.vendor_id)));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Supervised delivery exceptions (Phase 9 section 1.5): never marks anything delivered
-- ---------------------------------------------------------------------------------------------
create function public.ops_handle_delivery_exception(p_order uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_ops(); o public.orders%rowtype; a public.delivery_assignments%rowtype; v_case jsonb; v_id uuid; v_no text;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(p_reason) > 500 then raise exception 'reason_required' using errcode = '22023'; end if;
  perform app_private.lock_order_row(p_order);
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'unknown order' using errcode = 'P0002'; end if;
  if o.fulfilment <> 'delivery' or o.status not in ('PICKED_UP_BY_RIDER', 'EN_ROUTE', 'ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  select * into a from public.delivery_assignments where order_id = p_order and status in ('accepted', 'picked_up', 'en_route') for update;
  if found then
    update public.delivery_assignments set status = 'released', released_at = now(), release_reason = left('ops exception: ' || btrim(p_reason), 100) where id = a.id;
    update public.delivery_proof_sessions set invalidated_at = now() where assignment_id = a.id and used_at is null and invalidated_at is null;
    update public.assignment_tokens set invalidated_at = now() where assignment_id = a.id and used_at is null and invalidated_at is null;
    if not exists (select 1 from public.delivery_assignments d where d.rider_id = a.rider_id and d.status in ('accepted', 'picked_up', 'en_route')) then
      delete from public.rider_location_current where rider_id = a.rider_id;
    end if;
  end if;
  perform app_private.step_order(p_order, o.status, 'DISPUTED', v_actor, 'ops_delivery_exception');
  begin
    insert into public.support_cases (order_id, reporter_id, case_type, description, prior_order_status, opened_by_staff, status, assigned_to)
      values (p_order, o.customer_id, 'delivery_problem', 'Opened by support: ' || btrim(p_reason), o.status, v_actor, 'under_review', v_actor)
      returning id, case_no into v_id, v_no;
  exception when unique_violation then
    select id, case_no into v_id, v_no from public.support_cases where order_id = p_order and case_type = 'delivery_problem' and status in ('open', 'under_review');
  end;
  perform app_private.case_log(v_id, v_actor, 'opened_by_support', null, 'under_review', btrim(p_reason));
  perform app_private.audit_write(v_actor, 'delivery.exception_handled', 'order', p_order::text, jsonb_build_object('case', v_id, 'assignment', a.id));
  return jsonb_build_object('case_id', v_id, 'case_no', v_no);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['refund_items', 'refund_events', 'support_cases', 'case_statements', 'case_events', 'return_requests', 'return_request_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (app_private.is_aal2())', t || '_aal2', t);
  end loop;
end $$;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.refund_items, public.refund_events, public.support_cases, public.case_statements, public.case_events,
  public.return_requests, public.return_request_items to authenticated;

create policy refund_items_select on public.refund_items for select to authenticated
  using (exists (select 1 from public.refunds r where r.id = refund_id));
create policy refund_events_select on public.refund_events for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'finance_admin', 'support_agent']::public.app_role[]));
create policy support_cases_select on public.support_cases for select to authenticated
  using (reporter_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy case_statements_select on public.case_statements for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[])
         or (visibility = 'parties' and party in ('customer', 'support')
             and exists (select 1 from public.support_cases c where c.id = case_id and c.reporter_id = (select auth.uid()))));
create policy case_events_select on public.case_events for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[]));
create policy return_requests_select on public.return_requests for select to authenticated
  using (customer_id = (select auth.uid()) or app_private.has_any_role(array['platform_admin', 'support_agent']::public.app_role[])
         or exists (select 1 from public.orders o where o.id = order_id and app_private.is_vendor_member(o.vendor_id)));
create policy return_items_select on public.return_request_items for select to authenticated
  using (exists (select 1 from public.return_requests r where r.id = return_id));

do $$
declare f text;
begin
  foreach f in array array[
    'public.customer_request_refund(uuid, jsonb, text, text)',
    'public.refund_start_review(uuid, text)',
    'public.refund_decide(uuid, text, text)',
    'public.refund_begin_execution(uuid, text)',
    'public.refund_record_outcome(uuid, text, text, text)',
    'public.refund_reconcile(uuid, text, text, text)',
    'public.staff_list_refunds(text)',
    'public.my_order_refunds(uuid)',
    'public.open_support_case(uuid, text, text, text)',
    'public.case_add_statement(uuid, text, boolean)',
    'public.get_case(uuid)',
    'public.list_my_cases()',
    'public.staff_list_cases(text)',
    'public.case_start_review(uuid)',
    'public.staff_case_bundle(uuid)',
    'public.case_decide(uuid, text, text, jsonb)',
    'public.case_close(uuid, text)',
    'public.customer_request_return(uuid, jsonb, text, text)',
    'public.staff_decide_return(uuid, text, text)',
    'public.vendor_confirm_return_received(uuid, text)',
    'public.list_returns(uuid)',
    'public.ops_handle_delivery_exception(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- service role only: the path a verified provider event would use
  revoke all on function public.refund_provider_outcome(uuid, text, text, text) from public, anon, authenticated;
  grant execute on function public.refund_provider_outcome(uuid, text, text, text) to service_role;
  -- internal helpers are never callable by API roles
  foreach f in array array[
    'app_private.require_staff(public.app_role[])', 'app_private.order_received(uuid)', 'app_private.refund_active_total(uuid, uuid)',
    'app_private.try_step_order(uuid, text[], text, uuid, text)', 'app_private.refund_log(uuid, uuid, text, text, text, text)',
    'app_private.refunds_cap_guard()', 'app_private.refunds_state_guard()', 'app_private.refund_items_cap_guard()',
    'app_private.refund_item_amount(uuid, int)', 'app_private.create_refund(uuid, uuid, text, jsonb, text, text, uuid)',
    'app_private.refund_outcome_core(uuid, text, text, text, uuid)', 'app_private.case_log(uuid, uuid, text, text, text, text)',
    'app_private.case_party(uuid)', 'app_private.return_items_cap_guard()', 'app_private.return_state_guard()',
    'app_private.return_rule_for_order(uuid)',
    'app_private.create_return(uuid, uuid, uuid, jsonb, text, text, uuid, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
