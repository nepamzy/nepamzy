-- READ-ONLY verification of the three 20261030 migrations on a database (hosted or local).
-- Run it after applying; every row's `ok` column must be true. It changes nothing.
with expected_tables(t) as (values ('contact_messages'), ('wishlist_items'), ('saved_places')),
expected_fns(f) as (values
  ('browse_products'), ('staff_list_contact_messages'), ('staff_set_contact_message_status'),
  ('wishlist_toggle'), ('wishlist_contains'), ('wishlist_list'), ('saved_places_list'), ('saved_place_save'), ('saved_place_delete'),
  ('admin_list_products'), ('admin_set_product_visibility'), ('admin_list_users'), ('admin_user_detail'),
  ('admin_set_user_suspended'), ('admin_dashboard'), ('admin_report'))
select 'table exists with row level security: ' || t as check_name,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = t and c.relkind = 'r'), false) as ok
from expected_tables
union all
select 'no direct privileges for anon/authenticated on ' || t,
       not exists (select 1 from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = t and g.grantee in ('anon', 'authenticated'))
from expected_tables
union all
select 'function exists, security definer, fixed search_path: ' || f,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = f and p.prosecdef
                 and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) s where s like 'search_path=%'))
from expected_fns
union all
select 'not executable by anonymous visitors (only browse_products may be): ' || f,
       case when f = 'browse_products'
            then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = f and has_function_privilege('anon', p.oid, 'execute'))
            else not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname = f and has_function_privilege('anon', p.oid, 'execute')) end
from expected_fns
union all
select 'products status check allows active, archived, hidden',
       exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_status_check'
               and pg_get_constraintdef(oid) like '%hidden%')
union all
select 'erasure function clears wishlist, saved places and contact messages',
       pg_get_functiondef('public.admin_erase_account(uuid, text, uuid)'::regprocedure) like '%delete from public.wishlist_items%'
       and pg_get_functiondef('public.admin_erase_account(uuid, text, uuid)'::regprocedure) like '%delete from public.saved_places%'
       and pg_get_functiondef('public.admin_erase_account(uuid, text, uuid)'::regprocedure) like '%update public.contact_messages%'
       and pg_get_functiondef('public.admin_erase_account(uuid, text, uuid)'::regprocedure) like '%Erased by request%'
union all
select 'erasure function is still security definer with a fixed search path and the platform-admin check',
       (select p.prosecdef from pg_proc p where p.oid = 'public.admin_erase_account(uuid, text, uuid)'::regprocedure)
       and pg_get_functiondef('public.admin_erase_account(uuid, text, uuid)'::regprocedure) like '%require_staff(array[''platform_admin'']%'
union all
select 'vendor product functions refuse hidden products',
       pg_get_functiondef('public.product_set_availability(uuid, boolean)'::regprocedure) like '%product_hidden%'
       and pg_get_functiondef('public.product_archive(uuid)'::regprocedure) like '%product_hidden%'
order by 1;
