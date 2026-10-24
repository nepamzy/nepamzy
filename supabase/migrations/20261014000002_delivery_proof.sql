-- Batch 5, Phase 9: delivery proof, recipient signature and server-authoritative completion.
-- Rules enforced HERE (not in the browser):
--   * only the order's customer (the recipient; delivery to a different person is not modelled, K47) can complete a
--     delivery, at aal2, after the server has detected arrival; the rider has NO completion action;
--   * a drawn signature is mandatory; a typed acknowledgement is refused for deliveries (owner decision K27 outstanding);
--   * a one-time, expiring, hashed proof-session token binds the signature to the CURRENT assignment (a stale page, an
--     old assignment or another order cannot complete this one);
--   * evidence is written once (primary key on order) and is immutable; the assignment is completed in the same
--     transaction, which frees the rider's slot and stops location sharing when no work remains.

-- ---------------------------------------------------------------------------------------------
-- Terminal assignment status. The two "active" unique indexes list the active statuses explicitly
-- (accepted, picked_up, en_route), so 'completed' automatically frees the slot and the order.
-- ---------------------------------------------------------------------------------------------
alter table public.delivery_assignments drop constraint delivery_assignments_status_check;
alter table public.delivery_assignments add constraint delivery_assignments_status_check
  check (status in ('accepted', 'picked_up', 'en_route', 'released', 'completed'));
alter table public.delivery_assignments add column completed_at timestamptz;
alter table public.delivery_assignments add constraint delivery_assignments_complete_shape
  check ((status = 'completed') = (completed_at is not null));

-- ---------------------------------------------------------------------------------------------
-- Settings (placeholders)
-- ---------------------------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('delivery_proof_ttl_minutes', '20'::jsonb, 'PLACEHOLDER: how long a recipient confirmation session lasts')
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
  if p_key in ('delivery_fee_kobo', 'platform_fee_bps', 'unpaid_order_expiry_minutes', 'max_cart_item_quantity',
               'handover_token_ttl_minutes', 'location_max_accuracy_m', 'location_max_age_seconds',
               'location_min_interval_seconds', 'location_stale_after_seconds', 'arrival_max_accuracy_m',
               'arrival_max_age_seconds', 'default_geofence_radius_m', 'location_history_retention_hours', 'delivery_proof_ttl_minutes') then
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
       or (p_key = 'delivery_proof_ttl_minutes' and v_n not between 5 and 120) then
      raise exception 'value out of range for %', p_key using errcode = '22023';
    end if;
  end if;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, v_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform app_private.audit_write(v_actor, 'setting.changed', 'platform_setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Evidence: extend the existing immutable table (no parallel evidence system)
-- ---------------------------------------------------------------------------------------------
alter table public.handover_evidence
  add column evidence_kind text not null default 'pickup' check (evidence_kind in ('pickup', 'delivery')),
  add column assignment_id uuid references public.delivery_assignments (id) on delete restrict,
  add column proof_session_id uuid,
  add column arrival_detected_at timestamptz;
alter table public.handover_evidence add constraint handover_evidence_kind_shape check (
  (evidence_kind = 'delivery') = (assignment_id is not null and proof_session_id is not null)
  and (evidence_kind = 'pickup' or capture_method = 'drawn'));

-- Customers see their own evidence; a shop sees PICKUP evidence only (it never needs a delivery recipient's signature).
-- Staff read signatures only through the audited function below.
drop policy handover_evidence_select on public.handover_evidence;
create policy handover_evidence_select on public.handover_evidence for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                  and (o.customer_id = (select auth.uid())
                       or (handover_evidence.evidence_kind = 'pickup' and app_private.is_vendor_member(o.vendor_id)))));

