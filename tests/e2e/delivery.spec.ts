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

const draw = (page: Page) => drawSignature(page)
const orderRow = async (id: string) =>
  (await admin().from('orders').select('status').eq('id', id).single()).data!
const evidenceCount = async (id: string) =>
  (await admin().from('handover_evidence').select('order_id').eq('order_id', id)).data!.length

test('recipient confirms receipt: summary, signature, one completion; the rider has no completion control; the slot is freed', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'dcust')
  const ownerId = (await openSession(browser, info, 'downer')).user.id
  const shop = await makeShopWithPoint(ownerId, `Fixture dish ${tag()}`)
  const rider = await seedRider({ active: true })
  const o = await seedArrivedOrder(shop, customer.user.id, rider)
  const c = customer.page

  // ---- the rider's screen: no way to mark the order delivered ----
  const riderSession = await openSessionFor(browser, info, rider)
  await riderSession.page.goto('/rider/jobs')
  const rmain = riderSession.page.locator('main')
  await expect(rmain.getByText(o.number)).toBeVisible()
  await expect(rmain).toContainText(/Arrival detected/)
  await expect(rmain).toContainText(/cannot mark the order delivered/)
  // nothing in the rider's own deliveries lets them deliver, complete or confirm (other offers' Accept buttons are elsewhere)
  await expect(
    rmain
      .getByRole('region', { name: 'My deliveries' })
      .getByRole('button', { name: /deliver|complete|confirm/i }),
  ).toHaveCount(0)

  // ---- the recipient ----
  await c.goto(`/orders/${o.id}`)
  await expect(c.getByRole('heading', { name: /Your rider has arrived/ })).toBeVisible()
  await a11yClean(c, '/orders/[id] (arrived)')
  await expect(c.getByText('Cannot sign, or something is missing or wrong?')).toBeVisible()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm receipt' }).click())
  await expect(c.getByText('Jollof rice (fixture)').last()).toBeVisible()
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('AWAITING_RECIPIENT_PROOF')
  await a11yClean(c, '/orders/[id] (signing)')

  // empty signature is refused with a clear message, and nothing completes
  await c.getByLabel('Your name (the person receiving the order)').fill('Ada Student')
  await c.getByRole('checkbox').check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm and sign' }).click())
  await expect(alertIn(c)).toContainText(/sign in the box/i)
  expect((await orderRow(o.id)).status).toBe('AWAITING_RECIPIENT_PROOF')
  expect(await evidenceCount(o.id)).toBe(0)

  // a lone dot is not a signature either
  const pad = c.locator('canvas')
  const box = (await pad.boundingBox())!
  await c.mouse.click(box.x + 30, box.y + 30)
  await c.getByLabel('Your name (the person receiving the order)').fill('Ada Student')
  await c.getByRole('checkbox').check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm and sign' }).click())
  await expect(alertIn(c)).toContainText(/sign in the box|looks empty/i)
  expect(await evidenceCount(o.id)).toBe(0)

  // a real signature; a double click must not complete twice
  await draw(c)
  await c.getByLabel('Your name (the person receiving the order)').fill('Ada Student')
  await c.getByRole('checkbox').check()
  await c.getByRole('button', { name: 'Confirm and sign' }).dblclick()
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('COMPLETED')
  await expect(c.getByRole('heading', { name: /Your rider has arrived/ })).toHaveCount(0)
  expect(await evidenceCount(o.id)).toBe(1)
  const a = (
    await admin().from('delivery_assignments').select('status').eq('id', o.assignmentId).single()
  ).data!
  expect(a.status).toBe('completed')
  const hist = (
    await admin().from('order_status_history').select('to_status').eq('order_id', o.id).order('id')
  ).data!.map((h) => h.to_status)
  expect(hist.filter((s) => s === 'COMPLETED')).toHaveLength(1)

  // receipt shows the delivery proof; strangers and anonymous visitors cannot get it
  await c.goto(`/orders/${o.id}`)
  await expect(c.getByRole('link', { name: 'Download receipt (PDF)' })).toBeVisible()
  const pdf = await c.request.get(`/orders/${o.id}/receipt`)
  expect(pdf.status()).toBe(200)
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
  const stranger = await openSession(browser, info, 'dstranger')
  expect((await stranger.page.request.get(`/orders/${o.id}/receipt`)).status()).toBe(404)
  const anon = await openAnonymous(browser, info)
  expect((await anon.page.request.get(`/orders/${o.id}/receipt`)).status()).toBe(401)

  // the rider's list no longer shows the finished delivery
  await riderSession.page.goto('/rider/jobs')
  await expect(riderSession.page.locator('main').getByText(o.number)).toHaveCount(0)
  await Promise.all([
    customer.context.close(),
    riderSession.context.close(),
    stranger.context.close(),
    anon.context.close(),
  ])
})

