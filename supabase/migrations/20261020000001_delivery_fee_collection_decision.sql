-- Trusted, server-side decision of how the DELIVERY FEE is collected (Final Platform Completion, item 3).
--
-- Marketplace checkout stays Paystack-based. A platform administrator (aal2, with a recorded reason, audited) may set the platform
-- setting delivery_fee_collection_mode to 'direct_to_rider'. From then on, and ONLY for delivery orders with a fee greater than
-- zero, create_order stores orders.delivery_fee_collection = 'direct_to_rider' and the payable (Paystack) total WITHOUT the
-- delivery fee. The decision is taken inside create_order from persisted settings: the browser supplies only fulfilment, delivery
-- point and an idempotency key, so a customer, vendor or rider cannot choose the mode, and the column is immutable afterwards.
-- The default stays 'paystack', so nothing changes until an administrator deliberately switches the mode; orders created earlier
-- keep 'paystack' and are never asked for a second delivery fee. Pickup orders and zero fees are always 'paystack'.

CREATE OR REPLACE FUNCTION app_private.setting_rule(p_key text)
 RETURNS TABLE(kind text, lo bigint, hi bigint, choices text[])
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select r.kind, r.lo, r.hi, r.choices from (values
    ('delivery_fee_kobo', 'int', 0::bigint, 1000000::bigint, null::text[]),
    ('platform_fee_bps', 'int', 0, 0, null),               -- pinned: the customer fee is retired
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
    ('delivery_fee_collection_mode', 'enum', null, null, array['paystack', 'direct_to_rider']),
    ('return_policy', 'return_policy', null, null, null),
    ('settlement_policy', 'locked', null, null, null),
    ('mock_payments_enabled', 'locked', null, null, null),
    ('rider_terms_current_version', 'locked', null, null, null)
  ) as r(key, kind, lo, hi, choices) where r.key = p_key
$function$;

insert into public.platform_settings (key, value, note) values
  ('delivery_fee_collection_mode', '"paystack"'::jsonb,
   'How NEW delivery orders collect the delivery fee: paystack (inside the Paystack total, default) or direct_to_rider (customer pays the rider by bank transfer after delivery; the fee is excluded from the Paystack total). Existing orders keep their own recorded mode.')
on conflict (key) do nothing;