create table public.delivery_proof_sessions (
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
create unique index delivery_proof_one_live on public.delivery_proof_sessions (assignment_id)
  where used_at is null and invalidated_at is null;
create index delivery_proof_order_idx on public.delivery_proof_sessions (order_id);
alter table public.delivery_proof_sessions enable row level security;
revoke all on public.delivery_proof_sessions from public, anon, authenticated;
create policy delivery_proof_sessions_aal2 on public.delivery_proof_sessions as restrictive for all to authenticated
  using (app_private.is_aal2());
grant all on public.delivery_proof_sessions to service_role;

-- ---------------------------------------------------------------------------------------------
-- Recipient: start receipt confirmation (arrival must already be detected by the server)
-- ---------------------------------------------------------------------------------------------
create function public.delivery_proof_begin(p_order uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype;
        v_token text; v_exp timestamptz; v_id uuid;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if v_o.fulfilment <> 'delivery' or v_o.status not in ('ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  select * into v_a from public.delivery_assignments
   where order_id = p_order and status in ('accepted', 'picked_up', 'en_route') for update;
  if not found or v_a.status <> 'en_route' or v_a.arrival_detected_at is null then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if v_a.rider_id = v_actor then raise exception 'forbidden' using errcode = '42501'; end if; -- nobody confirms their own delivery
  update public.delivery_proof_sessions set invalidated_at = now()
   where assignment_id = v_a.id and used_at is null and invalidated_at is null;
  if v_o.status = 'ARRIVAL_DETECTED' then
    perform app_private.step_order(p_order, 'ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF', v_actor, 'recipient_started_confirmation');
  end if;
  v_token := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  v_exp := now() + make_interval(mins => app_private.setting_int('delivery_proof_ttl_minutes', 20)::int);
  insert into public.delivery_proof_sessions (order_id, assignment_id, created_by, token_hash, expires_at)
    values (p_order, v_a.id, v_actor, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_exp) returning id into v_id;
  perform app_private.audit_write(v_actor, 'delivery_proof.started', 'order', p_order::text, jsonb_build_object('session', v_id));
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Recipient: complete the delivery (ONE transaction: validate -> consume token -> evidence -> states -> slot)
-- A wrong token is COUNTED and returned (not raised) so the counter commits; five wrong tries lock the session.
-- ---------------------------------------------------------------------------------------------
create function public.complete_delivery(p_order uuid, p_token text, p_recipient text, p_signature bytea,
                                         p_method text default 'drawn') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_o public.orders%rowtype; v_a public.delivery_assignments%rowtype;
        v_s public.delivery_proof_sessions%rowtype; v_hash text;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  select * into v_o from public.orders where id = p_order;
  if not found or v_o.customer_id <> v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.lock_order_row(p_order);
  select * into v_o from public.orders where id = p_order;
  if v_o.fulfilment <> 'delivery' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  if v_o.status in ('DELIVERED', 'COMPLETED') and exists (select 1 from public.handover_evidence e
                                                          where e.order_id = p_order and e.evidence_kind = 'delivery') then
    return jsonb_build_object('ok', false, 'reason', 'already_completed');
  end if;
  if v_o.status <> 'AWAITING_RECIPIENT_PROOF' then raise exception 'invalid_transition' using errcode = '22023'; end if;
  -- the proof must be a DRAWN signature; typed acknowledgement is not accepted for deliveries (owner decision K27)
  if p_method = 'typed_acknowledgement' then raise exception 'typed_signature_disabled' using errcode = '42501'; end if;
  if p_method is distinct from 'drawn' then raise exception 'signature_required' using errcode = '22023'; end if;
  if p_recipient is null or char_length(btrim(p_recipient)) not between 2 and 80 then
    raise exception 'recipient_required' using errcode = '22023';
  end if;
  if p_signature is null or octet_length(p_signature) not between 300 and 400000
     or get_byte(p_signature, 0) <> 137 or get_byte(p_signature, 1) <> 80 or get_byte(p_signature, 2) <> 78 or get_byte(p_signature, 3) <> 71 then
    raise exception 'signature_required' using errcode = '22023';
  end if;
  select * into v_a from public.delivery_assignments
   where order_id = p_order and status in ('accepted', 'picked_up', 'en_route') for update;
  if not found or v_a.status <> 'en_route' or v_a.arrival_detected_at is null then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if v_a.rider_id = v_actor then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.test_seam('after_proof_checks');

  select * into v_s from public.delivery_proof_sessions
   where order_id = p_order and assignment_id = v_a.id and used_at is null and invalidated_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'proof_unavailable'); end if;
  if v_s.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'proof_expired'); end if;
  if v_s.failed_attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'proof_locked'); end if;
  v_hash := encode(extensions.digest(upper(btrim(coalesce(p_token, ''))), 'sha256'), 'hex');
  if v_hash <> v_s.token_hash then
    update public.delivery_proof_sessions set failed_attempts = failed_attempts + 1 where id = v_s.id;
    perform app_private.audit_write(v_actor, 'delivery_proof.wrong_token', 'order', p_order::text, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'reason', 'wrong_proof', 'attempts_left', greatest(0, 4 - v_s.failed_attempts));
  end if;

  update public.delivery_proof_sessions set used_at = now() where id = v_s.id;
  insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by, capture_method,
                                        evidence_kind, assignment_id, proof_session_id, arrival_detected_at)
    values (p_order, btrim(p_recipient), p_signature, encode(extensions.digest(p_signature, 'sha256'), 'hex'), v_actor, 'drawn',
            'delivery', v_a.id, v_s.id, v_a.arrival_detected_at);
  update public.delivery_assignments set status = 'completed', completed_at = now() where id = v_a.id;
  perform app_private.step_order(p_order, 'AWAITING_RECIPIENT_PROOF', 'DELIVERED', v_actor, 'recipient_signed');
  perform app_private.step_order(p_order, 'DELIVERED', 'COMPLETED', v_actor, 'delivery_completed');
  -- location sharing is only for riders with a parcel: drop the stored position when no active work remains
  if not exists (select 1 from public.delivery_assignments d where d.rider_id = v_a.rider_id
                  and d.status in ('accepted', 'picked_up', 'en_route')) then
    delete from public.rider_location_current where rider_id = v_a.rider_id;
  end if;
  perform app_private.audit_write(v_actor, 'delivery.completed', 'order', p_order::text,
    jsonb_build_object('assignment', v_a.id, 'method', 'drawn', 'session', v_s.id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff: audited access to a delivery proof (signature image included only on explicit request)
-- ---------------------------------------------------------------------------------------------
create function public.staff_get_delivery_proof(p_order uuid, p_purpose text, p_include_signature boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_ops(); v_e public.handover_evidence%rowtype;
begin
  if p_purpose is null or char_length(btrim(p_purpose)) < 10 then raise exception 'purpose_required' using errcode = '22023'; end if;
  select * into v_e from public.handover_evidence where order_id = p_order;
  if not found then return jsonb_build_object('found', false); end if;
  perform app_private.audit_write(v_actor, 'delivery_proof.viewed_by_staff', 'order', p_order::text,
    jsonb_build_object('purpose', left(btrim(p_purpose), 200), 'signature', coalesce(p_include_signature, false)));
  return jsonb_build_object('found', true, 'kind', v_e.evidence_kind, 'method', v_e.capture_method,
    'recipient', v_e.recipient_name, 'completed_at', v_e.completed_at, 'arrival_detected_at', v_e.arrival_detected_at,
    'signature_sha256', v_e.signature_sha256,
    'signature_png_base64', case when p_include_signature then encode(v_e.signature_png, 'base64') end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Vendor counter handover: resolve ONE eligible order from a code (never completes anything)
-- Failed look-ups are rate limited per shop member; the per-order failure counter is NOT touched here.
-- ---------------------------------------------------------------------------------------------
create table public.code_lookup_attempts (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index code_lookup_attempts_actor_idx on public.code_lookup_attempts (actor_id, created_at desc);
alter table public.code_lookup_attempts enable row level security;
revoke all on public.code_lookup_attempts from public, anon, authenticated;
create policy code_lookup_attempts_aal2 on public.code_lookup_attempts as restrictive for all to authenticated
  using (app_private.is_aal2());
grant all on public.code_lookup_attempts to service_role;

create function public.vendor_find_pickup_by_code(p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_hash text; v_n int; v_o public.orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not exists (select 1 from public.vendor_staff vs join public.vendors v on v.id = vs.vendor_id
                  where vs.user_id = v_actor and v.status = 'approved') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (select count(*) from public.code_lookup_attempts a
       where a.actor_id = v_actor and not a.succeeded and a.created_at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('found', false, 'reason', 'too_many_attempts');
  end if;
  v_hash := encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
  select count(*) into v_n from public.pickup_codes c join public.orders o on o.id = c.order_id
   where c.code_hash = v_hash and c.used_at is null and c.expires_at > now() and c.failed_attempts < 5
     and o.status = 'PICKUP_AWAITING_HANDOVER' and o.fulfilment = 'pickup'
     and exists (select 1 from public.vendor_staff vs where vs.vendor_id = o.vendor_id and vs.user_id = v_actor);
  if v_n <> 1 then
    insert into public.code_lookup_attempts (actor_id, succeeded) values (v_actor, false);
    return jsonb_build_object('found', false, 'reason', case when v_n = 0 then 'no_match' else 'ambiguous' end);
  end if;
  select o.* into v_o from public.pickup_codes c join public.orders o on o.id = c.order_id where c.code_hash = v_hash
     and c.used_at is null and c.expires_at > now() and o.status = 'PICKUP_AWAITING_HANDOVER';
  insert into public.code_lookup_attempts (actor_id, succeeded) values (v_actor, true);
  return jsonb_build_object('found', true, 'order_id', v_o.id, 'order_number', v_o.order_number,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity) order by i.product_name), '[]'::jsonb)
                from public.order_items i where i.order_id = v_o.id));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.delivery_proof_begin(uuid)',
    'public.complete_delivery(uuid, text, text, bytea, text)',
    'public.staff_get_delivery_proof(uuid, text, boolean)',
    'public.vendor_find_pickup_by_code(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
