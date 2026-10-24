-- Batch 3 (Phases 5 + 6): Paystack test-mode payments, webhook event store, ledger, reconciliation, refund primitives,
-- vendor order state machine, one-time pickup code, mandatory signature, handover evidence.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Phase 5: payments
-- ---------------------------------------------------------------------------------------------
create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  provider text not null default 'paystack' check (provider = 'paystack'),
  reference text not null unique check (char_length(reference) between 8 and 100),
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'initialized' check (status in ('initialized', 'succeeded', 'failed', 'mismatch')),
  access_code text,
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_transactions_order_idx on public.payment_transactions (order_id);
create trigger payment_transactions_touch before update on public.payment_transactions
  for each row execute function app_private.touch_updated_at();
create trigger payment_transactions_no_delete before delete on public.payment_transactions
  for each row execute function app_private.deny_mutation();

-- Every webhook/verify event that was accepted (signature already checked by the server). Append-only.
create table public.payment_events (
  id bigint generated always as identity primary key,
  provider_event_id text not null unique check (char_length(provider_event_id) between 1 and 200),
  event_type text not null,
  reference text,
  payload jsonb not null,
  outcome text not null,
  received_at timestamptz not null default now()
);
create trigger payment_events_append_only before update or delete on public.payment_events
  for each row execute function app_private.deny_mutation();
create trigger payment_events_no_truncate before truncate on public.payment_events
  for each statement execute function app_private.deny_mutation();

-- Money actually received/returned. No payout/settlement entries exist (settlement is locked DISABLED).
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders (id) on delete restrict,
  transaction_id uuid references public.payment_transactions (id) on delete restrict,
  entry_type text not null check (entry_type in ('payment_received', 'refund_paid')),
  amount_kobo bigint not null check (amount_kobo > 0),
  created_at timestamptz not null default now()
);
create unique index ledger_one_receipt_per_txn on public.ledger_entries (transaction_id) where entry_type = 'payment_received';
create trigger ledger_append_only before update or delete on public.ledger_entries
  for each row execute function app_private.deny_mutation();
create trigger ledger_no_truncate before truncate on public.ledger_entries
  for each statement execute function app_private.deny_mutation();

create table public.reconciliation_flags (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete restrict,
  transaction_id uuid references public.payment_transactions (id) on delete restrict,
  reason text not null check (reason in ('amount_mismatch', 'late_payment', 'duplicate_payment', 'unknown_reference', 'vendor_rejected_paid_order')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text
);
create index reconciliation_open_idx on public.reconciliation_flags (created_at) where resolved_at is null;

-- Refund primitives only: a request is recorded; nothing is sent to a provider in this batch.
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  transaction_id uuid references public.payment_transactions (id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null default 'requested' check (status in ('requested', 'pending', 'processed', 'failed')),
  reason text not null check (char_length(reason) between 3 and 500),
  requested_by uuid not null,
  provider_refund_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_order_idx on public.refunds (order_id);
create trigger refunds_touch before update on public.refunds for each row execute function app_private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Phase 6: pickup code + evidence
-- ---------------------------------------------------------------------------------------------
create table app_private.secrets (name text primary key, value text not null);
insert into app_private.secrets values ('pickup_pepper', encode(extensions.gen_random_bytes(32), 'hex'));
alter table app_private.secrets enable row level security;
revoke all on app_private.secrets from public, anon, authenticated;

create table public.pickup_codes (
  order_id uuid primary key references public.orders (id) on delete restrict,
  nonce text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  failed_attempts int not null default 0,
  created_at timestamptz not null default now()
);

create table public.handover_evidence (
  order_id uuid primary key references public.orders (id) on delete restrict,
  recipient_name text not null check (char_length(recipient_name) between 2 and 80),
  signature_png bytea not null check (octet_length(signature_png) between 300 and 400000),
  signature_sha256 text not null,
  completed_by uuid not null,
  completed_at timestamptz not null default now()
);
create trigger handover_evidence_append_only before update or delete on public.handover_evidence
  for each row execute function app_private.deny_mutation();

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['payment_transactions', 'payment_events', 'ledger_entries', 'reconciliation_flags', 'refunds',
                           'pickup_codes', 'handover_evidence'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (app_private.is_aal2())', t || '_aal2', t);
  end loop;
end $$;
grant select on public.payment_transactions, public.payment_events, public.ledger_entries, public.reconciliation_flags,
  public.refunds, public.handover_evidence to authenticated;
-- pickup_codes: no direct access at all for users (hash + counters are internal).
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create policy payment_transactions_select on public.payment_transactions for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
         or app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]));
create policy payment_events_select on public.payment_events for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]));
create policy ledger_select on public.ledger_entries for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]));
create policy reconciliation_select on public.reconciliation_flags for select to authenticated
  using (app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]));
