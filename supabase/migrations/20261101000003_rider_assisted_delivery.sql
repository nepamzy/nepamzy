-- Hand-off at the door is led by the rider. Two ways to confirm a delivery:
--   1. SIGNATURES: the customer signs on the RIDER's phone, the server checks it against the signature the customer
--      registered at sign-up, then the rider signs too. Both drawings are kept with the order.
--   2. QR CODE: the rider's phone shows a QR code linked to the order; the customer scans it with their own phone,
--      signed in, and taps to confirm.
-- The customer no longer has to remember to confirm from their own phone. The signature comparison is done by the server
-- (it needs the stored signature), so the signature route is a service-role-only function: a rider cannot call it directly
-- to skip the comparison. Nothing here moves money.

alter table public.handover_evidence
  add column rider_signature_png bytea check (rider_signature_png is null or octet_length(rider_signature_png) between 300 and 400000),
  add column confirmation_channel text not null default 'customer_signature'
    check (confirmation_channel in ('customer_signature', 'rider_phone', 'qr'));

alter table public.handover_evidence drop constraint handover_evidence_capture_method_check;
alter table public.handover_evidence add constraint handover_evidence_capture_method_check
  check (capture_method in ('drawn', 'typed_acknowledgement', 'qr'));
alter table public.handover_evidence drop constraint handover_evidence_method_shape;
alter table public.handover_evidence add constraint handover_evidence_method_shape check (
  (capture_method = 'drawn' and signature_png is not null and octet_length(signature_png) between 300 and 400000 and typed_text is null)
  or (capture_method = 'typed_acknowledgement' and signature_png is null and typed_text is not null
      and char_length(typed_text) between 2 and 120)
  or (capture_method = 'qr' and signature_png is null and typed_text is null));
alter table public.handover_evidence drop constraint handover_evidence_kind_shape;
alter table public.handover_evidence add constraint handover_evidence_kind_shape check (
  (evidence_kind = 'delivery') = (assignment_id is not null and proof_session_id is not null)
  and (evidence_kind = 'pickup' or capture_method in ('drawn', 'qr')));

-- QR codes the rider opens for one arrived delivery. Only a hash of the code is stored.
create table public.delivery_qr_codes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  assignment_id uuid not null references public.delivery_assignments (id) on delete restrict,
  created_by uuid not null references auth.users (id) on delete restrict,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  invalidated_at timestamptz,
  failed_attempts int not null default 0,
  created_at timestamptz not null default now()
);
create unique index delivery_qr_one_live on public.delivery_qr_codes (assignment_id)
  where used_at is null and invalidated_at is null;
alter table public.delivery_qr_codes enable row level security;
revoke all on public.delivery_qr_codes from public, anon, authenticated;
grant all on public.delivery_qr_codes to service_role;

