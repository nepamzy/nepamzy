// Checkout integration for the rider direct delivery-fee payment: the mode is a platform setting changed by an administrator
// (with a reason), read on the server when the order is created. The customer's browser never supplies it.
import { expect, test } from '@playwright/test'
import {
  a11yClean,
  admin,
  clickAndWait,
  createUser,
  fixPricing,
  makeShopWithPoint,
  openSession,
  tag,
} from './helpers'

test.describe.configure({ mode: 'serial' })
const MODE = 'delivery_fee_collection_mode'
const setMode = async (value: 'paystack' | 'direct_to_rider') => {
  const { error } = await admin().from('platform_settings').update({ value }).eq('key', MODE)
  if (error) throw error
}
test.afterEach(async () => {
  await setMode('paystack')
})

test('an administrator switches the mode with a reason; the next delivery order excludes the fee from the online total; older orders are untouched', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  await setMode('paystack')
  await fixPricing(50000)
  const owner = await createUser('dfk-owner', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Rice ${tag()}`)
  const customer = await openSession(browser, info, 'dfk-cust')
  const c = customer.page

  const placeOrder = async () => {
    await c.goto(`/vendors/${shop.slug}`)
    await c.getByRole('link', { name: /Rice/ }).first().click()
    await c.getByRole('button', { name: 'Add to cart' }).click()
    await expect(c).toHaveURL(/\/cart$/)
    await c.goto('/checkout')
    await c.getByRole('radio', { name: /Delivery/ }).check()
    await c.getByLabel('Delivery point', { exact: true }).selectOption({ label: shop.pointLabel })
    return c
  }

  // 1. default mode: the fee is inside the total
  await placeOrder()
  await expect(c.getByTestId('checkout-total')).toBeVisible()
  const totalBefore = await c.getByTestId('checkout-total').innerText()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Place order' }).click())
  await expect(c).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  const first = c.url().split('/').pop()!
  const o1 = (
    await admin()
      .from('orders')
      .select('delivery_fee_collection,total_kobo,items_total_kobo,delivery_fee_kobo')
      .eq('id', first)
      .single()
  ).data!
  expect(o1.delivery_fee_collection).toBe('paystack')
  expect(o1.total_kobo).toBe(o1.items_total_kobo + o1.delivery_fee_kobo)

  // 2. an administrator changes the setting through the real settings page, with a recorded reason
  const adm = await openSession(browser, info, 'dfk-admin', ['platform_admin'])
  await adm.page.goto('/admin/settings')
  const card = adm.page.getByRole('group', { name: `Setting ${MODE}` })
  await card.getByLabel(/Reason for the change/).fill('Owner approved a direct payment trial')
  await card.getByLabel('New value').fill('"direct_to_rider"')
  await clickAndWait(adm.page, () => card.getByRole('button', { name: 'Save' }).click())
  await expect(card.getByText(/Saved and recorded/)).toBeVisible()
  await a11yClean(adm.page, 'admin settings')
  const audit = (
    await admin()
      .from('audit_events')
      .select('details')
      .eq('action', 'setting.changed')
      .eq('entity_id', MODE)
      .order('id', { ascending: false })
      .limit(1)
      .single()
  ).data!
  expect(audit.details).toMatchObject({ new: 'direct_to_rider', outcome: 'applied' })

  // 3. the unpaid first order keeps its own mode; a new order excludes the delivery fee from the online amount
  const stale = (
    await admin().from('orders').select('delivery_fee_collection').eq('id', first).single()
  ).data!
  expect(stale.delivery_fee_collection).toBe('paystack')
  await placeOrder()
  await expect(
    c.getByText(/you pay this to your rider by bank transfer after delivery/),
  ).toBeVisible()
  await expect(c.getByText('Total to pay online now')).toBeVisible()
  await a11yClean(c, 'checkout in direct mode')
  void totalBefore
  await clickAndWait(c, () => c.getByRole('button', { name: 'Place order' }).click())
  await expect(c).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  const second = c.url().split('/').pop()!
  const o2 = (
    await admin()
      .from('orders')
      .select('delivery_fee_collection,total_kobo,items_total_kobo,delivery_fee_kobo')
      .eq('id', second)
      .single()
  ).data!
  expect(o2.delivery_fee_collection).toBe('direct_to_rider')
  expect(o2.total_kobo).toBe(o2.items_total_kobo)
  await expect(
    c.getByText('(paid directly to your rider, not part of the total below)'),
  ).toBeVisible()
  await c.getByRole('button', { name: /Pay \(test/ }).click()
  await expect(c.getByText('Payment received', { exact: true }).first()).toBeVisible()
  // (the local test-pay button records no ledger entry; the DB suite proves the Paystack-collected amount equals this total)
  // not yet delivered: no payment to the rider is requested
  await c.goto(`/orders/${second}/delivery-fee`)
  await expect(c.getByText('Not ready yet')).toBeVisible()
})

test('the public receipt check is rate limited per address and answers safely', async ({
  browser,
}, info) => {
  const { openAnonymous } = await import('./helpers')
  const anon = await openAnonymous(browser, info)
  let limited = false
  for (let i = 0; i < 40 && !limited; i++) {
    await anon.page.goto(`/receipts/${'a'.repeat(47)}${(i % 10).toString()}`)
    limited = await anon.page.getByText('Too many checks from this connection.').isVisible()
    if (!limited) await expect(anon.page.getByText('No receipt matches this link.')).toBeVisible()
  }
  expect(limited).toBe(true)
  const body = await anon.page.locator('body').innerText()
  expect(body).not.toMatch(/[0-9a-f]{40}/) // the guessed token is never echoed back
})
