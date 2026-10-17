-- Minimum registration age is 18 (owner decision recorded 2026-10-13). The application asks every new account holder to
-- confirm that they are 18 or older and records WHEN the declaration was made. Only the declaration is stored: no date of
-- birth, no document. This is a self-declaration, not age verification. The API-level sign-up endpoint is public, so the
-- database records the declaration when the sign-up request carries it but does not reject sign-ups without it (accounts
-- created by other paths, such as seeded staff or tests, have no declaration). A stricter rule needs an owner decision.
alter table public.profiles add column adult_declared_at timestamptz;

create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, adult_declared_at)
  values (new.id, case when (new.raw_user_meta_data ->> 'adult_declared') = 'true' then now() end);
  insert into public.role_assignments (user_id, role) values (new.id, 'customer');
  insert into public.audit_events (actor_id, action, entity_type, entity_id)
  values (new.id, 'account.created', 'user', new.id::text);
  return new;
end $$;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
