-- Delivery history for riders: the rider's OWN finished assignments (completed or released), newest first. READ-ONLY, ADDITIVE ONLY.
-- Shows only what the rider already saw while working: order number, shop, delivery point label, times, the delivery fee of the order and the
-- state of the direct delivery-fee payment. No customer name, no bank details.
create function public.rider_delivery_history(p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_rider();
begin
  return jsonb_build_object(
    'completed', (select count(*) from public.delivery_assignments a where a.rider_id = v_actor and a.status = 'completed'),
    'released', (select count(*) from public.delivery_assignments a where a.rider_id = v_actor and a.status = 'released'),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.finished_at desc) from (
        select a.id as assignment_id, o.order_number, o.vendor_name, o.delivery_point_label as deliver_to, a.status,
               coalesce(a.completed_at, a.released_at) as finished_at, a.accepted_at, a.release_reason,
               o.delivery_fee_kobo, o.delivery_fee_collection, f.status as fee_payment_status
        from public.delivery_assignments a
        join public.orders o on o.id = a.order_id
        left join public.delivery_fee_payments f on f.assignment_id = a.id
        where a.rider_id = v_actor and a.status in ('completed', 'released')
        order by coalesce(a.completed_at, a.released_at) desc
        limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb));
end $$;
revoke all on function public.rider_delivery_history(int, int) from public, anon;
grant execute on function public.rider_delivery_history(int, int) to authenticated, service_role;
