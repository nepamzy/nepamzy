-- Batch 4, part A: carried-forward corrections.
--  * The pickup-code pepper no longer lives in the database. The application server derives the code from a
--    server-only secret (PICKUP_CODE_SECRET); the database keeps only a nonce and, once registered, the hash.
--  * Handover evidence records HOW it was captured. A typed acknowledgement is available only when the owner
--    switches `typed_signature_enabled` on (default off): it is never presented as a drawn signature.

-- 1. Pepper out of the database ----------------------------------------------------------------
drop function app_private.pickup_code_for(uuid, text);
drop table app_private.secrets;
alter table public.pickup_codes alter column code_hash drop not null;

-- 2. Evidence capture method --------------------------------------------------------------------
alter table public.handover_evidence drop constraint handover_evidence_signature_png_check;
alter table public.handover_evidence alter column signature_png drop not null;
alter table public.handover_evidence
  add column capture_method text not null default 'drawn' check (capture_method in ('drawn', 'typed_acknowledgement')),
  add column typed_text text;
alter table public.handover_evidence
  add constraint handover_evidence_method_shape check (
    (capture_method = 'drawn' and signature_png is not null and octet_length(signature_png) between 300 and 400000 and typed_text is null)
    or (capture_method = 'typed_acknowledgement' and signature_png is null and typed_text is not null
        and char_length(typed_text) between 2 and 120));

insert into public.platform_settings (key, value, note)
values ('typed_signature_enabled', 'false'::jsonb,
        'OWNER DECISION: allow a typed acknowledgement when the recipient cannot draw. Off until the owner/counsel decide.')
on conflict (key) do nothing;

-- 3. Pickup code: server registers the hash of the code it derived (once) -------------------------
create or replace function public.pickup_code_register(p_order uuid, p_hash text) returns boolean
language sql security definer set search_path = ''
as $$
  with u as (
    update public.pickup_codes set code_hash = p_hash
     where order_id = p_order and code_hash is null and used_at is null and p_hash ~ '^[0-9a-f]{64}$'
    returning 1)
  select exists (select 1 from u)
$$;
revoke all on function public.pickup_code_register(uuid, text) from public, anon, authenticated;
grant execute on function public.pickup_code_register(uuid, text) to service_role;

create or replace function public.get_pickup_code(p_order uuid) returns jsonb
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
  -- The server turns (order, nonce) into the code with its secret; the database never sees the code itself.
  return jsonb_build_object('available', true, 'nonce', v_c.nonce, 'registered', v_c.code_hash is not null,
                            'expires_at', v_c.expires_at);
end $$;

-- 5. mark_ready no longer derives the code in the database
create or replace function public.vendor_transition_order(p_order uuid, p_action text, p_reason text default null) returns text
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
      -- The code itself is derived by the application server from a server-only secret; the database only
      -- stores a nonce now and the hash of the code once the server registers it (pickup_code_register).
      v_nonce := encode(extensions.gen_random_bytes(12), 'hex');
      insert into public.pickup_codes (order_id, nonce, code_hash, expires_at)
        values (p_order, v_nonce, null, now() + interval '48 hours');
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

-- 4. Complete pickup: code + recipient + evidence (drawn signature, or typed acknowledgement when enabled) ---
drop function public.complete_pickup(uuid, text, text, bytea);
create function public.complete_pickup(p_order uuid, p_code text, p_recipient text, p_signature bytea,
                                       p_method text default 'drawn', p_typed text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_c public.pickup_codes%rowtype; v_hash text;
        v_typed_ok boolean;
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
  if p_method = 'drawn' then
    if p_signature is null or octet_length(p_signature) not between 300 and 400000
       or get_byte(p_signature, 0) <> 137 or get_byte(p_signature, 1) <> 80 or get_byte(p_signature, 2) <> 78 or get_byte(p_signature, 3) <> 71 then
      raise exception 'signature_required' using errcode = '22023';
    end if;
  elsif p_method = 'typed_acknowledgement' then
    select coalesce((select (s.value #>> '{}') = 'true' from public.platform_settings s where s.key = 'typed_signature_enabled'), false)
      into v_typed_ok;
    if not v_typed_ok then raise exception 'typed_signature_disabled' using errcode = '42501'; end if;
    if p_typed is null or char_length(btrim(p_typed)) not between 2 and 120 or p_signature is not null then
      raise exception 'signature_required' using errcode = '22023';
    end if;
  else
    raise exception 'signature_required' using errcode = '22023';
  end if;
  select * into v_c from public.pickup_codes where order_id = p_order for update;
  if not found or v_c.used_at is not null or v_c.expires_at <= now() or v_c.code_hash is null then
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
  insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by, capture_method, typed_text)
    values (p_order, btrim(p_recipient), case when p_method = 'drawn' then p_signature end,
            case when p_method = 'drawn' then encode(extensions.digest(p_signature, 'sha256'), 'hex')
                 else encode(extensions.digest(btrim(p_typed), 'sha256'), 'hex') end,
            v_actor, p_method, case when p_method = 'typed_acknowledgement' then btrim(p_typed) end);
  perform app_private.step_order(p_order, 'PICKUP_AWAITING_HANDOVER', 'COMPLETED', v_actor, 'pickup_completed:' || p_method);
  perform app_private.audit_write(v_actor, 'pickup.completed', 'order', p_order::text, jsonb_build_object('method', p_method));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.complete_pickup(uuid, text, text, bytea, text, text) from public, anon;
grant execute on function public.complete_pickup(uuid, text, text, bytea, text, text) to authenticated, service_role;
