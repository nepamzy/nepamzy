-- A student now signs up with a matric number only. The photo of the ID card is optional and can be added later.
-- The matric number stays required for a student record.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.account_identity'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%id_card_jpeg%is not null%'
      and pg_get_constraintdef(oid) ilike '%person_type%'
  loop
    execute format('alter table public.account_identity drop constraint %I', c);
  end loop;
end $$;

alter table public.account_identity
  add constraint account_identity_student_needs_matric
  check (person_type <> 'student' or student_id_cipher is not null);