create policy refunds_select on public.refunds for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
         or app_private.has_any_role(array['platform_admin', 'finance_admin', 'support_agent']::public.app_role[]));
create policy handover_evidence_select on public.handover_evidence for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- ---------------------------------------------------------------------------------------------
-- Payment functions
-- ---------------------------------------------------------------------------------------------
-- Customer step 1: reserve a unique reference for the order (amount comes from the order row, never the client).
create function public.payment_prepare(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_t public.payment_transactions%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_o.status <> 'PENDING_PAYMENT' or v_o.expires_at <= now() then raise exception 'order_not_payable' using errcode = '22023'; end if;
  select * into v_t from public.payment_transactions where order_id = p_order and status = 'initialized' order by created_at desc limit 1;
  if not found then
    insert into public.payment_transactions (order_id, reference, amount_kobo)
      values (p_order, v_o.order_number || '-' || encode(extensions.gen_random_bytes(6), 'hex'), v_o.total_kobo)
      returning * into v_t;
  end if;
  return jsonb_build_object('reference', v_t.reference, 'amount_kobo', v_t.amount_kobo, 'currency', v_t.currency,
                            'order_number', v_o.order_number, 'access_code', v_t.access_code);
end $$;

-- Customer step 2 (server, after the provider accepted the initialization).
create function public.payment_set_access_code(p_reference text, p_access_code text) returns void
language sql security definer set search_path = ''
as $$ update public.payment_transactions set access_code = left(p_access_code, 200)
       where reference = p_reference and status = 'initialized' $$;

-- Applies a verified provider event. Called ONLY by the server after signature verification (webhook) or after
-- asking the provider directly (verify). Idempotent per event id; safe against replay and reordering.
create function public.payment_apply_event(p_event_id text, p_event_type text, p_reference text, p_amount bigint,
                                           p_currency text, p_payload jsonb) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_t public.payment_transactions%rowtype; v_o public.orders%rowtype; v_outcome text; v_other int;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 200 then
    raise exception 'invalid event id' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payevt:' || p_event_id, 0));
  if exists (select 1 from public.payment_events where provider_event_id = p_event_id) then return 'duplicate_event'; end if;

  select * into v_t from public.payment_transactions where reference = p_reference for update;
  if not found then
    v_outcome := 'unknown_reference';
    insert into public.reconciliation_flags (reason, details)
      values ('unknown_reference', jsonb_build_object('reference', left(coalesce(p_reference, ''), 100), 'event', p_event_type));
  elsif p_event_type = 'charge.success' then
    if v_t.status = 'succeeded' then
      v_outcome := 'already_succeeded';
    elsif p_amount is distinct from v_t.amount_kobo or p_currency is distinct from v_t.currency then
      update public.payment_transactions set status = 'mismatch' where id = v_t.id;
      insert into public.reconciliation_flags (order_id, transaction_id, reason, details)
        values (v_t.order_id, v_t.id, 'amount_mismatch',
                jsonb_build_object('expected_kobo', v_t.amount_kobo, 'received_kobo', p_amount, 'currency', p_currency));
      v_outcome := 'amount_mismatch';
    else
      update public.payment_transactions set status = 'succeeded', succeeded_at = now() where id = v_t.id;
      insert into public.ledger_entries (order_id, transaction_id, entry_type, amount_kobo)
        values (v_t.order_id, v_t.id, 'payment_received', v_t.amount_kobo);
      select * into v_o from public.orders where id = v_t.order_id for update;
      if v_o.status = 'PENDING_PAYMENT' then
        update public.orders set status = 'PAID' where id = v_o.id;
        insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason)
          values (v_o.id, 'PENDING_PAYMENT', 'PAID', null, 'paystack_payment');
        v_outcome := 'paid';
      elsif v_o.status = 'CANCELLED' then
        insert into public.reconciliation_flags (order_id, transaction_id, reason, details)
          values (v_o.id, v_t.id, 'late_payment', jsonb_build_object('amount_kobo', v_t.amount_kobo, 'note', 'order was cancelled or expired; refund required'));
        v_outcome := 'late_payment';
      else
        select count(*) into v_other from public.payment_transactions where order_id = v_o.id and status = 'succeeded' and id <> v_t.id;
        insert into public.reconciliation_flags (order_id, transaction_id, reason, details)
          values (v_o.id, v_t.id, 'duplicate_payment', jsonb_build_object('amount_kobo', v_t.amount_kobo, 'other_successes', v_other));
        v_outcome := 'duplicate_payment';
      end if;
    end if;
  elsif p_event_type = 'charge.failed' then
    if v_t.status = 'initialized' then
      update public.payment_transactions set status = 'failed' where id = v_t.id;
      v_outcome := 'failed';
    else
      v_outcome := 'ignored_out_of_order';
    end if;
  else
    v_outcome := 'ignored_event_type';
  end if;

  insert into public.payment_events (provider_event_id, event_type, reference, payload, outcome)
    values (p_event_id, left(coalesce(p_event_type, ''), 100), left(p_reference, 100), coalesce(p_payload, '{}'::jsonb), v_outcome);
  if v_outcome in ('paid', 'late_payment', 'amount_mismatch', 'duplicate_payment') then
    perform app_private.audit_write(null, 'payment.' || v_outcome, 'order', v_t.order_id::text, jsonb_build_object('reference', v_t.reference));
  end if;
  return v_outcome;
