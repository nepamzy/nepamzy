import { expect, test } from '@playwright/test'
import { a11yClean, admin, clickAndWait, makeShopWithPoint, openSession, tag } from './helpers'

test('a vendor starts from a popular dish: name, description, section and photo fill in, the price is theirs, everything can be changed', async ({
  browser,
}, info) => {
  const owner = await openSession(browser, info, 'starter-owner', ['vendor_owner'])
  await makeShopWithPoint(owner.user.id, `Starter shop ${tag()}`)
  const p = owner.page
  await p.goto('/vendor/catalogue/new')
  await p.getByRole('button', { name: 'Choose from the list' }).click()
  await expect(p.getByRole('heading', { name: 'Drinks' })).toBeVisible()
  await a11yClean(p, '/vendor/catalogue/new (picker open)')
  await p.getByRole('button', { name: 'Jollof rice and chicken' }).click()
  await expect(p.getByLabel('Name')).toHaveValue('Jollof rice and chicken')
  await expect(p.getByLabel('Menu section')).toHaveValue('Mains')
  // the photo is loaded into the form like a chosen picture
  await expect(p.getByRole('img', { name: 'Photo of this item' })).toBeVisible()
  // the owner renames it and sets the price
  const renamed = `Mama's jollof ${tag()}`
  await p.getByLabel('Name').fill(renamed)
  await p.getByLabel('Price (₦)').fill('2500')
  await clickAndWait(p, () => p.getByRole('button', { name: 'Add to menu' }).click())
  const { data } = await admin()
    .from('products')
    .select('id, name, price_kobo, product_images(product_id)')
    .eq('name', renamed)
    .single()
  expect(data!.price_kobo).toBe(250000)
  const img = await p.request.get(`/api/products/${data!.id}/image`)
  expect(img.headers()['content-type']).toBe('image/jpeg')
  await owner.context.close()
})

