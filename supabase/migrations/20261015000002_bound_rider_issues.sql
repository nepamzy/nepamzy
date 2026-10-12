-- Boundedness review (Batch 6, Phase 12): the open rider-issues queue was the only staff list still returning every row.
-- Oldest first, at most 100 at a time; resolving issues brings the next ones into view. Same access rule as before.
create or replace function public.list_rider_issues() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.require_ops();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'order_id', x.order_id, 'order_status', x.order_status, 'order_number', x.order_number,
            'reason', x.reason, 'note', x.note, 'created_at', x.created_at, 'assignment_id', x.assignment_id, 'assignment_status', x.assignment_status)
            order by x.created_at), '[]'::jsonb)
          from (select i.id, i.order_id, o.status as order_status, o.order_number, i.reason, i.note, i.created_at, i.assignment_id, d.status as assignment_status
                  from public.rider_issues i join public.orders o on o.id = i.order_id
                  left join public.delivery_assignments d on d.id = i.assignment_id
                 where i.status = 'open' order by i.created_at limit 100) x);
end $$;
