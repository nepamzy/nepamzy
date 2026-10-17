import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { signBody } from '../../src/server/modules/payments/signature'
import {
  admin,
  alertIn,
  clickAndWait,
  createUser,
  fixPricing,
  openAnonymous,
  openSession,
  tag,
} from './helpers'

test.describe.configure({ mode: 'serial' })

// provider event ids must be unique per run (the database remembers every id it has processed)
const RUN = Date.now() * 10
const SECRET = process.env.PAYSTACK_SECRET_KEY ?? 'sk_test_local_fake_key_for_dev'

/** A real shop (24h hours, one stock-tracked product) owned by `owner`. */
async function makeShop(ownerId: string, productName: string, opts: { stock?: number } = {}) {
  const a = admin()
  const { data: cat } = await a.from('categories').select('id').eq('slug', 'food').single()
  const slug = `shop-${tag()}`
  const { data: v, error } = await a
    .from('vendors')
    .insert({
      name: `Shop ${slug}`,
      slug,
      status: 'approved',
      category_id: cat!.id,
      owner_id: ownerId,
      pickup_location_text: 'Counter (placeholder)',
      prep_minutes: 10,
    })
    .select('id')
    .single()
  if (error) throw error
  await a.from('vendor_staff').insert({ vendor_id: v!.id, user_id: ownerId, staff_role: 'owner' })
  await a.from('store_hours').insert(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      vendor_id: v!.id,
      weekday,
      opens: '00:00',
      closes: '23:59:59',
    })),
  )
  const { error: pe } = await a.from('products').insert({
    vendor_id: v!.id,
    name: productName,
    price_kobo: 150000,
    stock_quantity: opts.stock ?? 20,
    status: 'active',
    is_available: true,
  })
  if (pe) throw pe
  return { id: v!.id as string, slug }
}

async function placePickupOrder(page: Page, slug: string, productName: string) {
  await page.goto(`/vendors/${slug}`)
  await page.getByRole('link', { name: productName }).first().click()
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page).toHaveURL(/\/cart$/)
  await page.goto('/checkout')
  await clickAndWait(page, () => page.getByRole('button', { name: 'Place order' }).click())
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop()!
}

const orderRow = async (id: string) =>
  (await admin().from('orders').select('status,total_kobo,order_number').eq('id', id).single())
    .data!
const referenceFor = async (orderId: string) =>
  (
    await admin()
      .from('payment_transactions')
      .select('reference,amount_kobo')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
  ).data!

async function postWebhook(raw: string, signature: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['x-paystack-signature'] = signature
  return fetch('http://127.0.0.1:3000/api/webhooks/paystack', {
    method: 'POST',
    headers,
    body: raw,
  })
}

