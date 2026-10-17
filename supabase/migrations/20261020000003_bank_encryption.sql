-- Encryption at rest for rider bank account numbers (Final Platform Completion, item 5.1).
--
-- DESIGN: application-level authenticated encryption (AES-256-GCM, key id + random 96-bit IV, see src/server/security/field-crypto.ts).
-- The Next.js server encrypts the account number BEFORE it reaches the database; the keys live only in server environment
-- configuration, never in the database. The database stores an opaque cipher string plus the last four digits (for masked
-- display) and cannot decrypt anything. The payment snapshot copies the cipher, so later edits still never redirect a payment.
-- Only the customer's own pay screen decrypts, server-side, for the payer of that order. Staff and riders see masked numbers.
--
-- LEGACY ROWS: accounts saved before this migration hold a plaintext account_number. They are NOT destroyed: the column becomes
-- nullable, the row keeps working, and scripts/encrypt-bank-details.mjs (service role + the key) encrypts them in place and
-- clears the plaintext. admin_bank_encryption_status() shows how many plaintext rows remain. Rotation uses the same script.

alter table public.rider_bank_accounts drop constraint rider_bank_accounts_account_number_check;
alter table public.rider_bank_accounts alter column account_number drop not null;
alter table public.rider_bank_accounts add column account_cipher text, add column account_last4 text;
alter table public.rider_bank_accounts
  add constraint rba_plain_format check (account_number is null or account_number ~ '^[0-9]{10}$'),
  add constraint rba_cipher_format check (account_cipher is null or account_cipher ~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,200}$'),
  add constraint rba_last4_format check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  add constraint rba_cipher_has_last4 check ((account_cipher is null) = (account_last4 is null)),
  add constraint rba_has_number check (account_number is not null or account_cipher is not null);

alter table public.delivery_fee_payments drop constraint delivery_fee_payments_account_number_check;
alter table public.delivery_fee_payments alter column account_number drop not null;
alter table public.delivery_fee_payments add column account_cipher text, add column account_last4 text, add column details_erased boolean not null default false;
alter table public.delivery_fee_payments
  add constraint dfp_plain_format check (account_number is null or account_number ~ '^[0-9]{10}$'),
  add constraint dfp_cipher_format check (account_cipher is null or account_cipher ~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,200}$'),
  add constraint dfp_last4_format check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  add constraint dfp_cipher_has_last4 check ((account_cipher is null) = (account_last4 is null) or details_erased),
  add constraint dfp_has_number check (account_number is not null or account_cipher is not null or details_erased);

create function app_private.mask_last4(p_last4 text) returns text
language sql immutable set search_path = ''
as $$ select case when p_last4 is null then null else repeat('*', 6) || p_last4 end $$;
revoke all on function app_private.mask_last4(text) from public, anon, authenticated;

-- The only way to save bank details: the app sends ciphertext, never the plain number. The previous plaintext function is removed.
drop function public.rider_set_bank_details(text, text, text);
create function public.rider_set_bank_details(p_bank text, p_cipher text, p_last4 text, p_name text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_bank text := btrim(coalesce(p_bank, '')); v_name text := btrim(coalesce(p_name, ''));
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('rider') or not exists (select 1 from public.rider_profiles where user_id = v_actor and status <> 'suspended') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_bank) < 2 or char_length(v_bank) > 60 or char_length(v_name) < 2 or char_length(v_name) > 80
     or v_bank ~ '[[:cntrl:]]' or v_name ~ '[[:cntrl:]]'
     or p_cipher is null or p_cipher !~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,200}$'
     or p_last4 is null or p_last4 !~ '^[0-9]{4}$' then
    raise exception 'invalid_bank_details' using errcode = '22023';
  end if;
  insert into public.rider_bank_accounts (rider_id, bank_name, account_number, account_cipher, account_last4, account_name)
    values (v_actor, v_bank, null, p_cipher, p_last4, v_name)
    on conflict (rider_id) do update set bank_name = excluded.bank_name, account_number = null, account_cipher = excluded.account_cipher,
      account_last4 = excluded.account_last4, account_name = excluded.account_name, updated_at = now();
  perform app_private.audit_write(v_actor, 'rider.bank_details_set', 'rider', v_actor::text, jsonb_build_object('bank', v_bank, 'account_ending', p_last4));
  return jsonb_build_object('saved', true, 'bank_name', v_bank, 'account_name', v_name, 'account_masked', app_private.mask_last4(p_last4));
