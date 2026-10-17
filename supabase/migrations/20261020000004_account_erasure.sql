-- Account erasure that respects financial-record integrity (Final Platform Completion, item 5.2).
--
-- PRINCIPLE: personal data is removed or anonymised; the financial and audit skeleton stays, because orders, payments, ledger
-- entries, refunds, settlement lines, receipts and the audit trail refer to the account by id and must not be silently destroyed.
-- The auth.users row is kept as an anonymous TOMBSTONE (random placeholder address, no password, banned, no sessions, no factors,
-- no identities, no roles), so those foreign keys stay valid and nothing cascades into the accounting model.
--
-- WHO / WHEN: only a platform administrator (aal2, with a recorded reason), usually in answer to a data request. Erasure is REFUSED,
-- and nothing is changed, while the account still has an unfinished obligation (open orders, refunds, reports, returns, unresolved
-- delivery-fee payments, active deliveries, an active shop, staff roles). The refusal lists the blocker codes.
-- IDEMPOTENT: a repeat call returns the stored result.
--
-- WHAT IS KEPT (and why): orders/order items, payments, ledger, refunds, settlement lines and the audit trail (financial integrity;
-- they carry only the pseudonymous user id); receipts (verification must keep working, with names replaced by 'Former customer' /
-- 'Former rider'); dispute records and append-only event notes the person wrote (evidence, cannot be edited by design);
-- published reviews (shown without identity). NO RETENTION PERIOD IS INVENTED HERE: how long financial records must be kept, and
-- when the retained free text may be purged, needs qualified Nigerian legal and tax advice (docs/known-issues.md).

create table public.account_erasures (
  user_id uuid primary key references auth.users (id) on delete restrict,
  erased_at timestamptz not null default now(),
  erased_by uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 500),
  data_request_id uuid references public.data_requests (id) on delete set null,
  retained jsonb not null default '[]'::jsonb
);
alter table public.account_erasures enable row level security;
revoke all on public.account_erasures from public, anon, authenticated;
create policy account_erasures_aal2 on public.account_erasures as restrictive for all to authenticated using (app_private.is_aal2());
grant all on public.account_erasures to service_role;
create trigger account_erasures_append_only before update or delete on public.account_erasures
  for each row execute function app_private.deny_mutation();
create trigger account_erasures_no_truncate before truncate on public.account_erasures
  for each statement execute function app_private.deny_mutation();

-- Receipts: the ONLY other change a receipt may undergo is replacing a person's name by the fixed placeholder.
create or replace function app_private.receipt_guard() returns trigger
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
  -- anonymisation: only the two name columns, only to the fixed placeholders, nothing else changes
  if (new.id, new.payment_id, new.receipt_number, new.verify_token, new.basis, new.order_number, new.amount_kobo, new.currency,
      new.customer_reported_at, new.rider_confirmed_at, new.issued_at, new.status, new.voided_at, new.voided_by, new.void_reason)
         is not distinct from
     (old.id, old.payment_id, old.receipt_number, old.verify_token, old.basis, old.order_number, old.amount_kobo, old.currency,
      old.customer_reported_at, old.rider_confirmed_at, old.issued_at, old.status, old.voided_at, old.voided_by, old.void_reason)
     and (new.customer_name = old.customer_name or new.customer_name = 'Former customer')
     and (new.rider_name = old.rider_name or new.rider_name = 'Former rider') then
    return new;
  end if;
  raise exception 'a receipt can only be voided' using errcode = '42501';
end $$;

