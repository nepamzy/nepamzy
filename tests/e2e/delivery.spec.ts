import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import {
  a11yClean,
  admin,
  alertIn,
  clickAndWait,
  drawSignature,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  openSessionFor,
  restorePlaceholderTerms,
  seedArrivedOrder,
  seedRider,
  tag,
} from './helpers'

test.describe.configure({ mode: 'serial' })
test.afterEach(async () => {
  await restorePlaceholderTerms()
})

const orderRow = async (id: string) =>
  (await admin().from('orders').select('status').eq('id', id).single()).data!
const evidence = async (id: string) =>
  (
    await admin()
      .from('handover_evidence')
      .select('confirmation_channel, capture_method, rider_signature_png, signature_png')
      .eq('order_id', id)
  ).data!

/** React resets a form after every action, so the name and the tick are filled again before each try. */
const refill = async (page: Page) => {
  const main = page.locator('main')
  await main.getByLabel('Customer’s name').fill('Ada Student')
  const box = main.getByRole('checkbox')
  if (!(await box.isChecked())) await box.check()
}

async function arrived(
  browser: Parameters<typeof openSession>[0],
  info: Parameters<typeof openSession>[1],
  label: string,
) {
  const customer = await openSession(browser, info, `${label}c`)
  const ownerId = (await openSession(browser, info, `${label}o`)).user.id
  const shop = await makeShopWithPoint(ownerId, `Fixture dish ${tag()}`)
  const rider = await seedRider({ active: true })
  const o = await seedArrivedOrder(shop, customer.user.id, rider)
  const riderSession = await openSessionFor(browser, info, rider)
  return { customer, rider, riderSession, o, shop }
}

test('the rider hands over: the customer signs on the rider’s phone, then the rider signs; nobody else can finish it', async ({
  browser,
}, info) => {
  const { customer, riderSession, o } = await arrived(browser, info, 'dh')
  const r = riderSession.page
  const c = customer.page

  // the customer's own screen no longer asks them to confirm anything
  await c.goto(`/orders/${o.id}`)
  await expect(c.getByRole('heading', { name: /Your rider has arrived/ })).toBeVisible()
  await expect(c.getByRole('button', { name: /Confirm receipt|Confirm and sign/ })).toHaveCount(0)
  await a11yClean(c, '/orders/[id] (arrived)')

  // the rider's screen offers two ways, and nothing that marks the order delivered by itself
  await r.goto('/rider/jobs')
  const main = r.locator('main')
  await expect(
    main.getByRole('heading', { name: new RegExp(`hand over order ${o.number}`) }),
  ).toBeVisible()
  await expect(main.getByRole('button', { name: 'Confirm with QR code' })).toBeVisible()
  await main.getByRole('button', { name: 'Confirm with signatures' }).click()
  await expect(main.getByText('Signature for customer')).toBeVisible()
  await expect(main.getByText('Signature of rider')).toHaveCount(0)
  await a11yClean(r, '/rider/jobs (hand over)')

  // nothing signed: refused, nothing completes
  await main.getByLabel('Customer’s name').fill('Ada Student')
  await main.getByRole('checkbox').check()
  await clickAndWait(r, () => main.getByRole('button', { name: 'Confirm delivery' }).click())
  await expect(alertIn(r)).toContainText(/customer must sign/i)
  expect((await orderRow(o.id)).status).toBe('ARRIVAL_DETECTED')

  // the customer signs: only then does the rider's box appear
  await drawSignature(r, 0)
  await expect(main.getByText('Signature of rider')).toBeVisible()
  // the rider forgets to sign: refused
  await refill(r)
  await clickAndWait(r, () => main.getByRole('button', { name: 'Confirm delivery' }).click())
  await expect(alertIn(r)).toContainText(/second box/i)
  expect((await orderRow(o.id)).status).toBe('ARRIVAL_DETECTED')

  await drawSignature(r, 1)
  await refill(r)
  await clickAndWait(r, () => main.getByRole('button', { name: 'Confirm delivery' }).click())
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('COMPLETED')
  const ev = await evidence(o.id)
  expect(ev).toHaveLength(1)
  expect(ev[0]!.confirmation_channel).toBe('rider_phone')
  expect(ev[0]!.rider_signature_png).not.toBeNull()
  expect(ev[0]!.signature_png).not.toBeNull()
  const a = (
    await admin().from('delivery_assignments').select('status').eq('order_id', o.id).single()
  ).data!
  expect(a.status).toBe('completed')

  // receipt: the customer gets it, strangers and anonymous visitors do not
  await c.goto(`/orders/${o.id}`)
  await expect(c.getByRole('link', { name: 'Download receipt (PDF)' })).toBeVisible()
  const pdf = await c.request.get(`/orders/${o.id}/receipt`)
  expect(pdf.status()).toBe(200)
  const stranger = await openSession(browser, info, 'dhstr')
  expect((await stranger.page.request.get(`/orders/${o.id}/receipt`)).status()).toBe(404)
  const anon = await openAnonymous(browser, info)
  expect((await anon.page.request.get(`/orders/${o.id}/receipt`)).status()).toBe(401)
  // the finished job leaves the rider's list
  await r.goto('/rider/jobs')
  await expect(r.locator('main').getByText(o.number)).toHaveCount(0)
  await Promise.all([
    customer.context.close(),
    riderSession.context.close(),
    stranger.context.close(),
    anon.context.close(),
  ])
})

