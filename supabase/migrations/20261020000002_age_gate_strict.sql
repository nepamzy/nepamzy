-- 18+ declaration, strict form (Final Platform Completion, item 4): only the JSON BOOLEAN true counts as a declaration.
-- Before, the text "true" (a JSON string) was also accepted. Existing accounts are NOT touched and are NOT given a declaration
-- they never made: adult_declared_at stays NULL for them. A self-declaration never verifies age.
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, adult_declared_at)
  values (new.id, case when jsonb_typeof(new.raw_user_meta_data -> 'adult_declared') = 'boolean'
                        and (new.raw_user_meta_data ->> 'adult_declared') = 'true' then now() end);
  insert into public.role_assignments (user_id, role) values (new.id, 'customer');
  insert into public.audit_events (actor_id, action, entity_type, entity_id)
  values (new.id, 'account.created', 'user', new.id::text);
  return new;
end $$;

create or replace function app_private.signup_declaration_ok(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from auth.users u
     where u.id = p_user
       and u.email_confirmed_at is null
       and u.invited_at is null
       and coalesce(u.is_sso_user, false) = false
       and coalesce(u.is_anonymous, false) = false
       and not coalesce(jsonb_typeof(u.raw_user_meta_data -> 'adult_declared') = 'boolean'
                and (u.raw_user_meta_data ->> 'adult_declared') = 'true', false))
$$;