create function app_private.quote_with_collection(p_user uuid, p_fulfilment text, p_point uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare q jsonb := app_private.price_cart(p_user, p_fulfilment, p_point); v_fee bigint; v_mode text := 'paystack';
begin
  if coalesce((q ->> 'empty')::boolean, false) then return q; end if;
  v_fee := coalesce((q ->> 'delivery_fee_kobo')::bigint, 0);
  if p_fulfilment = 'delivery' and v_fee > 0
     and (select s.value #>> '{}' from public.platform_settings s where s.key = 'delivery_fee_collection_mode') = 'direct_to_rider' then
    v_mode := 'direct_to_rider';
  end if;
  if v_mode = 'direct_to_rider' then
    q := q || jsonb_build_object('total_kobo', (q ->> 'total_kobo')::bigint - v_fee, 'delivery_fee_to_rider_kobo', v_fee);
  else
    q := q || jsonb_build_object('delivery_fee_to_rider_kobo', 0);
  end if;
  return q || jsonb_build_object('delivery_fee_collection', v_mode);
end $$;
revoke all on function app_private.quote_with_collection(uuid, text, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cart_quote(p_fulfilment text, p_delivery_point uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := app_private.require_customer();
begin
  return app_private.quote_with_collection(v_actor, p_fulfilment, p_delivery_point);
end $function$;

CREATE OR REPLACE FUNCTION public.create_order(p_fulfilment text, p_delivery_point uuid, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid()); v_cart public.carts%rowtype; v_quote jsonb; v_order uuid; v_line jsonb;
  v_vendor public.vendors%rowtype; v_expiry int := app_private.setting_int('unpaid_order_expiry_minutes', 30)::int;
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if not app_private.has_role('customer') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_fulfilment not in ('pickup', 'delivery') then raise exception 'invalid_fulfilment' using errcode = '22023'; end if;

  select id into v_order from public.orders where customer_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_order; end if;

  select * into v_cart from public.carts where user_id = v_actor for update;
  if not found or not exists (select 1 from public.cart_items where cart_id = v_cart.id) then
    raise exception 'cart_empty' using errcode = '22023';
  end if;
  -- Serialise stock: lock the products in a fixed order so concurrent buyers queue instead of deadlocking.
  perform 1 from public.products where id in (select product_id from public.cart_items where cart_id = v_cart.id)
   order by id for update;

  v_quote := app_private.quote_with_collection(v_actor, p_fulfilment, p_delivery_point);
  if jsonb_array_length(v_quote->'problems') > 0 then
    raise exception 'checkout_blocked' using detail = (v_quote->'problems')::text, errcode = 'P0001';
  end if;
  select * into v_vendor from public.vendors where id = v_cart.vendor_id;

  begin
    insert into public.orders (order_number, customer_id, vendor_id, vendor_name, fulfilment, delivery_point_id,
      delivery_point_label, pickup_location_snapshot, prep_minutes_snapshot, items_total_kobo, delivery_fee_kobo,
      platform_fee_kobo, discount_kobo, total_kobo, delivery_fee_collection, idempotency_key, expires_at)
    values ('AFM-' || lpad(nextval('public.order_number_seq')::text, 6, '0'), v_actor, v_vendor.id, v_vendor.name,
      p_fulfilment, case when p_fulfilment = 'delivery' then p_delivery_point end, v_quote->>'delivery_point_label',
      v_vendor.pickup_location_text, v_vendor.prep_minutes,
      (v_quote->>'items_total_kobo')::bigint, (v_quote->>'delivery_fee_kobo')::bigint, (v_quote->>'platform_fee_kobo')::bigint,
      (v_quote->>'discount_kobo')::bigint, (v_quote->>'total_kobo')::bigint, v_quote->>'delivery_fee_collection', p_idempotency_key,
      now() + make_interval(mins => v_expiry))
    returning id into v_order;
  exception when unique_violation then
    select id into v_order from public.orders where customer_id = v_actor and idempotency_key = p_idempotency_key;
    if found then return v_order; end if;
    raise;
  end;

  for v_line in select * from jsonb_array_elements(v_quote->'lines') loop
    insert into public.order_items (order_id, product_id, product_name, options, base_price_kobo, unit_price_kobo, quantity, line_total_kobo)
    values (v_order, (v_line->>'product_id')::uuid, v_line->>'name', v_line->'options', (v_line->>'base_price_kobo')::bigint,
            (v_line->>'unit_price_kobo')::bigint, (v_line->>'quantity')::int, (v_line->>'line_total_kobo')::bigint);
  end loop;
  update public.products p set stock_quantity = p.stock_quantity - s.q
    from (select product_id, sum(quantity)::int as q from public.cart_items where cart_id = v_cart.id group by product_id) s
   where p.id = s.product_id and p.stock_quantity is not null;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason)
    values (v_order, null, 'PENDING_PAYMENT', v_actor, 'order_created');
  perform app_private.audit_write(v_actor, 'order.created', 'order', v_order::text,
    jsonb_build_object('vendor_id', v_vendor.id, 'total_kobo', (v_quote->>'total_kobo')::bigint,
                       'delivery_fee_collection', v_quote->>'delivery_fee_collection', 'decided_by', 'platform_setting'));
  delete from public.cart_items where cart_id = v_cart.id;
  update public.carts set vendor_id = null, updated_at = now() where id = v_cart.id;
  return v_order;
end $function$;

-- A direct delivery-fee payment is only requested for an order that finished normally (COMPLETED or PARTIALLY_REFUNDED).
-- Cancelled, refunded, disputed, returned or still-moving orders are 'not_ready': no payment obligation is created while the
-- order's outcome is contested or reversed. (Delivery-fee refunds are never automatic; a person decides through a report.)
create or replace function app_private.dfp_eligibility(p_order uuid) returns text
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
  if o.status not in ('COMPLETED', 'PARTIALLY_REFUNDED') then return 'not_ready'; end if;
  if not exists (select 1 from public.delivery_assignments a where a.order_id = p_order and a.status = 'completed') then return 'not_ready'; end if;
  return 'eligible';
end $$;
