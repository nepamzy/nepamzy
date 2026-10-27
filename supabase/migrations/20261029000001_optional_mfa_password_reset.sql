-- (1) Two-step sign-in becomes optional for customers, vendors and riders; it stays required for staff
--     (platform_admin, finance_admin, support_agent) and, once a person has set up an authenticator, for them too.
-- (2) E-mailed 6-digit codes for "forgot password". Service role only; the browser never touches these.

create or replace function app_private.has_privileged_role() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.role_assignments ra
    where ra.user_id = (select auth.uid()) and ra.status = 'active'
      and ra.role in ('platform_admin', 'finance_admin', 'support_agent')
  )
$$;

-- "Assurance satisfied": the session did the second step, or the second step is optional for this person
-- (signed in, no verified authenticator, not staff).
create or replace function app_private.is_aal2() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
      or ((select auth.uid()) is not null
          and not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
          and not app_private.has_privileged_role())
$$;

-- The restrictive policies use the same rule: second step done, or optional for this person.
create or replace function app_private.mfa_satisfied() returns boolean
language sql stable security definer set search_path = ''
as $$ select app_private.is_aal2() $$;

create table public.password_reset_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null check (char_length(code_hash) = 64),
  attempts int not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.password_reset_codes enable row level security;
revoke all on public.password_reset_codes from public, anon, authenticated;
grant all on public.password_reset_codes to service_role;

create function public.auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = ''
as $$ select id from auth.users where lower(email) = lower(p_email) and deleted_at is null limit 1 $$;

-- One live code per person; asking again replaces the old one.
create function public.password_reset_issue(p_user uuid, p_hash text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.password_reset_codes (user_id, code_hash, attempts, expires_at, created_at)
  values (p_user, p_hash, 0, now() + interval '15 minutes', now())
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, created_at = now()
$$;

-- 'ok' (code consumed) | 'invalid' (wrong, expired or none) | 'locked' (five wrong tries; ask for a new code).
create function public.password_reset_check(p_user uuid, p_hash text) returns text
language plpgsql security definer set search_path = ''
as $$
declare r public.password_reset_codes;
begin
  select * into r from public.password_reset_codes where user_id = p_user for update;
  if not found or r.expires_at < now() then return 'invalid'; end if;
  if r.attempts >= 5 then return 'locked'; end if;
  if r.code_hash = p_hash then
    delete from public.password_reset_codes where user_id = p_user;
    return 'ok';
  end if;
  update public.password_reset_codes set attempts = attempts + 1 where user_id = p_user;
  return 'invalid';
end $$;

revoke all on function public.auth_user_id_by_email(text), public.password_reset_issue(uuid, text), public.password_reset_check(uuid, text)
  from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text), public.password_reset_issue(uuid, text), public.password_reset_check(uuid, text)
  to service_role;