/** A white picture with one big dark loop: a signature that looks nothing like the zigzag drawn in these tests. */
const loopPng = () => {
  const W = 400
  const H = 160
  const png = new PNG({ width: W, height: H })
  png.data.fill(255)
  for (let t = 0; t < 360; t++) {
    const x = 200 + 160 * Math.cos((t * Math.PI) / 180)
    const y = 80 + 60 * Math.sin((t * Math.PI) / 180)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const i = (Math.round(y + dy) * W + Math.round(x + dx)) * 4
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 17
        png.data[i + 3] = 255
      }
  }
  return PNG.sync.write(png)
}
const saveSignature = async (userId: string, png: Buffer) => {
  const { error } = await admin()
    .from('user_signatures')
    .upsert({ user_id: userId, png: '\\x' + png.toString('hex') })
  expect(error).toBeNull()
}

test('a customer signature that does not look like the one saved at sign-up is refused on the rider’s phone', async ({
  browser,
}, info) => {
  const { customer, riderSession, o } = await arrived(browser, info, 'dm')
  const r: Page = riderSession.page
  await saveSignature(customer.user.id, loopPng())
  await r.goto('/rider/jobs')
  const main = r.locator('main')
  await main.getByRole('button', { name: 'Confirm with signatures' }).click()
  await main.getByLabel('Customer’s name').fill('Ada Student')
  await drawSignature(r, 0)
  await drawSignature(r, 1)
  await main.getByRole('checkbox').check()
  await clickAndWait(r, () => main.getByRole('button', { name: 'Confirm delivery' }).click())
  await expect(alertIn(r)).toContainText(/does not look like the one you saved/)
  expect((await orderRow(o.id)).status).toBe('ARRIVAL_DETECTED')
  expect(await evidence(o.id)).toHaveLength(0)

  // a different rider cannot complete someone else's delivery, even with matching drawings
  const other = await seedRider({ active: true })
  const otherSession = await openSessionFor(browser, info, other)
  await otherSession.page.goto('/rider/jobs')
  await expect(otherSession.page.locator('main').getByText(o.number)).toHaveCount(0)

  // when the saved signature is what is drawn, the delivery completes
  const drawn = await r.evaluate(() =>
    (document.querySelector('canvas') as HTMLCanvasElement).toDataURL('image/png'),
  )
  await saveSignature(customer.user.id, Buffer.from(drawn.split(',')[1]!, 'base64'))
  await refill(r)
  await clickAndWait(r, () => main.getByRole('button', { name: 'Confirm delivery' }).click())
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('COMPLETED')
  await otherSession.context.close()
})

test('the rider shows a QR code; the customer scans it signed in and confirms; wrong or expired codes do nothing', async ({
  browser,
}, info) => {
  const { customer, riderSession, o } = await arrived(browser, info, 'dq')
  const r = riderSession.page
  const c = customer.page
  await r.goto('/rider/jobs')
  const main = r.locator('main')
  await main.getByRole('button', { name: 'Confirm with QR code' }).click()
  const img = main.getByRole('img', {
    name: new RegExp(`QR code to confirm delivery of order ${o.number}`),
  })
  await expect(img).toBeVisible()
  const url = (await img.getAttribute('data-confirm-url'))!
  expect(url).toMatch(/\/confirm\/[0-9a-f-]{36}\.[0-9A-F]{20}$/)
  const path = new URL(url).pathname

  // a wrong code is refused and counted
  const wrong = path.replace(/\.[0-9A-F]{20}$/, '.AAAAAAAAAAAAAAAAAAAA')
  await c.goto(wrong)
  await c.getByRole('checkbox').check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Yes, I received my order' }).click())
  await expect(alertIn(c)).toContainText(/not valid/i)
  expect((await orderRow(o.id)).status).toBe('ARRIVAL_DETECTED')

  // another customer cannot use it
  const stranger = await openSession(browser, info, 'dqs')
  await stranger.page.goto(path)
  await expect(stranger.page.getByText(/could not find that order/i)).toBeVisible()

  // the right code confirms
  await c.goto(path)
  await a11yClean(c, '/confirm/[code]')
  await c.getByRole('checkbox').check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Yes, I received my order' }).click())
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('COMPLETED')
  const ev = await evidence(o.id)
  expect(ev[0]!.confirmation_channel).toBe('qr')
  expect(ev[0]!.capture_method).toBe('qr')
  // a used code cannot be used twice
  await c.goto(path)
  await expect(c.getByText(/Nothing to confirm right now/)).toBeVisible()
  await Promise.all([
    customer.context.close(),
    riderSession.context.close(),
    stranger.context.close(),
  ])
})