test('a vendor adds ready-made items for their category: price now or later, only their category is shown', async ({
  browser,
}, info) => {
  const a = admin()
  const owner = await openSession(browser, info, 'quick-owner', ['vendor_owner'])
  const { vendorId } = await makeShopWithPoint(owner.user.id, `Quick shop ${tag()}`)
  const p = owner.page
  await p.goto('/vendor/catalogue/quick-add')
  await expect(p.getByRole('heading', { name: 'Add from the list' })).toBeVisible()
  // a food shop sees food and drinks, not clothes
  await expect(p.getByText('Soups and swallows')).toBeVisible()
  await expect(p.getByLabel('Hoodie')).toHaveCount(0)
  await a11yClean(p, '/vendor/catalogue/quick-add')

  // tick a dish with a photo (price now) and one without a price (later)
  await p.getByLabel('Jollof spaghetti', { exact: true }).check()
  await p.getByLabel('Suya', { exact: true }).check()
  await p.locator('input[name="price:jollof-spaghetti"]').fill('2000')
  await expect(p.getByRole('button', { name: /Add 2 selected items/ })).toBeEnabled()
  await clickAndWait(p, () => p.getByRole('button', { name: /Add 2 selected items/ }).click())
  await expect(p.getByTestId('quick-add').getByRole('status')).toContainText(
    '1 item added to your menu',
  )
  await expect(p.getByTestId('quick-add').getByRole('status')).toContainText(
    '1 saved until you set a price',
  )

  const { data: added } = await a
    .from('products')
    .select('id, price_kobo, section, product_images(product_id)')
    .eq('name', 'Jollof spaghetti')
    .eq('vendor_id', vendorId)
    .single()
  expect(added!.price_kobo).toBe(200000)
  expect(added!.section).toBe('Mains')
  expect(added!.product_images).toBeTruthy()
  // the dish without a price is NOT a product, so customers cannot see it
  const { data: notYet } = await a
    .from('products')
    .select('id')
    .eq('name', 'Suya')
    .eq('vendor_id', vendorId)
  expect(notYet).toHaveLength(0)

  await p.reload()
  await expect(p.getByText('Saved, waiting for a price')).toBeVisible()
  await expect(p.getByText('On your menu').first()).toBeVisible()
  // set the price later: tick it again with a price
  await p.getByLabel('Suya', { exact: true }).check()
  await p.locator('input[name="price:suya"]').fill('800')
  await clickAndWait(p, () => p.getByRole('button', { name: /Add 1 selected item/ }).click())
  await expect(p.getByTestId('quick-add').getByRole('status')).toContainText(
    '1 item added to your menu',
  )
  const { data: suya } = await a
    .from('products')
    .select('price_kobo')
    .eq('name', 'Suya')
    .eq('vendor_id', vendorId)
    .single()
  expect(suya!.price_kobo).toBe(80000)
  const { data: left } = await a
    .from('vendor_catalogue_picks')
    .select('slug')
    .eq('vendor_id', vendorId)
  expect(left).toHaveLength(0)
  await owner.context.close()

  // a clothing shop sees clothing, not food
  await a.from('categories').upsert({ slug: 'clothing', name: 'clothing' }, { onConflict: 'slug' })
  const { data: cat } = await a.from('categories').select('id').eq('slug', 'clothing').single()
  const shop = await openSession(browser, info, 'quick-clothes', ['vendor_owner'])
  await makeShopWithPoint(shop.user.id, `Clothes shop ${tag()}`)
  await a.from('vendors').update({ category_id: cat!.id }).eq('owner_id', shop.user.id)
  const { data: sv } = await a.from('vendors').select('id').eq('owner_id', shop.user.id).single()
  await a.from('vendor_categories').delete().eq('vendor_id', sv!.id).neq('category_id', cat!.id)
  await shop.page.goto('/vendor/catalogue/quick-add')
  await expect(shop.page.getByLabel('Hoodie', { exact: true })).toBeVisible()
  await expect(shop.page.getByLabel('Jollof spaghetti', { exact: true })).toHaveCount(0)
  await shop.page.getByLabel('Hoodie', { exact: true }).check()
  await shop.page.locator('input[name="price:hoodie"]').fill('9000')
  await clickAndWait(shop.page, () =>
    shop.page.getByRole('button', { name: /Add 1 selected item/ }).click(),
  )
  await expect(shop.page.getByTestId('quick-add').getByRole('status')).toContainText(
    '1 item added to your menu',
  )
  await shop.context.close()
})

test('a shop owner can change what the shop sells, and the ready-made list follows', async ({
  browser,
}, info) => {
  const a = admin()
  await a.from('categories').upsert(
    [
      { slug: 'clothing', name: 'Clothing' },
      { slug: 'gadgets', name: 'Gadgets' },
    ],
    { onConflict: 'slug' },
  )
  const owner = await openSession(browser, info, 'cat-owner', ['vendor_owner'])
  await makeShopWithPoint(owner.user.id, `Categories shop ${tag()}`)
  const p = owner.page
  await p.goto('/vendor/profile')
  await p.getByLabel('Main category').selectOption({ label: 'Clothing' })
  await p.getByRole('group', { name: 'Also sells' }).getByLabel('Gadgets', { exact: true }).check()
  await clickAndWait(p, () => p.getByRole('button', { name: 'Save categories' }).click())
  await expect(
    p
      .getByTestId('profile-categories-status')
      .or(p.getByRole('status').filter({ hasText: 'Categories saved' })),
  ).toBeVisible()
  await p.goto('/vendor/catalogue/quick-add')
  await expect(p.getByLabel('Hoodie', { exact: true })).toBeVisible()
  await expect(p.getByLabel('Phone charger', { exact: true })).toBeVisible()
  await expect(p.getByLabel('Jollof spaghetti', { exact: true })).toHaveCount(0)
  await owner.context.close()
})
