import { expect, test, type Page } from '@playwright/test'
import {
  a11yClean,
  admin,
  alertIn,
  clickAndWait,
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

const draw = async (page: Page) => {
  const pad = page.locator('canvas')
  await pad.scrollIntoViewIfNeeded()
  const box = (await pad.boundingBox())! // measured now: an error message above the pad moves it
  await page.mouse.move(box.x + 20, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 })
  await page.mouse.move(box.x + 60, box.y + 120, { steps: 8 })
  await page.mouse.move(box.x + 160, box.y + 60, { steps: 8 })
  await page.mouse.up()
}
const orderRow = async (id: string) =>
  (await admin().from('orders').select('status').eq('id', id).single()).data!
const evidenceCount = async (id: string) =>
  (await admin().from('handover_evidence').select('order_id').eq('order_id', id)).data!.length

test('recipient confirms receipt: summary, signature, one completion; the rider has no completion control; the slot is freed', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'dcust')
  const ownerId = (await openSession(browser, info, 'downer')).user.id
  const shop = await makeShopWithPoint(ownerId, `Rice ${tag()}`)
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
  await expect(
    riderSession.page.getByRole('button', { name: /deliver|complete|confirm/i }),
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
  const shop = await makeShopWithPoint(ownerId, `Rice ${tag()}`)
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
