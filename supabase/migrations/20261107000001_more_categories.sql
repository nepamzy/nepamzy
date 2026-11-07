-- More shop categories for a university and its surroundings, and the spelling fix for "accessories". ADDITIVE / DATA ONLY.
-- Categories only describe what a shop sells; nothing else depends on the exact set. Administrators can still add, rename or hide them.

update public.categories set slug = 'accessories', name = 'Accessories' where slug = 'acccessories';
update public.categories set name = 'Clothing' where slug = 'clothing' and name = 'clothing';
update public.categories set name = 'Gadgets' where slug = 'gadgets' and name = 'gadgets';
update public.categories set name = 'Games' where slug = 'games' and name = 'games';

insert into public.categories (slug, name, sort_order, is_active) values
  ('clothing', 'Clothing', 35, true),
  ('accessories', 'Accessories', 36, true),
  ('gadgets', 'Gadgets', 37, true),
  ('games', 'Games', 38, true),
  ('groceries', 'Groceries and provisions', 50, true),
  ('fruits-vegetables', 'Fruits and vegetables', 60, true),
  ('bakery', 'Bakery and pastries', 70, true),
  ('books', 'Books and textbooks', 80, true),
  ('stationery', 'Stationery and school supplies', 90, true),
  ('footwear', 'Footwear', 100, true),
  ('bags', 'Bags and luggage', 110, true),
  ('jewellery', 'Jewellery and watches', 120, true),
  ('beauty', 'Beauty and personal care', 130, true),
  ('hair-barbing', 'Hair and barbing', 140, true),
  ('tailoring', 'Tailoring and fashion design', 150, true),
  ('laundry', 'Laundry and dry cleaning', 160, true),
  ('phone-repair', 'Phone and laptop repair', 170, true),
  ('electronics', 'Electronics and appliances', 180, true),
  ('room-home', 'Room and home items', 190, true),
  ('sports', 'Sports and fitness', 200, true),
  ('photography', 'Photography and video', 210, true),
  ('tutoring', 'Tutoring and lessons', 220, true),
  ('event-services', 'Events, decoration and catering', 230, true),
  ('other', 'Other', 900, true)
on conflict (slug) do nothing;

-- keep the original and the owner-added categories in a sensible order
update public.categories set sort_order = 35 where slug = 'clothing' and sort_order > 1000;
update public.categories set sort_order = 36 where slug = 'accessories' and sort_order > 1000;
update public.categories set sort_order = 37 where slug = 'gadgets' and sort_order > 1000;
update public.categories set sort_order = 38 where slug = 'games' and sort_order > 1000;