end $$;
revoke all on function public.rider_set_bank_details(text, text, text, text) from public, anon;
grant execute on function public.rider_set_bank_details(text, text, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.dfp_json(p delivery_fee_payments, p_viewer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'account_masked', coalesce(app_private.mask_last4(p.account_last4), app_private.mask_account(p.account_number)),
    'account_cipher', case when p_viewer = 'customer' then p.account_cipher end,
    'account_number_legacy', case when p_viewer = 'customer' and p.account_cipher is null then p.account_number end,
    'details_erased', p.details_erased,
    'opened_at', p.opened_at, 'customer_reported_at', p.customer_reported_at, 'customer_note', p.customer_note,
    'rider_responded_at', p.rider_responded_at, 'rider_note', p.rider_note,
    'resolved_at', p.resolved_at, 'resolution_reason', p.resolution_reason,
    'receipt', case when r.id is null then null else jsonb_build_object('id', r.id, 'number', r.receipt_number, 'status', r.status,
                 'basis', r.basis, 'issued_at', r.issued_at, 'token', case when p_viewer in ('customer', 'rider') then r.verify_token end) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'actor_role', e.actor_role, 'to_status', e.to_status, 'at', e.created_at, 'note', e.note) order by e.id), '[]'::jsonb)
                  from public.delivery_fee_payment_events e where e.payment_id = p.id));
end $function$;

CREATE OR REPLACE FUNCTION public.my_rider_bank_details()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := (select auth.uid()); b public.rider_bank_accounts%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('rider') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into b from public.rider_bank_accounts where rider_id = v_actor;
  if not found then return jsonb_build_object('set', false); end if;
  return jsonb_build_object('set', true, 'bank_name', b.bank_name, 'account_name', b.account_name,
                            'account_masked', coalesce(app_private.mask_last4(b.account_last4), app_private.mask_account(b.account_number)),
                            'encrypted', b.account_cipher is not null, 'updated_at', b.updated_at);
end $function$;

CREATE OR REPLACE FUNCTION public.open_delivery_fee_payment(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  insert into public.delivery_fee_payments (order_id, assignment_id, customer_id, rider_id, amount_kobo, bank_name, account_number, account_cipher, account_last4, account_name)
    values (p_order, a.id, o.customer_id, a.rider_id, o.delivery_fee_kobo, b.bank_name, b.account_number, b.account_cipher, b.account_last4, b.account_name)
    on conflict (order_id) do nothing returning * into p;
  if p.id is null then select * into p from public.delivery_fee_payments where order_id = p_order; return app_private.dfp_json(p, 'customer'); end if;
  perform app_private.dfp_event(p.id, v_actor, 'customer', 'opened', null, 'awaiting_transfer', null);
  perform app_private.audit_write(v_actor, 'delivery_fee.opened', 'delivery_fee_payment', p.id::text, jsonb_build_object('order', p_order, 'amount_kobo', p.amount_kobo));
  return app_private.dfp_json(p, 'customer');
end $function$;

create function public.admin_bank_encryption_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  return jsonb_build_object(
    'rider_accounts_total', (select count(*) from public.rider_bank_accounts),
    'rider_accounts_plaintext', (select count(*) from public.rider_bank_accounts where account_number is not null),
    'payment_snapshots_total', (select count(*) from public.delivery_fee_payments where not details_erased),
    'payment_snapshots_plaintext', (select count(*) from public.delivery_fee_payments where account_number is not null));
end $$;
revoke all on function public.admin_bank_encryption_status() from public, anon;
grant execute on function public.admin_bank_encryption_status() to authenticated, service_role;
