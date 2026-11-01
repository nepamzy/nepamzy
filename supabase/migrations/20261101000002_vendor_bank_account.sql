-- A shop's payout account. The shop owner picks the bank and types the account number; the server asks Paystack for the
-- registered account name and only that name is stored (the browser never supplies it). Once saved the account is LOCKED:
-- only an administrator (customer service) can unlock it, and the unlock is logged. Nothing here moves money.
-- The account number is encrypted by the server before it reaches the database (see src/server/security/field-crypto.ts).

create table public.vendor_bank_accounts (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  bank_code text not null check (bank_code ~ '^[0-9A-Za-z-]{2,12}$'),
  bank_name text not null check (char_length(bank_name) between 2 and 80),
  account_name text not null check (char_length(account_name) between 2 and 120),
  account_cipher text not null check (account_cipher ~ '^v1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,200}$'),
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz not null default now()
);
alter table public.vendor_bank_accounts enable row level security;
revoke all on public.vendor_bank_accounts from public, anon, authenticated;
grant all on public.vendor_bank_accounts to service_role;

-- Save once. Fails with bank_locked if an account is already saved.
create function public.vendor_save_bank(p_vendor uuid, p_bank_code text, p_bank_name text, p_cipher text, p_last4 text, p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  perform app_private.require_vendor_actor(p_vendor, true);
  if exists (select 1 from public.vendor_bank_accounts where vendor_id = p_vendor) then
    raise exception 'bank_locked' using errcode = '23505';
  end if;
  insert into public.vendor_bank_accounts (vendor_id, bank_code, bank_name, account_name, account_cipher, account_last4, verified_by)
    values (p_vendor, btrim(p_bank_code), btrim(p_bank_name), btrim(p_name), p_cipher, p_last4, v_actor);
  perform app_private.audit_write(v_actor, 'vendor.bank_verified', 'vendor', p_vendor::text,
    jsonb_build_object('bank', btrim(p_bank_name), 'account_ending', p_last4));
  return jsonb_build_object('saved', true);
end $$;
revoke all on function public.vendor_save_bank(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.vendor_save_bank(uuid, text, text, text, text, text) to authenticated;

-- What a shop member may see: bank, name and the last four digits only.
create function public.my_vendor_bank(p_vendor uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); b public.vendor_bank_accounts%rowtype;
begin
  if v_actor is null or not exists (select 1 from public.vendor_staff where vendor_id = p_vendor and user_id = v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into b from public.vendor_bank_accounts where vendor_id = p_vendor;
  if not found then return jsonb_build_object('set', false); end if;
  return jsonb_build_object('set', true, 'bank_name', b.bank_name, 'account_name', b.account_name,
    'account_masked', repeat('*', 6) || b.account_last4, 'verified_at', b.verified_at);
end $$;
revoke all on function public.my_vendor_bank(uuid) from public, anon;
grant execute on function public.my_vendor_bank(uuid) to authenticated;

-- Customer service unlocks a shop's account (for example after a bank change). A reason is required and logged.
create function public.admin_unlock_vendor_bank(p_vendor uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := app_private.require_platform_admin();
begin
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'reason_required' using errcode = '22023'; end if;
  delete from public.vendor_bank_accounts where vendor_id = p_vendor;
  if not found then raise exception 'unknown vendor bank' using errcode = 'P0002'; end if;
  perform app_private.audit_write(v_actor, 'vendor.bank_unlocked', 'vendor', p_vendor::text,
    jsonb_build_object('reason', left(btrim(p_reason), 300)));
end $$;
revoke all on function public.admin_unlock_vendor_bank(uuid, text) from public, anon;
grant execute on function public.admin_unlock_vendor_bank(uuid, text) to authenticated;