end $$;

-- Finance/admin tools -------------------------------------------------------------------------
create function app_private.require_finance() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_any_role(array['platform_admin', 'finance_admin']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_actor;
end $$;

create function public.list_reconciliation_flags(p_include_resolved boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_finance();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'order_id', f.order_id, 'order_number', o.order_number,
            'reason', f.reason, 'details', f.details, 'created_at', f.created_at, 'resolved_at', f.resolved_at,
            'resolution_note', f.resolution_note) order by f.created_at desc), '[]'::jsonb)
          from (select * from public.reconciliation_flags where p_include_resolved or resolved_at is null order by created_at desc limit 200) f
          left join public.orders o on o.id = f.order_id);
end $$;

create function public.resolve_reconciliation_flag(p_flag uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_finance();
begin
  if p_note is null or char_length(btrim(p_note)) < 3 then raise exception 'note_required' using errcode = '22023'; end if;
  update public.reconciliation_flags set resolved_at = now(), resolved_by = v_actor, resolution_note = left(btrim(p_note), 500)
   where id = p_flag and resolved_at is null;
  if not found then raise exception 'flag_not_open' using errcode = '22023'; end if;
  perform app_private.audit_write(v_actor, 'reconciliation.resolved', 'reconciliation_flag', p_flag::text, '{}'::jsonb);
end $$;

-- Records a refund REQUEST (primitive). Cannot exceed what was received minus what was already requested.
create function public.refund_request(p_order uuid, p_amount bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_finance(); v_received bigint; v_requested bigint; v_id uuid; v_txn uuid;
begin
  select coalesce(sum(amount_kobo), 0) into v_received from public.ledger_entries where order_id = p_order and entry_type = 'payment_received';
  select coalesce(sum(amount_kobo), 0) into v_requested from public.refunds where order_id = p_order and status <> 'failed';
  if p_amount is null or p_amount <= 0 or p_amount > v_received - v_requested then
    raise exception 'refund_exceeds_received' using errcode = '22023';
  end if;
  select transaction_id into v_txn from public.ledger_entries where order_id = p_order and entry_type = 'payment_received' order by id limit 1;
  insert into public.refunds (order_id, transaction_id, amount_kobo, reason, requested_by)
    values (p_order, v_txn, p_amount, left(btrim(p_reason), 500), v_actor) returning id into v_id;
  perform app_private.audit_write(v_actor, 'refund.requested', 'order', p_order::text, jsonb_build_object('amount_kobo', p_amount));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Phase 6: vendor state machine
-- ---------------------------------------------------------------------------------------------
create function app_private.pickup_code_for(p_order uuid, p_nonce text) returns text
language sql security definer set search_path = ''
as $$
  select upper(substr(encode(extensions.hmac(p_order::text || ':' || p_nonce,
         (select value from app_private.secrets where name = 'pickup_pepper'), 'sha256'), 'hex'), 1, 8))
$$;

create function app_private.step_order(p_order uuid, p_from text, p_to text, p_actor uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders set status = p_to where id = p_order and status = p_from;
  if not found then raise exception 'invalid_transition' using errcode = '22023'; end if;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason)
    values (p_order, p_from, p_to, p_actor, p_reason);
end $$;

create function public.vendor_transition_order(p_order uuid, p_action text, p_reason text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_nonce text; v_txn uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.require_vendor_actor(v_o.vendor_id);
  select * into v_o from public.orders where id = p_order for update;

  if p_action = 'accept' then
    perform app_private.step_order(p_order, 'PAID', 'ACCEPTED', v_actor, 'vendor_accepted');
  elsif p_action = 'reject' then
    if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'reason_required' using errcode = '22023'; end if;
    perform app_private.step_order(p_order, 'PAID', 'CANCELLED', v_actor, 'vendor_rejected: ' || left(btrim(p_reason), 200));
    perform app_private.release_order_stock(p_order);
    select transaction_id into v_txn from public.ledger_entries where order_id = p_order and entry_type = 'payment_received' limit 1;
    insert into public.reconciliation_flags (order_id, transaction_id, reason, details)
      values (p_order, v_txn, 'vendor_rejected_paid_order', jsonb_build_object('total_kobo', v_o.total_kobo, 'note', 'refund required'));
  elsif p_action = 'start_preparing' then
    perform app_private.step_order(p_order, 'ACCEPTED', 'PREPARING', v_actor, 'vendor_preparing');
  elsif p_action = 'mark_ready' then
    perform app_private.step_order(p_order, 'PREPARING', 'READY', v_actor, 'vendor_ready');
    if v_o.fulfilment = 'pickup' then
      v_nonce := encode(extensions.gen_random_bytes(12), 'hex');
      insert into public.pickup_codes (order_id, nonce, code_hash, expires_at)
        values (p_order, v_nonce, encode(extensions.digest(app_private.pickup_code_for(p_order, v_nonce), 'sha256'), 'hex'),
                now() + interval '48 hours');
      perform app_private.step_order(p_order, 'READY', 'PICKUP_AWAITING_HANDOVER', v_actor, 'pickup_code_issued');
    else
      perform app_private.step_order(p_order, 'READY', 'AWAITING_RIDER', v_actor, 'awaiting_rider');
    end if;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  perform app_private.audit_write(v_actor, 'order.' || p_action, 'order', p_order::text, '{}'::jsonb);
  return (select status from public.orders where id = p_order);
end $$;

-- Customer sees their one-time pickup code (never anyone else).
create function public.get_pickup_code(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_c public.pickup_codes%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_c from public.pickup_codes where order_id = p_order;
  if not found or v_c.used_at is not null or v_c.expires_at <= now() or v_o.status <> 'PICKUP_AWAITING_HANDOVER' then
    return jsonb_build_object('available', false);
  end if;
  return jsonb_build_object('available', true, 'code', app_private.pickup_code_for(p_order, v_c.nonce), 'expires_at', v_c.expires_at);
end $$;

-- Vendor completes a pickup: valid one-time code + recipient name + signature image. A wrong code is counted
-- (returned, not raised, so the counter persists); 5 wrong codes lock the code.
create function public.complete_pickup(p_order uuid, p_code text, p_recipient text, p_signature bytea) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_c public.pickup_codes%rowtype; v_hash text;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.require_vendor_actor(v_o.vendor_id);
  select * into v_o from public.orders where id = p_order for update;
  if v_o.fulfilment <> 'pickup' or v_o.status <> 'PICKUP_AWAITING_HANDOVER' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if p_recipient is null or char_length(btrim(p_recipient)) not between 2 and 80 then
    raise exception 'recipient_required' using errcode = '22023';
  end if;
  if p_signature is null or octet_length(p_signature) not between 300 and 400000
     or get_byte(p_signature, 0) <> 137 or get_byte(p_signature, 1) <> 80 or get_byte(p_signature, 2) <> 78 or get_byte(p_signature, 3) <> 71 then
    raise exception 'signature_required' using errcode = '22023';
  end if;
  select * into v_c from public.pickup_codes where order_id = p_order for update;
  if not found or v_c.used_at is not null or v_c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'code_unavailable');
  end if;
  if v_c.failed_attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'code_locked'); end if;
  v_hash := encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
  if v_hash <> v_c.code_hash then
    update public.pickup_codes set failed_attempts = failed_attempts + 1 where order_id = p_order;
    perform app_private.audit_write(v_actor, 'pickup.wrong_code', 'order', p_order::text, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'reason', 'wrong_code', 'attempts_left', greatest(0, 4 - v_c.failed_attempts));
  end if;
  update public.pickup_codes set used_at = now() where order_id = p_order;
  insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by)
    values (p_order, btrim(p_recipient), p_signature, encode(extensions.digest(p_signature, 'sha256'), 'hex'), v_actor);
  perform app_private.step_order(p_order, 'PICKUP_AWAITING_HANDOVER', 'COMPLETED', v_actor, 'pickup_completed');
  perform app_private.audit_write(v_actor, 'pickup.completed', 'order', p_order::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.payment_prepare(uuid)', 'public.list_reconciliation_flags(boolean)', 'public.resolve_reconciliation_flag(uuid, text)',
    'public.refund_request(uuid, bigint, text)', 'public.vendor_transition_order(uuid, text, text)',
    'public.get_pickup_code(uuid)', 'public.complete_pickup(uuid, text, text, bytea)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.payment_set_access_code(text, text)', 'public.payment_apply_event(text, text, text, bigint, text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['app_private.require_finance()', 'app_private.pickup_code_for(uuid, text)',
                           'app_private.step_order(uuid, text, text, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
