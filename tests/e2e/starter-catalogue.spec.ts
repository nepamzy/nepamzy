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