-- Why an account cannot be erased yet. Empty array = nothing blocks.
create function app_private.erasure_blockers(p_user uuid) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare b text[] := '{}';
begin
  if exists (select 1 from public.role_assignments where user_id = p_user and status = 'active'
              and role in ('platform_admin', 'finance_admin', 'support_agent')) then b := array_append(b, 'staff_account'); end if;
  if exists (select 1 from public.orders where customer_id = p_user
              and status not in ('COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'RETURNED_TO_VENDOR')) then b := array_append(b, 'open_orders'); end if;
  if exists (select 1 from public.refunds r join public.orders o on o.id = r.order_id
              where o.customer_id = p_user and r.status in ('requested', 'under_review', 'approved', 'processing', 'reconciliation_required')) then
    b := array_append(b, 'open_refunds'); end if;
  if exists (select 1 from public.support_cases where reporter_id = p_user and status <> 'closed') then b := array_append(b, 'open_reports'); end if;
  if exists (select 1 from public.return_requests where customer_id = p_user and status in ('requested', 'approved', 'received_by_vendor')) then
    b := array_append(b, 'open_returns'); end if;
  if exists (select 1 from public.delivery_fee_payments where (customer_id = p_user or rider_id = p_user)
              and status in ('awaiting_transfer', 'customer_reported', 'rider_disputed')) then b := array_append(b, 'open_delivery_fee_payments'); end if;
  if exists (select 1 from public.delivery_assignments where rider_id = p_user and status in ('accepted', 'picked_up', 'en_route')) then
    b := array_append(b, 'active_deliveries'); end if;
  if exists (select 1 from public.rider_issues where rider_id = p_user and status = 'open') then b := array_append(b, 'open_rider_issues'); end if;
  if exists (select 1 from public.vendors where owner_id = p_user and status <> 'suspended') then b := array_append(b, 'owns_active_shop'); end if;
  return b;
end $$;
revoke all on function app_private.erasure_blockers(uuid) from public, anon, authenticated;

create function public.admin_erase_account(p_user uuid, p_reason text, p_data_request uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid; v_reason text := btrim(coalesce(p_reason, '')); v_blockers text[]; v_prior public.account_erasures%rowtype;
  v_retained jsonb := '["orders and order items","payments, ledger, refunds and settlement lines","audit trail (pseudonymous user id only)","receipts (names replaced)","dispute and report records and append-only notes","published reviews (no identity shown)"]'::jsonb;
begin
  v_actor := app_private.require_staff(array['platform_admin']::public.app_role[]);
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown account' using errcode = 'P0002'; end if;
  if p_user = v_actor then raise exception 'administrators cannot erase their own account' using errcode = '42501'; end if;

  select * into v_prior from public.account_erasures where user_id = p_user;
  if found then return jsonb_build_object('erased', true, 'already_erased', true, 'erased_at', v_prior.erased_at, 'retained', v_prior.retained); end if;

  v_blockers := app_private.erasure_blockers(p_user);
  if cardinality(v_blockers) > 0 then
    perform app_private.audit_write(v_actor, 'account.erasure_refused', 'user', p_user::text, jsonb_build_object('blockers', to_jsonb(v_blockers)));
    return jsonb_build_object('erased', false, 'blockers', to_jsonb(v_blockers));
  end if;

  -- 1. access: no sessions, factors, identities or roles; the account cannot sign in again
  delete from auth.sessions where user_id = p_user;
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.identities where user_id = p_user;
  update auth.users set email = 'erased-' || p_user::text || '@erased.invalid', phone = null, encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity', email_confirmed_at = null, updated_at = now() where id = p_user;
  update public.role_assignments set status = 'revoked', revoked_by = v_actor, revoked_at = now() where user_id = p_user and status = 'active';
  delete from public.vendor_staff where user_id = p_user;

  -- 2. personal data
  update public.profiles set display_name = null where id = p_user;
  delete from public.rider_bank_accounts where rider_id = p_user;
  update public.rider_profiles set full_name = 'Former rider', contact_phone = '0000000000', status = 'suspended' where user_id = p_user;
  update public.rider_applications set full_name = 'Erased', contact_phone = '0000000', vehicle_note = null where applicant_id = p_user;
  update public.vendor_applications set contact_phone = '0000000' where applicant_id = p_user;
  delete from public.rider_location_current where rider_id = p_user;
  delete from public.rider_location_history where rider_id = p_user;
  delete from public.carts where user_id = p_user;
  delete from public.notification_preferences where user_id = p_user;
  update public.notifications set title = 'Erased', body = 'Erased', link = null where user_id = p_user;
  update public.data_requests set detail = null where user_id = p_user;

  -- 3. financial snapshots that held personal data (the records themselves stay)
  update public.delivery_fee_payments set bank_name = '(erased)', account_name = '(erased)', account_number = null, account_cipher = null,
         account_last4 = null, details_erased = true, customer_note = case when customer_id = p_user then null else customer_note end,
         rider_note = case when rider_id = p_user then null else rider_note end
   where (rider_id = p_user) or (customer_id = p_user and customer_note is not null);
  update public.delivery_fee_receipts r set customer_name = 'Former customer'
    from public.delivery_fee_payments p where p.id = r.payment_id and p.customer_id = p_user;
  update public.delivery_fee_receipts r set rider_name = 'Former rider'
    from public.delivery_fee_payments p where p.id = r.payment_id and p.rider_id = p_user;

  insert into public.account_erasures (user_id, erased_by, reason, data_request_id, retained) values (p_user, v_actor, v_reason, p_data_request, v_retained);
  if p_data_request is not null then
    update public.data_requests set status = 'completed', handled_by = v_actor, handled_at = now(),
           response_note = 'Account erased. Records the business must keep (payments, orders, audit trail) were kept without personal details.'
     where id = p_data_request and user_id = p_user and status in ('open', 'in_progress');
  end if;
  perform app_private.audit_write(v_actor, 'account.erased', 'user', p_user::text, jsonb_build_object('reason', v_reason, 'data_request', p_data_request));
  return jsonb_build_object('erased', true, 'already_erased', false, 'retained', v_retained);
end $$;
revoke all on function public.admin_erase_account(uuid, text, uuid) from public, anon;
grant execute on function public.admin_erase_account(uuid, text, uuid) to authenticated, service_role;

create function public.admin_erasure_preview(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  return jsonb_build_object('erased', exists (select 1 from public.account_erasures where user_id = p_user),
                            'blockers', to_jsonb(app_private.erasure_blockers(p_user)));
end $$;
revoke all on function public.admin_erasure_preview(uuid) from public, anon;
grant execute on function public.admin_erasure_preview(uuid) to authenticated, service_role;

-- The administrator list also carries the account id (needed to preview and run an erasure) and whether it was already erased.
create or replace function public.admin_list_data_requests(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  if p_status is not null and p_status not in ('open', 'in_progress', 'completed', 'declined') then raise exception 'invalid_status' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'detail', r.detail,
            'response_note', r.response_note, 'created_at', r.created_at, 'handled_at', r.handled_at, 'user_id', r.user_id,
            'erased', exists (select 1 from public.account_erasures e where e.user_id = r.user_id),
            'requester', (select u.email from auth.users u where u.id = r.user_id)) order by r.created_at), '[]'::jsonb)
            from (select * from public.data_requests where (p_status is null or status = p_status) order by created_at limit 50) r);
end $$;
