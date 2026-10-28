// Rider direct delivery-fee payment, end to end through the real UI (local only; no real bank, money or Paystack).
// The fixture marks one order as "delivery fee NOT collected by Paystack" exactly as a future explicit checkout mode would.
import pg from 'pg'
import { expect, test } from '@playwright/test'
import {
  a11yClean,
  admin,
  clickAndWait,
  fixPricing,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  openSessionFor,
  restorePlaceholderTerms,
  seedRider,
  tag,
} from './helpers'

test.describe.configure({ mode: 'serial' })
test.afterEach(async () => {
  await restorePlaceholderTerms()
})

async function directOrder(customerId: string, riderId: string, shiftId: string) {
  await fixPricing(50000)
  const owner = await (await import('./helpers')).createUser('dfv', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Rice ${tag()}`)
  const a = admin()
  const { data: o, error } = await a
    .from('orders')
    .insert({
      order_number: `AFM-D${tag()}`,
      customer_id: customerId,
      vendor_id: shop.vendorId,
      vendor_name: 'Fixture shop',
      fulfilment: 'delivery',
      delivery_point_id: shop.pointId,
      delivery_point_label: shop.pointLabel,
      pickup_location_snapshot: 'Counter (placeholder)',
      status: 'COMPLETED',
      items_total_kobo: 100000,
      delivery_fee_kobo: 50000,
      platform_fee_kobo: 0,
      total_kobo: 100000, // the fee is NOT inside the Paystack part
      delivery_fee_collection: 'direct_to_rider',
      idempotency_key: `fixture-${tag()}-key`,
    })
    .select('id, order_number')
    .single()
  if (error) throw error
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  try {
    await db.query(
      `insert into public.ledger_entries (order_id, entry_type, amount_kobo) values ($1,'payment_received',100000)`,
      [o!.id],
    )
    await db.query(
      `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, status, completed_at) values ($1,$2,$3,1,'completed', now())`,
      [o!.id, riderId, shiftId],
    )
  } finally {
    await db.end()
  }
  return o as { id: string; order_number: string }
}

test('customer reports, rider confirms, one receipt is issued, and the public page proves only that', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  const rider = await seedRider({ active: true })
  const customer = await openSession(browser, info, 'dfc')
  const order = await directOrder(customer.user.id, rider.id, rider.shift!)
  const r = await openSessionFor(browser, info, rider)

  // Rider: dashboard wording, bank details
  await r.page.goto('/rider')
  await expect(r.page.getByText('Rider earnings: Free of charge.')).toBeVisible()
  await expect(r.page.getByText('Delivery commission features: Coming Soon')).toBeVisible()
  await r.page.goto('/rider/payments')
  await r.page.getByLabel('Bank name').fill('Fixture Bank')
  await r.page.getByLabel('Account number').fill('0123456789')
  await r.page.getByLabel('Account name').fill('Fixture Rider')
  await clickAndWait(r.page, () =>
    r.page.getByRole('button', { name: 'Save bank details' }).click(),
  )
  await expect(r.page.getByText('******6789')).toBeVisible()
  await a11yClean(r.page, 'rider payments')

  // Customer: pay screen
  const c = customer.page
  await c.goto(`/orders/${order.id}/delivery-fee`)
  await expect(c.getByRole('heading', { name: 'Pay Delivery Fee' })).toBeVisible()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Show payment details' }).click())
  await expect(c.getByText('0123456789')).toBeVisible()
  await expect(c.getByText('Fixture Bank')).toBeVisible()
  await expect(c.getByRole('button', { name: 'Copy account number' })).toBeVisible()
  await a11yClean(c, 'customer pay delivery fee')

  // A customer report alone does not complete anything
  await clickAndWait(c, () => c.getByRole('button', { name: 'I Have Made the Transfer' }).click())
  await expect(c.getByText(/waiting for the rider to confirm/i)).toBeVisible()
  await c.goto('/account/receipts')
  await expect(c.getByText('You have no delivery fee receipts.')).toBeVisible()

  // Rider confirms
  await r.page.goto('/rider/payments')
  await clickAndWait(r.page, () =>
    r.page.getByRole('button', { name: 'Yes, I received this amount' }).click(),
  )
  await expect(r.page.getByText(/Delivery fee receipt AFR-/)).toBeVisible()

  // Customer sees one receipt and a public check link
  await c.goto('/account/receipts')
  await expect(c.getByText(/Delivery fee receipt AFR-/)).toHaveCount(1)
  const link = await c.locator('a[href*="/receipts/"]').first().getAttribute('href')
  expect(link).toMatch(/\/receipts\/[0-9a-f]{48}$/)

  // Public page: no names, no bank details; says what it does not prove
  const anon = await openAnonymous(browser, info)
  await anon.page.goto(link!)
  await expect(anon.page.getByText('Record found')).toBeVisible()
  await expect(anon.page.getByText(/not a bank statement/i)).toBeVisible()
  const body = await anon.page.locator('body').innerText()
  for (const secret of ['0123456789', 'Fixture Bank', 'Fixture Rider', order.order_number])
    expect(body).not.toContain(secret)
  await a11yClean(anon.page, 'public receipt check')
  await anon.page.goto(`/receipts/${'0'.repeat(48)}`)
  await expect(anon.page.getByText('No receipt matches this link.')).toBeVisible()
})

test('rider dispute needs a reason; an administrator decides it and the record is kept', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  const rider = await seedRider({ active: true })
  const customer = await openSession(browser, info, 'dfd')
  const order = await directOrder(customer.user.id, rider.id, rider.shift!)
  const r = await openSessionFor(browser, info, rider)
  await r.page.goto('/rider/payments')
  await r.page.getByLabel('Bank name').fill('Fixture Bank')
  await r.page.getByLabel('Account number').fill('0123456789')
  await r.page.getByLabel('Account name').fill('Fixture Rider')
  await clickAndWait(r.page, () =>
    r.page.getByRole('button', { name: 'Save bank details' }).click(),
  )
  const c = customer.page
  await c.goto(`/orders/${order.id}/delivery-fee`)
  await clickAndWait(c, () => c.getByRole('button', { name: 'Show payment details' }).click())
  await clickAndWait(c, () => c.getByRole('button', { name: 'I Have Made the Transfer' }).click())

  await r.page.goto('/rider/payments')
  await r.page.getByLabel('Why are you disputing it?').fill('Nothing arrived in my account')
  await clickAndWait(r.page, () =>
    r.page.getByRole('button', { name: 'No, I did not receive it' }).click(),
  )
  await expect(r.page.getByText('Disputed').first()).toBeVisible()

  const staff = await openSession(browser, info, 'dfa', ['platform_admin'])
  await staff.page.goto('/admin/delivery-fee-payments')
  await expect(staff.page.getByText(order.order_number)).toBeVisible()
  const card = staff.page.locator('li').filter({ hasText: order.order_number })
  await card
    .getByLabel('Reason (required, recorded)')
    .nth(1) // the form for "not received"
    .fill('Reviewed the statements given by both parties')
  await clickAndWait(staff.page, () =>
    card.getByRole('button', { name: 'Decide: it was not received' }).click(),
  )
  await staff.page.goto('/admin/delivery-fee-payments')
  await expect(
    staff.page
      .locator('li')
      .filter({ hasText: order.order_number })
      .getByText('Settled by administrator: not received')
      .first(),
  ).toBeVisible()
  await a11yClean(staff.page, 'admin delivery fee payments')
})

test('an ordinary Paystack-collected delivery order is never asked for a second delivery fee', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'dfp')
  const owner = await (await import('./helpers')).createUser('dfpv', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Rice ${tag()}`)
  const { data: o, error } = await admin()
    .from('orders')
    .insert({
      order_number: `AFM-P${tag()}`,
      customer_id: customer.user.id,
      vendor_id: shop.vendorId,
      vendor_name: 'Fixture shop',
      fulfilment: 'delivery',
      delivery_point_id: shop.pointId,
      delivery_point_label: shop.pointLabel,
      pickup_location_snapshot: 'Counter (placeholder)',
      status: 'COMPLETED',
      items_total_kobo: 100000,
      delivery_fee_kobo: 50000,
      platform_fee_kobo: 0,
      total_kobo: 150000,
      idempotency_key: `fixture-${tag()}-key`,
    })
    .select('id')
    .single()
  if (error) throw error
  await customer.page.goto(`/orders/${o!.id}/delivery-fee`)
  await expect(customer.page.getByText('Nothing to pay the rider')).toBeVisible()
  await expect(customer.page.getByRole('button', { name: 'Show payment details' })).toHaveCount(0)
})