test('an expired or restarted confirmation cannot be used; the screen explains what to do', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'dcust2')
  const ownerId = (await openSession(browser, info, 'downer2')).user.id
  const shop = await makeShopWithPoint(ownerId, `Fixture dish ${tag()}`)
  const rider = await seedRider({ active: true })
  const o = await seedArrivedOrder(shop, customer.user.id, rider)
  const c = customer.page
  await c.goto(`/orders/${o.id}`)
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm receipt' }).click())
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('AWAITING_RECIPIENT_PROOF')
  // the session times out while the page is open
  await admin()
    .from('delivery_proof_sessions')
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq('order_id', o.id)
  await draw(c)
  await c.getByLabel('Your name (the person receiving the order)').fill('Ada Student')
  await c.getByRole('checkbox').check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm and sign' }).click())
  await expect(alertIn(c)).toContainText(/timed out/i)
  expect((await orderRow(o.id)).status).toBe('AWAITING_RECIPIENT_PROOF')
  expect(await evidenceCount(o.id)).toBe(0)
  // reloading offers a fresh start; the new session works
  await c.reload()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm receipt' }).click())
  await draw(c)
  await c.getByLabel('Your name (the person receiving the order)').fill('Ada Student')
  await c.getByRole('checkbox').check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm and sign' }).click())
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('COMPLETED')
  await customer.context.close()
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
  expect(await evidenceCount(o.id)).toBe(0)
  const a = (
    await admin().from('delivery_assignments').select('status').eq('id', o.assignmentId).single()
  ).data!
  expect(a.status).toBe('released')
  const cases = (await admin().from('support_cases').select('case_no, status').eq('order_id', o.id))
    .data!
  expect(cases).toHaveLength(1)
  expect(cases[0]!.status).toBe('under_review')
  // the customer can see the report, and the old confirmation screen no longer offers a confirmation
  await customer.page.goto(`/orders/${o.id}`)
  await expect(customer.page.getByRole('heading', { name: /Your rider has arrived/ })).toHaveCount(
    0,
  )
  await Promise.all([customer.context.close(), support.context.close()])
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

test('a signature that does not look like the one saved at sign-up is refused, and one that does look like it completes the delivery', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'sigcust')
  const ownerId = (await openSession(browser, info, 'sigowner')).user.id
  const shop = await makeShopWithPoint(ownerId, `Signature dish ${tag()}`)
  const rider = await seedRider({ active: true })
  const o = await seedArrivedOrder(shop, customer.user.id, rider)
  const c = customer.page
  await saveSignature(customer.user.id, loopPng())

  await c.goto(`/orders/${o.id}`)
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm receipt' }).click())
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('AWAITING_RECIPIENT_PROOF')
  const fill = async () => {
    await c.getByLabel('Your name (the person receiving the order)').fill('Ada Student')
    await c.getByRole('checkbox').check()
  }
  // a zigzag is nothing like the saved loop
  await fill()
  await draw(c)
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm and sign' }).click())
  await expect(alertIn(c)).toContainText(/does not look like the one you saved/)
  expect((await orderRow(o.id)).status).toBe('AWAITING_RECIPIENT_PROOF')

  // the saved signature is now what was drawn: signing the same way again completes the delivery
  const drawn = await c.evaluate(() =>
    (document.querySelector('canvas') as HTMLCanvasElement).toDataURL('image/png'),
  )
  await saveSignature(customer.user.id, Buffer.from(drawn.split(',')[1]!, 'base64'))
  await fill()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm and sign' }).click())
  await expect.poll(async () => (await orderRow(o.id)).status).toBe('COMPLETED')
})