test('Paystack test payment -> vendor accepts, prepares, readies -> pickup code + signature -> receipt', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  await fixPricing(50000)
  const name = `Plantain ${tag()}`
  const vendorUser = await openSession(browser, info, 'vowner', ['vendor_owner'])
  const shop = await makeShop(vendorUser.user.id, name)
  const buyer = await openSession(browser, info, 'payer')
  const b = buyer.page

  const orderId = await placePickupOrder(b, shop.slug, name)
  await expect(b.getByRole('heading', { name: 'Payment needed' })).toBeVisible()
  await b.getByRole('button', { name: /Pay with Paystack/ }).click()
  await expect(b).toHaveURL(/127\.0\.0\.1:3002\/checkout\//)
  await b.getByRole('button', { name: 'Simulate successful payment' }).click()
  await expect(b).toHaveURL(new RegExp(`/orders/${orderId}$`))
  await expect(b.getByText('Payment received', { exact: true }).first()).toBeVisible()
  expect((await orderRow(orderId)).status).toBe('PAID')
  const { count } = await admin()
    .from('ledger_entries')
    .select('*', { count: 'exact', head: true })
    .eq('order_id', orderId)
  expect(count).toBe(1)

  // vendor works the order
  const v = vendorUser.page
  await v.goto('/vendor/orders')
  await expect(v.getByText(name).first()).toBeVisible()
  for (const [button, status] of [
    ['Accept order', 'ACCEPTED'],
    ['Start preparing', 'PREPARING'],
    ['Mark ready', 'PICKUP_AWAITING_HANDOVER'],
  ] as const) {
    await clickAndWait(v, () => v.getByRole('button', { name: button }).click())
    await expect.poll(async () => (await orderRow(orderId)).status).toBe(status)
    await v.reload()
  }

  // customer sees the pickup code
  await b.goto(`/orders/${orderId}`)
  await expect(b.getByRole('heading', { name: 'Your pickup code' })).toBeVisible()
  const code = (await b.locator('p.tracking-widest').innerText()).trim()
  expect(code).toMatch(/^[0-9A-F]{8}$/)

  // handover: wrong code, missing signature, then the real thing
  await v.goto('/vendor/handover')
  // finding an order by its code only POINTS at the order; it never completes it
  await v.getByLabel('Code the customer shows you').fill('NOTACODE')
  await clickAndWait(v, () => v.getByRole('button', { name: 'Find order' }).click())
  await expect(v.getByText('No pickup is waiting for that code at your shop.')).toBeVisible()
  await v.getByLabel('Code the customer shows you').fill(code.toLowerCase())
  await clickAndWait(v, () => v.getByRole('button', { name: 'Find order' }).click())
  await expect(v.getByText(/Go to this order to complete the handover/)).toBeVisible()
  expect((await orderRow(orderId)).status).toBe('PICKUP_AWAITING_HANDOVER')
  await v.getByLabel('Pickup code from the customer').fill('WRONG123')
  await v.getByLabel('Recipient name').fill('Ada Student')
  const pad = v.locator('canvas')
  const sign = async () => {
    await pad.scrollIntoViewIfNeeded()
    const box = (await pad.boundingBox())! // measured now: an error message above the pad moves it
    await v.mouse.move(box.x + 20, box.y + 40)
    await v.mouse.down()
    await v.mouse.move(box.x + 120, box.y + 90, { steps: 8 })
    await v.mouse.move(box.x + 60, box.y + 120, { steps: 8 })
    await v.mouse.up()
  }
  await clickAndWait(v, () => v.getByRole('button', { name: 'Complete handover' }).click())
  await expect(alertIn(v)).toContainText(/must sign/i)
  await sign()
  await v.getByLabel('Pickup code from the customer').fill('WRONG123')
  await v.getByLabel('Recipient name').fill('Ada Student') // the form resets after each submission
  await clickAndWait(v, () => v.getByRole('button', { name: 'Complete handover' }).click())
  await expect(alertIn(v)).toContainText(/not right/i)
  expect((await orderRow(orderId)).status).toBe('PICKUP_AWAITING_HANDOVER')
  await v.getByLabel('Pickup code from the customer').fill(code.toLowerCase())
  await v.getByLabel('Recipient name').fill('Ada Student') // signature stays drawn across the reset
  await clickAndWait(v, () => v.getByRole('button', { name: 'Complete handover' }).click())
  // the finished order leaves the waiting list
  await expect(v.getByText('Nothing waiting for pickup')).toBeVisible()
  expect((await orderRow(orderId)).status).toBe('COMPLETED')

  // receipt: owner and shop can fetch the PDF; a stranger and anonymous cannot
  const pdf = await b.request.get(`/orders/${orderId}/receipt`)
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toContain('application/pdf')
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
  expect((await v.request.get(`/orders/${orderId}/receipt`)).status()).toBe(200)
  const stranger = await openSession(browser, info, 'stranger')
  expect((await stranger.page.request.get(`/orders/${orderId}/receipt`)).status()).toBe(404)
  const anon = await openAnonymous(browser, info)
  expect((await anon.page.request.get(`/orders/${orderId}/receipt`)).status()).toBe(401)
  await Promise.all([
    buyer.context.close(),
    vendorUser.context.close(),
    stranger.context.close(),
    anon.context.close(),
  ])
})

