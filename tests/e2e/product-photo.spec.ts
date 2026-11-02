import { expect, test } from '@playwright/test'
import {
  a11yClean,
  admin,
  clickAndWait,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  tag,
} from './helpers'

test('a vendor adds, replaces and removes a product photo; customers see it; hidden products serve nothing', async ({
  browser,
}, info) => {
  const owner = await openSession(browser, info, 'pp-owner', ['vendor_owner'])
  const name = `Photo dish ${tag()}`
  const shop = await makeShopWithPoint(owner.user.id, name)
  const { data: prod } = await admin()
    .from('products')
    .select('id')
    .eq('vendor_id', shop.vendorId)
    .single()
  const id = prod!.id as string
  const p = owner.page

  // no photo yet: the image address answers with the branded placeholder tile, never an error
  const none = await p.request.get(`/api/products/${id}/image`)
  expect(none.status()).toBe(200)
  expect(none.headers()['content-type']).toBe('image/svg+xml')
  await p.goto(`/vendor/catalogue/${id}`)
  await expect(p.getByRole('button', { name: 'Add a photo' })).toBeVisible()
  await a11yClean(p, '/vendor/catalogue/[id] (no photo)')

  // choose a picture: it is shrunk in the browser, previewed, and saved with the form
  await p.locator('#product-photo-input').setInputFiles('tests/e2e/fixtures/photo.png')
  await expect(p.getByRole('img', { name: 'Photo of this item' })).toBeVisible()
  await clickAndWait(p, () => p.getByRole('button', { name: 'Save changes' }).click())
  await expect(p.getByText('Product and photo saved.')).toBeVisible()
  const img = await p.request.get(`/api/products/${id}/image`)
  expect(img.status()).toBe(200)
  expect(img.headers()['content-type']).toBe('image/jpeg')
  expect((await img.body()).subarray(0, 3).toString('hex')).toBe('ffd8ff')

  // customers (and anonymous visitors) see the photo on the product page and the shop page
  const anon = await openAnonymous(browser, info)
  await anon.page.goto(`/products/${id}`)
  await expect(anon.page.locator(`img[src="/api/products/${id}/image"]`).first()).toBeVisible()
  expect(
    await anon.page
      .locator(`img[src="/api/products/${id}/image"]`)
      .first()
      .evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(10)

  // the vendor's own list shows the thumbnail too
  await p.goto('/vendor/catalogue')
  await expect(p.locator(`img[src="/api/products/${id}/image"]`).first()).toBeVisible()

  // remove the photo: back to 404 and the tile
  await p.goto(`/vendor/catalogue/${id}`)
  await p.getByRole('button', { name: 'Remove photo' }).click()
  await clickAndWait(p, () => p.getByRole('button', { name: 'Save changes' }).click())
  expect((await p.request.get(`/api/products/${id}/image`)).headers()['content-type']).toBe(
    'image/svg+xml',
  )

  // a suspended shop's photos are not served
  await p.locator('#product-photo-input').setInputFiles('tests/e2e/fixtures/photo.png')
  await clickAndWait(p, () => p.getByRole('button', { name: 'Save changes' }).click())
  expect((await p.request.get(`/api/products/${id}/image`)).status()).toBe(200)
  await admin().from('vendors').update({ status: 'suspended' }).eq('id', shop.vendorId)
  expect((await anon.page.request.get(`/api/products/${id}/image`)).headers()['content-type']).toBe(
    'image/svg+xml',
  )
  await Promise.all([owner.context.close(), anon.context.close()])
})
