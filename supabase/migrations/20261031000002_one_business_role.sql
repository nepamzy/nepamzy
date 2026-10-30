-- One e-mail, one working role: an account that runs a shop cannot also be a rider, and the other way round.
-- (Everyone also holds the plain customer role; that is the base every account starts with.)
-- Existing accounts that already hold both are left alone: the rule applies to new grants only.
create or replace function app_private.one_business_role() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'active' then return new; end if;
  if new.role in ('vendor_owner', 'vendor_staff') and exists (
    select 1 from public.role_assignments r
     where r.user_id = new.user_id and r.status = 'active' and r.role = 'rider'
  ) then
    raise exception 'one_business_role: this account is already a rider' using errcode = '23514';
  end if;
  if new.role = 'rider' and exists (
    select 1 from public.role_assignments r
     where r.user_id = new.user_id and r.status = 'active' and r.role in ('vendor_owner', 'vendor_staff')
  ) then
    raise exception 'one_business_role: this account already runs a shop' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists role_assignments_one_business_role on public.role_assignments;
create trigger role_assignments_one_business_role
  before insert on public.role_assignments
  for each row execute function app_private.one_business_role();

revoke all on function app_private.one_business_role() from public, anon, authenticated;
