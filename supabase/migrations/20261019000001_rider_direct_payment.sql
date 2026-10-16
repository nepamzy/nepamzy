-- Rider direct delivery-fee payment (Final Implementation Completion, item 1).
--
-- Approved arrangement: marketplace checkout stays Paystack-based. Riders use AFIT Market free of charge (no rider commission).
-- ONLY when persisted order records explicitly say the delivery fee was NOT part of the Paystack payment
-- (orders.delivery_fee_collection = 'direct_to_rider') does the customer pay the assigned rider directly by bank transfer.
-- The customer reports the transfer, the rider independently confirms or disputes it, and a digital receipt is issued only
-- after both. AFIT Market CANNOT verify a transfer into a personal bank account: confirmations are two parties' statements,
-- not bank verification. Nothing here moves money, calls a bank or calls Paystack.
--
-- Safety rules encoded below:
--   * default 'paystack' for every existing and every new order: nothing changes unless a record explicitly says otherwise;
--   * a 'direct_to_rider' order must NOT have the delivery fee inside its payable total (database check);
--   * if money received already exceeds the payable total, or the records disagree, the order is "ambiguous": no transfer is requested;
--   * the bank details shown for an order are a snapshot taken when the payment is opened: later edits never redirect it;
--   * a dispute can only be resolved by an authorised, audited administrator action; it is never overwritten by a success state.

-- ---------------------------------------------------------------------------------------------
-- 1. Explicit collection marker on the order
-- ---------------------------------------------------------------------------------------------
alter table public.orders
  add column delivery_fee_collection text not null default 'paystack'
  check (delivery_fee_collection in ('paystack', 'direct_to_rider'));

alter table public.orders drop constraint orders_total_matches;
alter table public.orders add constraint orders_total_matches check (
  total_kobo = items_total_kobo + platform_fee_kobo - discount_kobo
               + case when delivery_fee_collection = 'paystack' then delivery_fee_kobo else 0 end);

create function app_private.orders_collection_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.delivery_fee_collection is distinct from old.delivery_fee_collection then
    raise exception 'delivery_fee_collection is fixed when the order is created' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app_private.orders_collection_guard() from public, anon, authenticated;
create trigger orders_collection_guard before update on public.orders
  for each row execute function app_private.orders_collection_guard();

