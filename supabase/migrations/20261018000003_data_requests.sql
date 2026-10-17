-- Account closure and personal-data requests (access, correction, deletion, closure, other).
-- Honest scope: this RECORDS the request and tracks a human response. It does not delete, export or close anything
-- automatically (money, audit and dispute records are append-only by design; retention rules are an open owner/legal decision).
create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('access', 'correction', 'deletion', 'closure', 'other')),
  detail text check (detail is null or char_length(detail) <= 500),
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'declined')),
  response_note text check (response_note is null or char_length(response_note) <= 500),
  handled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  constraint data_requests_handled_shape check ((status in ('completed', 'declined')) = (handled_at is not null))
);
create unique index data_requests_one_open on public.data_requests (user_id, kind) where status in ('open', 'in_progress');
create index data_requests_status_idx on public.data_requests (status, created_at);

alter table public.data_requests enable row level security;
revoke all on public.data_requests from public, anon, authenticated;
create policy data_requests_aal2 on public.data_requests as restrictive for all to authenticated using (app_private.is_aal2());
grant all on public.data_requests to service_role;

create function public.submit_data_request(p_kind text, p_detail text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_detail text := nullif(btrim(coalesce(p_detail, '')), ''); v_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('access', 'correction', 'deletion', 'closure', 'other') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if v_detail is not null and char_length(v_detail) > 500 then raise exception 'detail_too_long' using errcode = '22023'; end if;
  if exists (select 1 from public.data_requests where user_id = v_user and kind = p_kind and status in ('open', 'in_progress')) then
    return jsonb_build_object('created', false, 'reason', 'already_open');
  end if;
  insert into public.data_requests (user_id, kind, detail) values (v_user, p_kind, v_detail) returning id into v_id;
  perform app_private.audit_write(v_user, 'data_request.submitted', 'data_request', v_id::text, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('created', true, 'id', v_id);
end $$;

create function public.my_data_requests() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not app_private.is_aal2() then raise exception 'MFA (aal2) required' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'response_note', r.response_note,
            'created_at', r.created_at, 'handled_at', r.handled_at) order by r.created_at desc), '[]'::jsonb)
            from (select * from public.data_requests where user_id = v_user order by created_at desc limit 50) r);
end $$;

-- Platform administrators only (personal data): bounded list and a resolution with a mandatory note.
create function public.admin_list_data_requests(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.require_staff(array['platform_admin']::public.app_role[]);
  if p_status is not null and p_status not in ('open', 'in_progress', 'completed', 'declined') then raise exception 'invalid_status' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'detail', r.detail,
            'response_note', r.response_note, 'created_at', r.created_at, 'handled_at', r.handled_at,
            'requester', (select u.email from auth.users u where u.id = r.user_id)) order by r.created_at), '[]'::jsonb)
            from (select * from public.data_requests where (p_status is null or status = p_status) order by created_at limit 50) r);
end $$;

create function public.admin_resolve_data_request(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_note text := btrim(coalesce(p_note, '')); r public.data_requests%rowtype;
begin
  v_actor := app_private.require_staff(array['platform_admin']::public.app_role[]);
  if p_status not in ('in_progress', 'completed', 'declined') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if char_length(v_note) < 10 or char_length(v_note) > 500 then raise exception 'a note of 10 to 500 characters is required' using errcode = '22023'; end if;
  select * into r from public.data_requests where id = p_id for update;
  if not found then raise exception 'unknown request' using errcode = 'P0002'; end if;
  if r.status in ('completed', 'declined') then raise exception 'already_resolved' using errcode = '22023'; end if;
  update public.data_requests set status = p_status, response_note = v_note, handled_by = v_actor,
         handled_at = case when p_status in ('completed', 'declined') then now() end where id = p_id;
  perform app_private.audit_write(v_actor, 'data_request.' || p_status, 'data_request', p_id::text, jsonb_build_object('kind', r.kind));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.submit_data_request(text, text)', 'public.my_data_requests()',
                           'public.admin_list_data_requests(text)', 'public.admin_resolve_data_request(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