test('failed payment leaves the order unpaid and payable; webhook signature, replay and tampering are handled', async ({
  browser,
}, info) => {
  test.setTimeout(180000)
  await fixPricing(50000)
  const name = `Bun ${tag()}`
  const owner = await createUser('vown2', ['vendor_owner'])
  const shop = await makeShop(owner.id, name)
  const buyer = await openSession(browser, info, 'payer2')
  const b = buyer.page
  const orderId = await placePickupOrder(b, shop.slug, name)

  await b.getByRole('button', { name: /Pay with Paystack/ }).click()
  await b.getByRole('button', { name: 'Simulate failed payment' }).click()
  await expect(b).toHaveURL(new RegExp(`/orders/${orderId}$`))
  expect((await orderRow(orderId)).status).toBe('PENDING_PAYMENT')
  await expect(b.getByRole('button', { name: /Pay with Paystack/ })).toBeVisible() // can retry

  await b.getByRole('button', { name: /Pay with Paystack/ }).click() // a fresh reference
  await expect(b).toHaveURL(/127\.0\.0\.1:3002\/checkout\//)
  const txn = await referenceFor(orderId)
  const total = Number(txn.amount_kobo)
  const evt = (amount: number, id = 777000 + Math.floor(Math.random() * 1000)) =>
    JSON.stringify({
      event: 'charge.success',
      data: { id, reference: txn.reference, amount, currency: 'NGN', status: 'success' },
    })

  // no / wrong signature => rejected, nothing changes
  const good = evt(total, RUN + 1)
  expect((await postWebhook(good, null)).status).toBe(401)
  expect((await postWebhook(good, 'a'.repeat(128))).status).toBe(401)
  expect((await postWebhook(good, signBody(good, 'sk_test_some_other_key_0000'))).status).toBe(401)
  expect((await postWebhook('{not json', signBody('{not json', SECRET))).status).toBe(400)
  expect((await orderRow(orderId)).status).toBe('PENDING_PAYMENT')

  // signed but wrong amount => flagged, never paid
  const wrong = evt(total - 100, RUN + 2)
  const r1 = await (await postWebhook(wrong, signBody(wrong, SECRET))).json()
  expect(r1.outcome).toBe('amount_mismatch')
  expect((await orderRow(orderId)).status).toBe('PENDING_PAYMENT')

  // unrelated events are acknowledged and ignored
  const other = JSON.stringify({
    event: 'transfer.success',
    data: { reference: txn.reference, amount: 1, currency: 'NGN' },
  })
  expect((await (await postWebhook(other, signBody(other, SECRET))).json()).outcome).toBe('ignored')

  // correct amount => paid; replays are harmless
  const ok = evt(total, RUN + 3)
  expect((await (await postWebhook(ok, signBody(ok, SECRET))).json()).outcome).toBe('paid')
  expect((await (await postWebhook(ok, signBody(ok, SECRET))).json()).outcome).toBe(
    'duplicate_event',
  )
  const again = evt(total, RUN + 4)
  expect((await (await postWebhook(again, signBody(again, SECRET))).json()).outcome).toBe(
    'already_succeeded',
  )
  expect((await orderRow(orderId)).status).toBe('PAID')
  const { count } = await admin()
    .from('ledger_entries')
    .select('*', { count: 'exact', head: true })
    .eq('order_id', orderId)
  expect(count).toBe(1)
  await b.goto(`/orders/${orderId}`)
  await expect(b.getByText('Payment received', { exact: true }).first()).toBeVisible()
  await buyer.context.close()
})

test('a vendor who rejects a paid order raises a refund flag that finance resolves', async ({
  browser,
}, info) => {
  test.setTimeout(180000)
  await fixPricing(50000)
  const name = `Cake ${tag()}`
  const vendorUser = await openSession(browser, info, 'vown3', ['vendor_owner'])
  const shop = await makeShop(vendorUser.user.id, name, { stock: 5 })
  const buyer = await openSession(browser, info, 'payer3')
  const orderId = await placePickupOrder(buyer.page, shop.slug, name)
  await buyer.page.getByRole('button', { name: /Pay with Paystack/ }).click()
  await buyer.page.getByRole('button', { name: 'Simulate successful payment' }).click()
  await expect(buyer.page).toHaveURL(new RegExp(`/orders/${orderId}$`))

  const v = vendorUser.page
  await v.goto('/vendor/orders')
  await v.getByLabel('Reason (the customer will see this)').fill('Oven broke down')
  await clickAndWait(v, () => v.getByRole('button', { name: 'Reject order' }).click())
  await expect.poll(async () => (await orderRow(orderId)).status).toBe('CANCELLED')
  const { data: prod } = await admin()
    .from('products')
    .select('stock_quantity')
    .eq('vendor_id', shop.id)
    .single()
  expect(prod!.stock_quantity).toBe(5) // stock released

  const fin = await openSession(browser, info, 'fin', ['finance_admin'])
  const f = fin.page
  await f.goto('/admin/payments')
  const order = await orderRow(orderId)
  await expect(f.getByText(order.order_number).first()).toBeVisible()
  await expect(f.getByText(/vendor rejected paid order/i).first()).toBeVisible()
  await f
    .getByLabel('Resolution note')
    .first()
    .fill('Refund to be sent manually after provider confirmation')
  await clickAndWait(f, () => f.getByRole('button', { name: 'Mark resolved' }).first().click())
  await f.goto('/admin/payments')
  await expect(f.getByText(order.order_number)).toHaveCount(0)
  await Promise.all([buyer.context.close(), vendorUser.context.close(), fin.context.close()])
})

test('payments admin and the scheduled expiry job are protected', async ({ browser }, info) => {
  const cust = await openSession(browser, info, 'nofin')
  const r = await cust.page.goto('/admin/payments')
  expect(r?.status()).toBe(403)
  await cust.context.close()

  const url = 'http://127.0.0.1:3000/api/jobs/expire-orders'
  expect((await fetch(url, { method: 'POST' })).status).toBe(401)
  expect(
    (await fetch(url, { method: 'POST', headers: { authorization: 'Bearer nope' } })).status,
  ).toBe(401)
  const secret = process.env.JOBS_SECRET
  if (secret) {
    const ok = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).ok).toBe(true)
  }
  expect(randomUUID()).toBeTruthy()
})