-- ---------------------------------------------------------------------------------------------
-- 2. Rider bank details (private; function-only access)
-- ---------------------------------------------------------------------------------------------
create table public.rider_bank_accounts (
  rider_id uuid primary key references auth.users (id) on delete cascade,
  bank_name text not null check (char_length(bank_name) between 2 and 60),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name text not null check (char_length(account_name) between 2 and 80),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- 3. The delivery-fee payment (one authoritative record per order), its history and its receipt
-- ---------------------------------------------------------------------------------------------
create table public.delivery_fee_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  assignment_id uuid not null references public.delivery_assignments (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  rider_id uuid not null references auth.users (id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  -- snapshot of the destination at the moment the payment was opened
  bank_name text not null, account_number text not null check (account_number ~ '^[0-9]{10}$'), account_name text not null,
  status text not null default 'awaiting_transfer' check (status in
    ('awaiting_transfer', 'customer_reported', 'rider_confirmed', 'rider_disputed', 'resolved_received', 'resolved_not_received')),
  opened_at timestamptz not null default now(),
  customer_reported_at timestamptz, customer_note text check (customer_note is null or char_length(customer_note) <= 300),
  rider_responded_at timestamptz, rider_note text check (rider_note is null or char_length(rider_note) <= 300),
  resolved_at timestamptz, resolved_by uuid references auth.users (id) on delete set null,
  resolution_reason text check (resolution_reason is null or char_length(resolution_reason) between 10 and 500),
  constraint dfp_report_shape check ((status = 'awaiting_transfer') = (customer_reported_at is null)),
  constraint dfp_response_shape check ((status in ('rider_confirmed', 'rider_disputed', 'resolved_received', 'resolved_not_received')) or rider_responded_at is null),
  constraint dfp_resolution_shape check ((status in ('resolved_received', 'resolved_not_received')) = (resolved_at is not null))
);
create index delivery_fee_payments_rider_idx on public.delivery_fee_payments (rider_id, opened_at desc);
create index delivery_fee_payments_customer_idx on public.delivery_fee_payments (customer_id, opened_at desc);
create index delivery_fee_payments_status_idx on public.delivery_fee_payments (status) where status in ('customer_reported', 'rider_disputed');

create table public.delivery_fee_payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.delivery_fee_payments (id) on delete restrict,
  actor_id uuid,
  actor_role text not null check (actor_role in ('customer', 'rider', 'staff', 'system')),
  action text not null,
  from_status text, to_status text,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index delivery_fee_payment_events_idx on public.delivery_fee_payment_events (payment_id, id);
create trigger delivery_fee_payment_events_append_only before update or delete on public.delivery_fee_payment_events
  for each row execute function app_private.deny_mutation();
create trigger delivery_fee_payment_events_no_truncate before truncate on public.delivery_fee_payment_events
  for each statement execute function app_private.deny_mutation();

create table public.delivery_fee_receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.delivery_fee_payments (id) on delete restrict,   -- one authoritative receipt per payment
  receipt_number text not null unique,
  verify_token text not null unique check (char_length(verify_token) = 48),                          -- unguessable (192 bits)
  basis text not null check (basis in ('customer_and_rider_confirmation', 'administrator_resolution')),
  status text not null default 'issued' check (status in ('issued', 'void')),
  order_number text not null, customer_name text not null, rider_name text not null,
  amount_kobo bigint not null check (amount_kobo > 0), currency text not null default 'NGN',
  customer_reported_at timestamptz, rider_confirmed_at timestamptz,
  issued_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references auth.users (id) on delete set null,
  void_reason text check (void_reason is null or char_length(void_reason) between 10 and 500),
  constraint dfr_void_shape check ((status = 'void') = (voided_at is not null))
);
-- A receipt can only move issued -> void (with who and why); nothing else about it may change, and it is never deleted.
create function app_private.receipt_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'receipts are never deleted' using errcode = '42501'; end if;
  if old.status = 'issued' and new.status = 'void'
     and (new.id, new.payment_id, new.receipt_number, new.verify_token, new.basis, new.order_number, new.customer_name, new.rider_name,
          new.amount_kobo, new.currency, new.customer_reported_at, new.rider_confirmed_at, new.issued_at)
         is not distinct from
         (old.id, old.payment_id, old.receipt_number, old.verify_token, old.basis, old.order_number, old.customer_name, old.rider_name,
          old.amount_kobo, old.currency, old.customer_reported_at, old.rider_confirmed_at, old.issued_at) then
    return new;
  end if;
  raise exception 'a receipt can only be voided' using errcode = '42501';
end $$;
revoke all on function app_private.receipt_guard() from public, anon, authenticated;
create trigger delivery_fee_receipts_guard before update or delete on public.delivery_fee_receipts
  for each row execute function app_private.receipt_guard();
create trigger delivery_fee_receipts_no_truncate before truncate on public.delivery_fee_receipts
  for each statement execute function app_private.receipt_guard();

alter table public.rider_bank_accounts enable row level security;
alter table public.delivery_fee_payments enable row level security;
alter table public.delivery_fee_payment_events enable row level security;
alter table public.delivery_fee_receipts enable row level security;
revoke all on public.rider_bank_accounts, public.delivery_fee_payments, public.delivery_fee_payment_events, public.delivery_fee_receipts
  from public, anon, authenticated;
create policy rider_bank_accounts_aal2 on public.rider_bank_accounts as restrictive for all to authenticated using (app_private.is_aal2());
create policy delivery_fee_payments_aal2 on public.delivery_fee_payments as restrictive for all to authenticated using (app_private.is_aal2());
create policy delivery_fee_payment_events_aal2 on public.delivery_fee_payment_events as restrictive for all to authenticated using (app_private.is_aal2());
create policy delivery_fee_receipts_aal2 on public.delivery_fee_receipts as restrictive for all to authenticated using (app_private.is_aal2());
grant all on public.rider_bank_accounts, public.delivery_fee_payments, public.delivery_fee_payment_events, public.delivery_fee_receipts to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------------------------
create function app_private.mask_account(p_number text) returns text
language sql immutable set search_path = ''
as $$ select case when p_number is null then null else repeat('*', greatest(char_length(p_number) - 4, 0)) || right(p_number, 4) end $$;

create function app_private.dfp_event(p_payment uuid, p_actor uuid, p_role text, p_action text, p_from text, p_to text, p_note text) returns void
language sql security definer set search_path = ''
as $$ insert into public.delivery_fee_payment_events (payment_id, actor_id, actor_role, action, from_status, to_status, note)
      values (p_payment, p_actor, p_role, p_action, p_from, p_to, left(p_note, 500)) $$;

-- Why the customer is (not) asked to pay the rider directly for this order. Pure function of persisted records.
--   not_applicable: pickup, no delivery fee, or the fee was part of the Paystack payment (never ask again)
--   ambiguous: marked direct, but the records do not support it (money received exceeds the payable total, or no fee recorded)
--   not_ready: not paid yet, or delivery not completed by an assigned rider
create function app_private.dfp_eligibility(p_order uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare o public.orders%rowtype; v_received bigint;
begin
  select * into o from public.orders where id = p_order;
  if not found then return 'not_found'; end if;
  if o.fulfilment <> 'delivery' then return 'not_applicable'; end if;
  if o.delivery_fee_collection <> 'direct_to_rider' then return 'not_applicable'; end if;
  if o.delivery_fee_kobo <= 0 then return 'ambiguous'; end if;
  v_received := app_private.order_received(p_order);
  if v_received > o.total_kobo then return 'ambiguous'; end if;       -- more money arrived than the Paystack part: the fee may already be inside it
  if v_received < o.total_kobo then return 'not_ready'; end if;
  if not exists (select 1 from public.delivery_assignments a where a.order_id = p_order and a.status = 'completed') then return 'not_ready'; end if;
  return 'eligible';
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Rider bank details
-- ---------------------------------------------------------------------------------------------
create function public.rider_set_bank_details(p_bank text, p_number text, p_name text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_bank text := btrim(coalesce(p_bank, '')); v_number text := regexp_replace(coalesce(p_number, ''), '\s', '', 'g'); v_name text := btrim(coalesce(p_name, ''));
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('rider') or not exists (select 1 from public.rider_profiles where user_id = v_actor and status <> 'suspended') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_bank) < 2 or char_length(v_bank) > 60 or char_length(v_name) < 2 or char_length(v_name) > 80 or v_number !~ '^[0-9]{10}$'
     or v_bank ~ '[[:cntrl:]]' or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_bank_details' using errcode = '22023';
  end if;
  insert into public.rider_bank_accounts (rider_id, bank_name, account_number, account_name) values (v_actor, v_bank, v_number, v_name)
    on conflict (rider_id) do update set bank_name = excluded.bank_name, account_number = excluded.account_number, account_name = excluded.account_name, updated_at = now();
  perform app_private.audit_write(v_actor, 'rider.bank_details_set', 'rider', v_actor::text, jsonb_build_object('bank', v_bank, 'account_ending', right(v_number, 4)));
  return jsonb_build_object('saved', true, 'bank_name', v_bank, 'account_name', v_name, 'account_masked', app_private.mask_account(v_number));
end $$;

-- The rider's own details (full number: it is theirs).
create function public.my_rider_bank_details() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); b public.rider_bank_accounts%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('rider') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into b from public.rider_bank_accounts where rider_id = v_actor;
  if not found then return jsonb_build_object('set', false); end if;
  return jsonb_build_object('set', true, 'bank_name', b.bank_name, 'account_name', b.account_name, 'account_number', b.account_number,
                            'account_masked', app_private.mask_account(b.account_number), 'updated_at', b.updated_at);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Reading one order's delivery-fee payment (customer of the order, its rider, or staff with a masked number)
-- ---------------------------------------------------------------------------------------------
create function app_private.dfp_json(p public.delivery_fee_payments, p_viewer text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare r public.delivery_fee_receipts%rowtype; v_order text; v_rider text; v_customer text;
begin
  select order_number into v_order from public.orders where id = p.order_id;
  select full_name into v_rider from public.rider_profiles where user_id = p.rider_id;
  select coalesce(nullif(display_name, ''), 'Customer') into v_customer from public.profiles where id = p.customer_id;
  select * into r from public.delivery_fee_receipts where payment_id = p.id;
  return jsonb_build_object(
    'state', 'payment', 'viewer', p_viewer, 'id', p.id, 'order_id', p.order_id, 'order_number', v_order,
    'amount_kobo', p.amount_kobo, 'currency', p.currency, 'status', p.status,
    'rider_name', coalesce(v_rider, 'Rider'), 'customer_name', coalesce(v_customer, 'Customer'),
    'bank_name', p.bank_name, 'account_name', p.account_name,
    'account_number', case when p_viewer in ('customer', 'rider') then p.account_number else app_private.mask_account(p.account_number) end,
    'opened_at', p.opened_at, 'customer_reported_at', p.customer_reported_at, 'customer_note', p.customer_note,
    'rider_responded_at', p.rider_responded_at, 'rider_note', p.rider_note,
    'resolved_at', p.resolved_at, 'resolution_reason', p.resolution_reason,
    'receipt', case when r.id is null then null else jsonb_build_object('id', r.id, 'number', r.receipt_number, 'status', r.status,
                 'basis', r.basis, 'issued_at', r.issued_at, 'token', case when p_viewer in ('customer', 'rider') then r.verify_token end) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'actor_role', e.actor_role, 'to_status', e.to_status, 'at', e.created_at, 'note', e.note) order by e.id), '[]'::jsonb)
                  from public.delivery_fee_payment_events e where e.payment_id = p.id));
