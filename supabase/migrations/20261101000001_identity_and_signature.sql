-- Who a person is on AFIT Market, as they told us at sign-up: the signature they chose to sign deliveries with, and for
-- customers the kind of customer they are (student, military, lecturer, other). Students also give a student ID number
-- (stored encrypted by the server) and a photo of the ID card. None of this is checked automatically.
-- Sensitive: no API role can read these tables. The server reads and writes them with the service role only, after
-- its own access checks; an administrator's look at an ID card is logged by public.admin_log_identity_view.

create table public.user_signatures (
  user_id uuid primary key references auth.users (id) on delete cascade,
  png bytea not null check (octet_length(png) between 300 and 400000),
  enrolled_at timestamptz not null default now()
);

create table public.account_identity (
  user_id uuid primary key references auth.users (id) on delete cascade,
  person_type text not null check (person_type in ('student', 'military', 'lecturer', 'other')),
  student_id_cipher text check (student_id_cipher is null or char_length(student_id_cipher) <= 400),
  id_card_jpeg bytea check (id_card_jpeg is null or octet_length(id_card_jpeg) <= 900000),
  created_at timestamptz not null default now(),
  check (person_type <> 'student' or (student_id_cipher is not null and id_card_jpeg is not null))
);

alter table public.user_signatures enable row level security;
alter table public.account_identity enable row level security;
revoke all on public.user_signatures, public.account_identity from public, anon, authenticated;
grant all on public.user_signatures, public.account_identity to service_role;

-- Erasing an account removes the signature and the ID details (the erasure function records itself in account_erasures).
create function app_private.erase_identity_data() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.user_signatures where user_id = new.user_id;
  delete from public.account_identity where user_id = new.user_id;
  return new;
end $$;
create trigger account_erasures_identity
  after insert on public.account_erasures
  for each row execute function app_private.erase_identity_data();
revoke all on function app_private.erase_identity_data() from public, anon, authenticated;

-- An administrator looking at someone's ID details leaves a record.
create function public.admin_log_identity_view(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin();
begin
  if p_user is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app_private.audit_write(v_actor, 'identity.viewed', 'user', p_user::text, '{}'::jsonb);
end $$;
revoke all on function public.admin_log_identity_view(uuid) from public, anon;
grant execute on function public.admin_log_identity_view(uuid) to authenticated;
