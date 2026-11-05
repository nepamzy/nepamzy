-- New riders give, at sign-up, their matric number, a phone number and clear photos of the front and back of their NEW ID card.
-- Only the new card carries a QR code on the front, so the server refuses a front photo with no readable QR code (qr_found must be true).
-- Riders who signed up before this have no row here and are not affected. The table is closed to every API role: the server's
-- service client writes it, and administrators read it through the audited admin pages.

create table public.rider_identity (
  user_id uuid primary key references auth.users (id) on delete cascade,
  matric_cipher text not null check (char_length(matric_cipher) <= 400),
  phone_cipher text not null check (char_length(phone_cipher) <= 400),
  id_front_jpeg bytea not null check (octet_length(id_front_jpeg) between 2000 and 900000),
  id_back_jpeg bytea not null check (octet_length(id_back_jpeg) between 2000 and 900000),
  qr_found boolean not null check (qr_found),
  created_at timestamptz not null default now()
);

alter table public.rider_identity enable row level security;
revoke all on public.rider_identity from public, anon, authenticated;
grant all on public.rider_identity to service_role;