end $$;

create function public.delivery_fee_payment_for_order(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); o public.orders%rowtype; p public.delivery_fee_payments%rowtype; v_viewer text; v_elig text; v_rider uuid; v_has_bank boolean;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.delivery_fee_payments where order_id = p_order;
  if o.customer_id = v_actor then v_viewer := 'customer';
  elsif found and p.rider_id = v_actor then v_viewer := 'rider';
  elsif app_private.has_any_role(array['platform_admin', 'finance_admin', 'support_agent']::public.app_role[]) then v_viewer := 'staff';
  else raise exception 'forbidden' using errcode = '42501'; end if;
  if p.id is not null then return app_private.dfp_json(p, v_viewer); end if;
  v_elig := app_private.dfp_eligibility(p_order);
  if v_elig = 'not_applicable' then
    return jsonb_build_object('state', 'not_applicable', 'order_number', o.order_number, 'viewer', v_viewer,
      'reason', case when o.fulfilment <> 'delivery' then 'pickup' else 'collected_via_paystack' end, 'delivery_fee_kobo', o.delivery_fee_kobo);
  end if;
  if v_elig in ('ambiguous', 'not_ready') then
    return jsonb_build_object('state', v_elig, 'order_number', o.order_number, 'viewer', v_viewer);
  end if;
  select a.rider_id into v_rider from public.delivery_assignments a where a.order_id = p_order and a.status = 'completed' order by a.assignment_no desc limit 1;
  v_has_bank := exists (select 1 from public.rider_bank_accounts b where b.rider_id = v_rider);
  return jsonb_build_object('state', case when v_has_bank then 'ready_to_open' else 'rider_details_missing' end, 'order_number', o.order_number,
    'viewer', v_viewer, 'amount_kobo', o.delivery_fee_kobo,
    'rider_name', (select full_name from public.rider_profiles where user_id = v_rider));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Actions