test('an expired QR code cannot be used', async ({ browser }, info) => {
  const { customer, riderSession, o } = await arrived(browser, info, 'de')
  const r = riderSession.page
  await r.goto('/rider/jobs')
  const main = r.locator('main')
  await main.getByRole('button', { name: 'Confirm with QR code' }).click()
  const img = main.getByRole('img', { name: /QR code to confirm delivery/ })
  await expect(img).toBeVisible()
  const path = new URL((await img.getAttribute('data-confirm-url'))!).pathname
  await admin()
    .from('delivery_qr_codes')
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq('order_id', o.id)
  const c = customer.page
  await c.goto(path)
  await c.getByRole('checkbox').check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Yes, I received my order' }).click())
  await expect(alertIn(c)).toContainText(/expired/i)
  expect((await orderRow(o.id)).status).toBe('ARRIVAL_DETECTED')
  // asking for a new code works
  await main.getByRole('button', { name: 'New code' }).click()
  await expect(img).toBeVisible()
  await Promise.all([customer.context.close(), riderSession.context.close()])
})

test('support handles a recipient who never shows up: the parcel is released, a report opens, nothing is marked delivered', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'dcust3')
  const ownerId = (await openSession(browser, info, 'downer3')).user.id
  const shop = await makeShopWithPoint(ownerId, `Fixture dish ${tag()}`)
  const rider = await seedRider({ active: true })
  const o = await seedArrivedOrder(shop, customer.user.id, rider)
  await admin().from('rider_issues').insert({
    assignment_id: o.assignmentId,
    order_id: o.id,
    rider_id: rider.id,
    reason: 'recipient_unavailable',
    note: 'Waited ten minutes at the point',
  })
  const support = await openSession(browser, info, 'dsup', ['support_agent'])
  const s = support.page
  await s.goto('/admin/rider-issues')
  await a11yClean(s, '/admin/rider-issues')
  const card = s.locator('main').getByText(o.number).locator('xpath=ancestor::div[.//summary][1]')
  await card.getByText(/Handle a parcel that is on its way/).click()
  await card.getByLabel('What happened?').fill('Recipient never showed up at the delivery point')
  await clickAndWait(s, () =>
    card.getByRole('button', { name: 'Release parcel and open a report' }).click(),
  )
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('DISPUTED')
  expect(await evidence(o.id)).toHaveLength(0)
  const a = (
    await admin().from('delivery_assignments').select('status').eq('id', o.assignmentId).single()
  ).data!
  expect(a.status).toBe('released')
  const cases = (await admin().from('support_cases').select('case_no, status').eq('order_id', o.id))
    .data!
  expect(cases).toHaveLength(1)
  expect(cases[0]!.status).toBe('under_review')
  await customer.page.goto(`/orders/${o.id}`)
  await expect(customer.page.getByRole('heading', { name: /Your rider has arrived/ })).toHaveCount(
    0,
  )
  await Promise.all([customer.context.close(), support.context.close()])
})

test('the rider taps "I have arrived" and the hand-over opens straight away; GPS is not needed', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'tapc')
  const ownerId = (await openSession(browser, info, 'tapo')).user.id
  const shop = await makeShopWithPoint(ownerId, `Fixture dish ${tag()}`)
  const rider = await seedRider({ active: true })
  const o = await seedArrivedOrder(shop, customer.user.id, rider, { arrived: false })
  const r = (await openSessionFor(browser, info, rider)).page

  await r.goto('/rider/jobs')
  const main = r.locator('main')
  // on the way: one clear button, and no hand-over yet
  await expect(main.getByRole('button', { name: 'I have arrived' })).toBeVisible()
  await expect(
    main.getByRole('heading', { name: new RegExp(`hand over order ${o.number}`) }),
  ).toHaveCount(0)
  await a11yClean(r, '/rider/jobs (on the way)')

  await clickAndWait(r, () => main.getByRole('button', { name: 'I have arrived' }).click())
  // the hand-over is there, with the signature option first
  await expect(
    main.getByRole('heading', { name: new RegExp(`hand over order ${o.number}`) }),
  ).toBeVisible()
  await expect(main.getByRole('button', { name: 'Confirm with signatures' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'I have arrived' })).toHaveCount(0)
  expect((await orderRow(o.id)).status).toBe('ARRIVAL_DETECTED')
  const asg = (
    await admin()
      .from('delivery_assignments')
      .select('arrival_source')
      .eq('id', o.assignmentId)
      .single()
  ).data!
  expect(asg.arrival_source).toBe('rider_tap')
})
