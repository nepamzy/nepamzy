-- Server-side enforcement of the 18+ self-declaration on the PUBLIC sign-up path.
--
-- Before this migration only the web form asked for the declaration; a direct call to the Auth API's public sign-up
-- endpoint could create an account without it. Now the database refuses to create an account when ALL of these hold:
--   * the row is inserted by the Auth service (session_user = 'supabase_auth_admin'), i.e. through the Auth API, not by
--     migrations, seed SQL or test fixtures that connect as the database owner;
--   * the address is NOT already confirmed and the account is NOT an invitation (a public sign-up always starts
--     unconfirmed; accounts created by an administrator with a service-role key come in confirmed or invited);
--   * the sign-up request did not carry adult_declared = true.
--
-- WHAT THIS IS NOT: it does not verify anyone's age. It is a recorded self-declaration. No identity provider, date of
-- birth or document is involved. The service-role key can still create confirmed accounts: that key is a server secret
-- and its holders are trusted staff/fixtures; it is not reachable from a browser.
-- The Auth service creates an administrator-made or invited account and then confirms it / stamps the invitation in the same
-- transaction, so the check runs DEFERRED, at commit, against the row's FINAL state.
--
-- DEPENDENCY: this relies on email confirmation being required for public sign-ups (supabase/config.toml
-- [auth.email] enable_confirmations = true; a unit test pins that). If confirmations were switched off, public sign-ups would
-- be confirmed in the same transaction and this gate could no longer tell them from administrator-made accounts.
create function app_private.signup_declaration_ok(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from auth.users u
     where u.id = p_user
       and u.email_confirmed_at is null
       and u.invited_at is null
       and coalesce(u.is_sso_user, false) = false
       and coalesce(u.is_anonymous, false) = false
       and (u.raw_user_meta_data ->> 'adult_declared') is distinct from 'true')
$$;
revoke all on function app_private.signup_declaration_ok(uuid) from public, anon, authenticated;

create function app_private.signup_age_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if session_user = 'supabase_auth_admin' and not app_private.signup_declaration_ok(new.id) then
    raise exception 'adult_declaration_required' using errcode = '22023';
  end if;
  return null;
end $$;
revoke all on function app_private.signup_age_gate() from public, anon, authenticated;
create constraint trigger a_signup_age_gate after insert on auth.users
  deferrable initially deferred
  for each row execute function app_private.signup_age_gate();