-- ---------------------------------------------------------------------------------------------
create function public.open_delivery_fee_payment(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); o public.orders%rowtype; v_elig text; a public.delivery_assignments%rowtype; b public.rider_bank_accounts%rowtype; p public.delivery_fee_payments%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  perform app_private.lock_order_row(p_order);
  select * into o from public.orders where id = p_order;
  if not found or o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.delivery_fee_payments where order_id = p_order;
  if found then return app_private.dfp_json(p, 'customer'); end if;                       -- idempotent: never a second record
  v_elig := app_private.dfp_eligibility(p_order);
  if v_elig <> 'eligible' then
    return jsonb_build_object('state', v_elig, 'opened', false);                           -- no charge is requested for a fee Paystack may have collected, or on ambiguous records
  end if;
  select * into a from public.delivery_assignments where order_id = p_order and status = 'completed' order by assignment_no desc limit 1;
  select * into b from public.rider_bank_accounts where rider_id = a.rider_id;
  if not found then return jsonb_build_object('state', 'rider_details_missing', 'opened', false); end if;
  insert into public.delivery_fee_payments (order_id, assignment_id, customer_id, rider_id, amount_kobo, bank_name, account_number, account_name)
    values (p_order, a.id, o.customer_id, a.rider_id, o.delivery_fee_kobo, b.bank_name, b.account_number, b.account_name)
    on conflict (order_id) do nothing returning * into p;
  if p.id is null then select * into p from public.delivery_fee_payments where order_id = p_order; return app_private.dfp_json(p, 'customer'); end if;
  perform app_private.dfp_event(p.id, v_actor, 'customer', 'opened', null, 'awaiting_transfer', null);
  perform app_private.audit_write(v_actor, 'delivery_fee.opened', 'delivery_fee_payment', p.id::text, jsonb_build_object('order', p_order, 'amount_kobo', p.amount_kobo));
  return app_private.dfp_json(p, 'customer');
