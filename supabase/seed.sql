-- LOCAL DEVELOPMENT SEED ONLY (applied by `supabase db reset`; never part of migrations).
-- Everything here is FICTIONAL: no real vendors, brands, people, prices or AFIT locations/coordinates.
-- Demo owner accounts have no password, so nobody can sign in as them. Synthetic sign-in accounts for
-- manual testing come from `node --env-file=.env.local scripts/seed-local-users.mjs`.

-- Fictional delivery points (labels only; no coordinates exist in this batch).
insert into public.approved_delivery_points (label, instructions, sort_order) values
  ('Sample Point A (fictional placeholder)', 'Wait at the sample marker.', 1),
  ('Sample Point B (fictional placeholder)', null, 2),
  ('Sample Point C (fictional placeholder)', 'Ask for the sample desk.', 3);

do $$
declare
  v_food uuid; v_print uuid; v_souv uuid; o_food uuid := gen_random_uuid(); o_print uuid := gen_random_uuid(); o_souv uuid := gen_random_uuid();
  p uuid; g uuid;
  cat_food uuid := (select id from public.categories where slug = 'food');
  cat_print uuid := (select id from public.categories where slug = 'printing');
  cat_souv uuid := (select id from public.categories where slug = 'souvenirs');
  u record;
begin
  for u in select * from (values (o_food, 'sample-kitchen-owner'), (o_print, 'sample-print-owner'), (o_souv, 'sample-souvenirs-owner')) t(id, nm) loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.nm || '@seed.afit-market.test', '', now(), '{}', '{}', now(), now());
  end loop;

  insert into public.vendors (name, slug, status, description, category_id, pickup_location_text, prep_minutes, owner_id)
  values ('Sample Kitchen', 'sample-kitchen', 'approved', 'Fictional demo kitchen: rice, plantain and drinks.', cat_food, 'Sample pickup counter (placeholder)', 20, o_food) returning id into v_food;
  insert into public.vendors (name, slug, status, description, category_id, pickup_location_text, prep_minutes, owner_id)
  values ('Sample Print Shop', 'sample-print-shop', 'approved', 'Fictional demo print and binding service.', cat_print, 'Sample print desk (placeholder)', 30, o_print) returning id into v_print;
  insert into public.vendors (name, slug, status, description, category_id, pickup_location_text, prep_minutes, owner_id)
  values ('Sample Souvenirs', 'sample-souvenirs', 'approved', 'Fictional demo souvenir stand (shown as closed: no opening hours).', cat_souv, 'Sample stand (placeholder)', 10, o_souv) returning id into v_souv;

  insert into public.vendor_staff (vendor_id, user_id, staff_role) values (v_food, o_food, 'owner'), (v_print, o_print, 'owner'), (v_souv, o_souv, 'owner');
  insert into public.role_assignments (user_id, role) values (o_food, 'vendor_owner'), (o_print, 'vendor_owner'), (o_souv, 'vendor_owner');
  -- Kitchen and print shop: open every day around the clock so demos and tests never depend on the time of day.
  insert into public.store_hours (vendor_id, weekday, opens, closes)
    select v, d, '00:00', '23:59:59' from (values (v_food), (v_print)) x(v), generate_series(0, 6) d;

  -- Sample Kitchen
  insert into public.products (vendor_id, name, description, section, price_kobo, stock_quantity) values
    (v_food, 'Jollof rice and chicken', 'Smoky party-style jollof with a piece of chicken.', 'Mains', 250000, null) returning id into p;
  insert into public.product_option_groups (product_id, name, min_select, max_select, sort_order) values (p, 'Protein', 1, 1, 0) returning id into g;
  insert into public.product_options (group_id, name, price_delta_kobo, sort_order) values (g, 'Chicken', 0, 0), (g, 'Beef', 70000, 1), (g, 'Fish', 90000, 2);
  insert into public.product_option_groups (product_id, name, min_select, max_select, sort_order) values (p, 'Extras', 0, 2, 1) returning id into g;
  insert into public.product_options (group_id, name, price_delta_kobo, sort_order) values (g, 'Extra plantain', 30000, 0), (g, 'Coleslaw', 20000, 1);
  insert into public.products (vendor_id, name, description, section, price_kobo, stock_quantity) values
    (v_food, 'Fried plantain', 'A generous portion.', 'Sides', 80000, 50),
    (v_food, 'Zobo drink', 'Chilled hibiscus drink (low stock demo).', 'Drinks', 50000, 5);
  insert into public.products (vendor_id, name, description, section, price_kobo, is_available) values
    (v_food, 'Bottled water', 'Shown as sold out.', 'Drinks', 30000, false);

  -- Sample Print Shop
  insert into public.products (vendor_id, name, description, section, price_kobo) values
    (v_print, 'Print A4 (per page)', 'Black and white.', 'Printing', 5000),
    (v_print, 'Spiral binding', 'Per document.', 'Finishing', 100000);
  insert into public.products (vendor_id, name, description, section, price_kobo) values
    (v_print, 'Poster print A2', 'High quality poster.', 'Printing', 350000) returning id into p;
  insert into public.product_option_groups (product_id, name, min_select, max_select) values (p, 'Finish', 1, 1) returning id into g;
  insert into public.product_options (group_id, name, price_delta_kobo, sort_order) values (g, 'Matte', 0, 0), (g, 'Gloss', 50000, 1);

  -- Sample Souvenirs (no hours => closed)
  insert into public.products (vendor_id, name, description, section, price_kobo) values
    (v_souv, 'Branded notebook', 'Fictional notebook.', 'Stationery', 180000);
end $$;

-- LOCAL ONLY: allows the clearly-labelled MOCK payment (the app also requires APP_ENV=local).
update public.platform_settings set value = 'true'::jsonb where key = 'mock_payments_enabled';