-- Shared tail of every delivery confirmation: close the job, step the order to COMPLETED, free the rider's location.
create function app_private.close_delivery(p_order uuid, p_assignment public.delivery_assignments, p_actor uuid,
                                           p_channel text, p_session uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.delivery_assignments set status = 'completed', completed_at = now() where id = p_assignment.id;
  perform app_private.step_order(p_order, 'AWAITING_RECIPIENT_PROOF', 'DELIVERED', p_actor, 'recipient_confirmed_' || p_channel);
  perform app_private.step_order(p_order, 'DELIVERED', 'COMPLETED', p_actor, 'delivery_completed');
  if not exists (select 1 from public.delivery_assignments d where d.rider_id = p_assignment.rider_id
                  and d.status in ('accepted', 'picked_up', 'en_route')) then
    delete from public.rider_location_current where rider_id = p_assignment.rider_id;
  end if;
  perform app_private.audit_write(p_actor, 'delivery.completed', 'order', p_order::text,
    jsonb_build_object('assignment', p_assignment.id, 'channel', p_channel, 'session', p_session));
end $$;
revoke all on function app_private.close_delivery(uuid, public.delivery_assignments, uuid, text, uuid) from public, anon, authenticated;

-- A used proof session row is what delivery evidence points at; create one for a confirmation that did not use the old flow.
create function app_private.used_proof_session(p_order uuid, p_assignment uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  update public.delivery_proof_sessions set invalidated_at = now()
   where assignment_id = p_assignment and used_at is null and invalidated_at is null;
  insert into public.delivery_proof_sessions (order_id, assignment_id, created_by, token_hash, expires_at, used_at)
    values (p_order, p_assignment, p_actor, encode(extensions.digest(encode(extensions.gen_random_bytes(16), 'hex'), 'sha256'), 'hex'),
            now(), now())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function app_private.used_proof_session(uuid, uuid, uuid) from public, anon, authenticated;

-- 1. SIGNATURES, on the rider's phone. Service role only: the app compares the customer's drawing with the saved one first.
create function public.rider_delivery_complete(p_actor uuid, p_order uuid, p_recipient text,
                                               p_customer_sig bytea, p_rider_sig bytea) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype; v_s uuid;
begin
  if p_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.fulfilment <> 'delivery' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if v_o.status in ('DELIVERED', 'COMPLETED') and exists (select 1 from public.handover_evidence e
                                                          where e.order_id = p_order and e.evidence_kind = 'delivery') then
    return jsonb_build_object('ok', false, 'reason', 'already_completed');
  end if;
  if v_o.status not in ('ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  select * into v_a from public.delivery_assignments
   where order_id = p_order and status in ('accepted', 'picked_up', 'en_route') for update;
  if not found or v_a.status <> 'en_route' or v_a.arrival_detected_at is null then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if v_a.rider_id <> p_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_o.customer_id = p_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_recipient is null or char_length(btrim(p_recipient)) not between 2 and 80 then
    raise exception 'recipient_required' using errcode = '22023';
  end if;
  if p_customer_sig is null or p_rider_sig is null
     or octet_length(p_customer_sig) not between 300 and 400000 or octet_length(p_rider_sig) not between 300 and 400000
     or get_byte(p_customer_sig, 0) <> 137 or get_byte(p_customer_sig, 1) <> 80 or get_byte(p_customer_sig, 2) <> 78 or get_byte(p_customer_sig, 3) <> 71
     or get_byte(p_rider_sig, 0) <> 137 or get_byte(p_rider_sig, 1) <> 80 or get_byte(p_rider_sig, 2) <> 78 or get_byte(p_rider_sig, 3) <> 71 then
    raise exception 'signature_required' using errcode = '22023';
  end if;
  if v_o.status = 'ARRIVAL_DETECTED' then
    perform app_private.step_order(p_order, 'ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF', p_actor, 'rider_opened_handover');
  end if;
  v_s := app_private.used_proof_session(p_order, v_a.id, p_actor);
  insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by, capture_method,
                                        evidence_kind, assignment_id, proof_session_id, arrival_detected_at,
                                        rider_signature_png, confirmation_channel)
    values (p_order, btrim(p_recipient), p_customer_sig, encode(extensions.digest(p_customer_sig, 'sha256'), 'hex'), p_actor, 'drawn',
            'delivery', v_a.id, v_s, v_a.arrival_detected_at, p_rider_sig, 'rider_phone');
  perform app_private.close_delivery(p_order, v_a, p_actor, 'rider_phone', v_s);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.rider_delivery_complete(uuid, uuid, text, bytea, bytea) from public, anon, authenticated;
grant execute on function public.rider_delivery_complete(uuid, uuid, text, bytea, bytea) to service_role;

-- 2a. QR: the rider opens a code for the arrived delivery (valid for ten minutes, one live code per delivery).
create function public.rider_qr_open(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype;
        v_token text; v_exp timestamptz;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.fulfilment <> 'delivery' or v_o.status not in ('ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  select * into v_a from public.delivery_assignments
   where order_id = p_order and status = 'en_route' and arrival_detected_at is not null for update;
  if not found or v_a.rider_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.delivery_qr_codes set invalidated_at = now()
   where assignment_id = v_a.id and used_at is null and invalidated_at is null;
  v_token := upper(encode(extensions.gen_random_bytes(10), 'hex'));
  v_exp := now() + interval '10 minutes';
  insert into public.delivery_qr_codes (order_id, assignment_id, created_by, token_hash, expires_at)
    values (p_order, v_a.id, v_actor, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_exp);
  perform app_private.audit_write(v_actor, 'delivery_qr.opened', 'order', p_order::text, '{}'::jsonb);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;
revoke all on function public.rider_qr_open(uuid) from public, anon;
grant execute on function public.rider_qr_open(uuid) to authenticated;

-- 2b. QR: the signed-in customer scans and confirms. Five wrong tries lock the code.
create function public.customer_qr_confirm(p_order uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype;
        v_q public.delivery_qr_codes%rowtype; v_s uuid; v_name text;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if v_o.status in ('DELIVERED', 'COMPLETED') and exists (select 1 from public.handover_evidence e
                                                          where e.order_id = p_order and e.evidence_kind = 'delivery') then
    return jsonb_build_object('ok', false, 'reason', 'already_completed');
  end if;
  if v_o.fulfilment <> 'delivery' or v_o.status not in ('ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  select * into v_a from public.delivery_assignments
   where order_id = p_order and status = 'en_route' and arrival_detected_at is not null for update;
  if not found then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if v_a.rider_id = v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_q from public.delivery_qr_codes
   where order_id = p_order and assignment_id = v_a.id and used_at is null and invalidated_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'qr_unavailable'); end if;
  if v_q.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'qr_expired'); end if;
  if v_q.failed_attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'qr_locked'); end if;
  if encode(extensions.digest(upper(btrim(coalesce(p_token, ''))), 'sha256'), 'hex') <> v_q.token_hash then
    update public.delivery_qr_codes set failed_attempts = failed_attempts + 1 where id = v_q.id;
    perform app_private.audit_write(v_actor, 'delivery_qr.wrong_token', 'order', p_order::text, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'reason', 'wrong_qr');
  end if;
  update public.delivery_qr_codes set used_at = now() where id = v_q.id;
  select coalesce(nullif(btrim(p.display_name), ''), 'Customer') into v_name from public.profiles p where p.id = v_actor;
  if v_o.status = 'ARRIVAL_DETECTED' then
    perform app_private.step_order(p_order, 'ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF', v_actor, 'recipient_scanned_qr');
  end if;
  v_s := app_private.used_proof_session(p_order, v_a.id, v_actor);
  insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by, capture_method,
                                        evidence_kind, assignment_id, proof_session_id, arrival_detected_at, confirmation_channel)
    values (p_order, coalesce(v_name, 'Customer'), null, v_q.token_hash, v_actor, 'qr',
            'delivery', v_a.id, v_s, v_a.arrival_detected_at, 'qr');
  perform app_private.close_delivery(p_order, v_a, v_actor, 'qr', v_s);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.customer_qr_confirm(uuid, text) from public, anon;
grant execute on function public.customer_qr_confirm(uuid, text) to authenticated;