end $$;

create function public.report_delivery_fee_transfer(p_payment uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); p public.delivery_fee_payments%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'note_too_long' using errcode = '22023'; end if;
  select * into p from public.delivery_fee_payments where id = p_payment for update;
  if not found or p.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.status <> 'awaiting_transfer' then return app_private.dfp_json(p, 'customer'); end if;   -- repeated report: harmless, state unchanged
  update public.delivery_fee_payments set status = 'customer_reported', customer_reported_at = now(), customer_note = v_note where id = p_payment returning * into p;
  perform app_private.dfp_event(p.id, v_actor, 'customer', 'customer_reported', 'awaiting_transfer', 'customer_reported', v_note);
  perform app_private.audit_write(v_actor, 'delivery_fee.customer_reported', 'delivery_fee_payment', p.id::text, jsonb_build_object('order', p.order_id));
  perform app_private.notify(p.rider_id, 'order', 'A customer says they paid you', 'Check your bank account, then confirm or report a problem.', '/rider/payments', 'dfp-reported-' || p.id::text);
  return app_private.dfp_json(p, 'customer');
end $$;

create function app_private.issue_receipt(p_payment uuid, p_basis text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare p public.delivery_fee_payments%rowtype; v_id uuid; v_order text; v_customer text; v_rider text;
begin
  select * into p from public.delivery_fee_payments where id = p_payment;
  select order_number into v_order from public.orders where id = p.order_id;
  select coalesce(nullif(display_name, ''), 'Customer') into v_customer from public.profiles where id = p.customer_id;
  select coalesce(nullif(full_name, ''), 'Rider') into v_rider from public.rider_profiles where user_id = p.rider_id;
  insert into public.delivery_fee_receipts (payment_id, receipt_number, verify_token, basis, order_number, customer_name, rider_name, amount_kobo, customer_reported_at, rider_confirmed_at)
    values (p_payment, 'AFR-' || to_char(now(), 'YYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(5), 'hex')),
            encode(extensions.gen_random_bytes(24), 'hex'), p_basis, v_order, coalesce(v_customer, 'Customer'), coalesce(v_rider, 'Rider'), p.amount_kobo,
            p.customer_reported_at, case when p_basis = 'customer_and_rider_confirmation' then p.rider_responded_at end)
    on conflict (payment_id) do nothing returning id into v_id;                            -- one authoritative receipt per payment
  return v_id;
end $$;

create function public.respond_delivery_fee_transfer(p_payment uuid, p_response text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); p public.delivery_fee_payments%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_to text;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if p_response not in ('confirm', 'dispute') then raise exception 'invalid_response' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'note_too_long' using errcode = '22023'; end if;
  if p_response = 'dispute' and (v_note is null or char_length(v_note) < 5) then raise exception 'dispute_needs_a_note' using errcode = '22023'; end if;
  select * into p from public.delivery_fee_payments where id = p_payment for update;
  if not found or p.rider_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.status <> 'customer_reported' then
    if p.status = 'awaiting_transfer' then raise exception 'customer_has_not_reported' using errcode = '22023'; end if;
    return app_private.dfp_json(p, 'rider');                                              -- already answered: the answer stands (disputes are only resolved by an administrator)
  end if;
  v_to := case p_response when 'confirm' then 'rider_confirmed' else 'rider_disputed' end;
  update public.delivery_fee_payments set status = v_to, rider_responded_at = now(), rider_note = v_note where id = p_payment returning * into p;
  perform app_private.dfp_event(p.id, v_actor, 'rider', case p_response when 'confirm' then 'rider_confirmed_receipt' else 'rider_disputed' end, 'customer_reported', v_to, v_note);
  perform app_private.audit_write(v_actor, 'delivery_fee.' || case p_response when 'confirm' then 'rider_confirmed' else 'rider_disputed' end, 'delivery_fee_payment', p.id::text, jsonb_build_object('order', p.order_id));
  if p_response = 'confirm' then
    perform app_private.issue_receipt(p.id, 'customer_and_rider_confirmation');
    perform app_private.audit_write(v_actor, 'delivery_fee.receipt_issued', 'delivery_fee_payment', p.id::text, '{}'::jsonb);
  end if;
  perform app_private.notify(p.customer_id, 'order', case p_response when 'confirm' then 'Delivery fee confirmed by the rider' else 'The rider reported a problem' end,
    case p_response when 'confirm' then 'Your receipt is ready.' else 'Open the order to see the details.' end, '/orders/' || p.order_id::text || '/delivery-fee', 'dfp-answered-' || p.id::text);
  return app_private.dfp_json(p, 'rider');
end $$;

-- Authorised, audited resolution of a dispute (the dispute stays in the history; it is never silently overwritten).
create function public.admin_resolve_delivery_fee_dispute(p_payment uuid, p_outcome text, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; p public.delivery_fee_payments%rowtype; v_reason text := btrim(coalesce(p_reason, '')); v_to text;
begin
  v_actor := app_private.require_staff(array['platform_admin', 'finance_admin']::public.app_role[]);
  if p_outcome not in ('received', 'not_received') then raise exception 'invalid_outcome' using errcode = '22023'; end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023'; end if;
  select * into p from public.delivery_fee_payments where id = p_payment for update;
  if not found then raise exception 'unknown payment' using errcode = 'P0002'; end if;
  if p.status <> 'rider_disputed' then raise exception 'only_a_disputed_payment_can_be_resolved' using errcode = '22023'; end if;
  v_to := case p_outcome when 'received' then 'resolved_received' else 'resolved_not_received' end;
  update public.delivery_fee_payments set status = v_to, resolved_at = now(), resolved_by = v_actor, resolution_reason = v_reason where id = p_payment returning * into p;
  perform app_private.dfp_event(p.id, v_actor, 'staff', 'dispute_resolved_' || p_outcome, 'rider_disputed', v_to, v_reason);
  perform app_private.audit_write(v_actor, 'delivery_fee.dispute_resolved', 'delivery_fee_payment', p.id::text, jsonb_build_object('outcome', p_outcome, 'reason', v_reason));
  if p_outcome = 'received' then perform app_private.issue_receipt(p.id, 'administrator_resolution'); end if;
  return app_private.dfp_json(p, 'staff');
end $$;

create function public.admin_void_delivery_fee_receipt(p_receipt uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; r public.delivery_fee_receipts%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_actor := app_private.require_staff(array['platform_admin']::public.app_role[]);
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023'; end if;
  select * into r from public.delivery_fee_receipts where id = p_receipt for update;
  if not found then raise exception 'unknown receipt' using errcode = 'P0002'; end if;
  if r.status = 'void' then raise exception 'already_void' using errcode = '22023'; end if;
  update public.delivery_fee_receipts set status = 'void', voided_at = now(), voided_by = v_actor, void_reason = v_reason where id = p_receipt;
  perform app_private.dfp_event(r.payment_id, v_actor, 'staff', 'receipt_voided', null, null, v_reason);
  perform app_private.audit_write(v_actor, 'delivery_fee.receipt_voided', 'delivery_fee_payment', r.payment_id::text, jsonb_build_object('receipt', r.receipt_number, 'reason', v_reason));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Lists and the public verification
-- ---------------------------------------------------------------------------------------------
create function public.my_delivery_fee_payments() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(app_private.dfp_json(p, case when p.rider_id = v_actor then 'rider' else 'customer' end) - 'history' order by p.opened_at desc), '[]'::jsonb)
            from (select * from public.delivery_fee_payments where rider_id = v_actor or customer_id = v_actor order by opened_at desc limit 50) p);
end $$;

create function public.admin_list_delivery_fee_payments(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['platform_admin', 'finance_admin', 'support_agent']::public.app_role[]);
  if p_status is not null and p_status not in ('awaiting_transfer', 'customer_reported', 'rider_confirmed', 'rider_disputed', 'resolved_received', 'resolved_not_received') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'payments', (select coalesce(jsonb_agg(app_private.dfp_json(p, 'staff') order by p.opened_at desc), '[]'::jsonb)
                   from (select * from public.delivery_fee_payments where p_status is null or status = p_status order by opened_at desc limit 50) p),
    'ambiguous_orders', (select coalesce(jsonb_agg(jsonb_build_object('order_id', x.id, 'order_number', x.order_number) order by x.created_at desc), '[]'::jsonb)
                           from (select id, order_number, created_at from public.orders where delivery_fee_collection = 'direct_to_rider'
                                  and app_private.dfp_eligibility(id) = 'ambiguous' order by created_at desc limit 50) x));
end $$;

-- Public, anonymous: proves the receipt record is authentic, nothing more. No names, no bank details, no evidence.
create function public.verify_delivery_fee_receipt(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare r public.delivery_fee_receipts%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return jsonb_build_object('valid', false); end if;
  select * into r from public.delivery_fee_receipts where verify_token = p_token;
  if not found then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object('valid', true, 'receipt_number', r.receipt_number, 'status', r.status, 'issued_at', r.issued_at,
    'amount_kobo', r.amount_kobo, 'currency', r.currency, 'payment_method', 'Direct Bank Transfer', 'basis', r.basis,
    'customer_reported', r.customer_reported_at is not null, 'rider_confirmed', r.rider_confirmed_at is not null);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.rider_set_bank_details(text, text, text)', 'public.my_rider_bank_details()', 'public.delivery_fee_payment_for_order(uuid)',
    'public.open_delivery_fee_payment(uuid)', 'public.report_delivery_fee_transfer(uuid, text)', 'public.respond_delivery_fee_transfer(uuid, text, text)',
    'public.admin_resolve_delivery_fee_dispute(uuid, text, text)', 'public.admin_void_delivery_fee_receipt(uuid, text)',
    'public.my_delivery_fee_payments()', 'public.admin_list_delivery_fee_payments(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke all on function public.verify_delivery_fee_receipt(text) from public;
  grant execute on function public.verify_delivery_fee_receipt(text) to anon, authenticated, service_role;
  foreach f in array array['app_private.mask_account(text)', 'app_private.dfp_event(uuid, uuid, text, text, text, text, text)', 'app_private.dfp_eligibility(uuid)',
                           'app_private.dfp_json(public.delivery_fee_payments, text)', 'app_private.issue_receipt(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
