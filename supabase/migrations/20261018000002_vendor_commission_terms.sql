-- The rate a vendor is shown (and accepts) when applying. Read from the same setting that is copied into each settlement line.
create function public.vendor_commission_terms() returns jsonb
language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('commission_bps', app_private.setting_int('vendor_commission_bps', 450)) $$;
revoke all on function public.vendor_commission_terms() from public, anon;
grant execute on function public.vendor_commission_terms() to authenticated, service_role;

-- The caller's own optional-copy delivery states (counts only, never message text): queued is NOT delivered.
create function public.my_notification_delivery_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return (select jsonb_build_object(
      'queued', count(*) filter (where o.status in ('pending', 'processing')),
      'delivered_to_test_sink', count(*) filter (where o.status = 'sent'),
      'failed', count(*) filter (where o.status = 'dead'),
      'not_requested', count(*) filter (where o.status = 'suppressed'))
    from public.notification_outbox o join public.notifications n on n.id = o.notification_id
   where n.user_id = v_user and n.created_at > now() - interval '30 days');
end $$;
revoke all on function public.my_notification_delivery_summary() from public, anon;
grant execute on function public.my_notification_delivery_summary() to authenticated, service_role;
