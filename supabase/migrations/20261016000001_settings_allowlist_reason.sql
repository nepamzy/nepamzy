-- Post-Batch 6 remediation (K59, K63): platform settings are changed only through a strict allowlist, with a mandatory reason,
-- and the audit record carries the previous and new value. Unknown keys are refused at the function AND at the table.

-- One place that says which keys exist and what a valid value looks like.
--   kind 'int'  : JSON number, whole, 0..999999999, within [lo, hi]
--   kind 'bool' : JSON boolean
--   kind 'enum' : JSON string, one of the listed values
--   kind 'return_policy' : object {default: returnable|not_returnable|case_by_case, categories?: {slug: same}}
--   kind 'locked': exists, but cannot be changed through the function (value stays as seeded)
create function app_private.setting_rule(p_key text) returns table (kind text, lo bigint, hi bigint, choices text[])
language sql immutable set search_path = ''
as $$
  select r.kind, r.lo, r.hi, r.choices from (values
    ('delivery_fee_kobo', 'int', 0::bigint, 1000000::bigint, null::text[]),
    ('platform_fee_bps', 'int', 0, 3000, null),
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
revoke all on function app_private.setting_rule(text) from public, anon, authenticated;

-- The previous two-argument function is removed so nothing can call a reason-less path.
drop function public.set_platform_setting(text, jsonb);

create function public.set_platform_setting(p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid()); v_rule record; v_n bigint; v_reason text; v_old jsonb;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('platform_admin') then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_rule from app_private.setting_rule(p_key);
  if not found then raise exception 'unknown_setting' using errcode = '22023'; end if;

  v_reason := btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g'));
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'setting_reason_required' using errcode = '22023';
  end if;

  if p_key = 'settlement_policy' then
    if p_value is distinct from '"DISABLED"'::jsonb then
      raise exception 'settlement_policy is locked to DISABLED pending provider and legal approval' using errcode = '42501';
    end if;
  elsif v_rule.kind = 'locked' then
    raise exception '% can only be changed with direct database access' , p_key using errcode = '42501';
  elsif v_rule.kind = 'int' then
    if p_value is null or jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,9}$' then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
    v_n := (p_value #>> '{}')::bigint;
    if v_n < v_rule.lo or v_n > v_rule.hi then raise exception 'value out of range for %', p_key using errcode = '22023'; end if;
  elsif v_rule.kind = 'bool' then
    if p_value is null or jsonb_typeof(p_value) <> 'boolean' then raise exception 'invalid value for %', p_key using errcode = '22023'; end if;
  elsif v_rule.kind = 'enum' then
    if p_value is null or jsonb_typeof(p_value) <> 'string' or not ((p_value #>> '{}') = any (v_rule.choices)) then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
  elsif v_rule.kind = 'return_policy' then
    if p_value is null or jsonb_typeof(p_value) <> 'object' or jsonb_typeof(p_value -> 'default') is distinct from 'string'
       or (p_value ->> 'default') not in ('returnable', 'not_returnable', 'case_by_case')
       or exists (select 1 from jsonb_object_keys(p_value) k where k not in ('default', 'categories'))
       or (p_value ? 'categories' and jsonb_typeof(p_value -> 'categories') <> 'object') then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
    if p_value ? 'categories' and exists (select 1 from jsonb_each(p_value -> 'categories') e
                                           where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') not in ('returnable', 'not_returnable', 'case_by_case')) then
      raise exception 'invalid value for %', p_key using errcode = '22023';
    end if;
  end if;

  select s.value into v_old from public.platform_settings s where s.key = p_key;
  insert into public.platform_settings (key, value, updated_by) values (p_key, p_value, v_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  -- Values of allowlisted settings are never secret, so old and new values are recorded. The reason is the administrator's own text.
  perform app_private.audit_write(v_actor, 'setting.changed', 'platform_setting', p_key,
                                  jsonb_build_object('old', v_old, 'new', p_value, 'reason', v_reason, 'outcome', 'applied'));
end $$;
revoke all on function public.set_platform_setting(text, jsonb, text) from public, anon;
grant execute on function public.set_platform_setting(text, jsonb, text) to authenticated, service_role;

-- Table-level backstop: no code path (including the service role) can add a key that has no rule.
create function app_private.settings_known_key() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from app_private.setting_rule(new.key)) then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function app_private.settings_known_key() from public, anon, authenticated;
create trigger platform_settings_known_key before insert on public.platform_settings
  for each row execute function app_private.settings_known_key();
