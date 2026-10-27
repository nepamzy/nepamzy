import { expect, test } from '@playwright/test'
import {
  a11yClean,
  admin,
  alertIn,
  clickAndWait,
  countGeolocationCalls,
  fixPricing,
  geoCalls,
  installApprovedTermsFixture,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  openSessionFor,
  restorePlaceholderTerms,
  seedOfferOrders,
  seedRider,
  statusIn,
  tag,
} from './helpers'

test.describe.configure({ mode: 'serial' })

// A8/K48: the shipped terms are a placeholder. Tests that need an approved version install a synthetic fixture and always
// put the placeholder back.
test.afterEach(async () => {
  await restorePlaceholderTerms()
})

/** Chromium only emits a position event when the emulated position CHANGES, so nudge it first. */
async function moveTo(
  context: import('@playwright/test').BrowserContext,
  pos: { latitude: number; longitude: number; accuracy: number },
) {
  await context.setGeolocation({ ...pos, latitude: pos.latitude + 0.00002 })
  await new Promise((r) => setTimeout(r, 1200))
  await context.setGeolocation(pos)
}

const FAR = { latitude: 0.0, longitude: 0.0, accuracy: 10 } // SYNTHETIC (open sea), not AFIT
const INSIDE = { latitude: 0.0103, longitude: 0.01, accuracy: 10 } // ~33 m from the synthetic delivery point (radius 60 m)

test('rider journey: apply -> approve -> terms -> Go Active -> accept -> handover -> en route -> live tracking -> geofence arrival', async ({
  browser,
}, info) => {
  test.setTimeout(420000)
  await fixPricing(50000)
  const productName = `Rice ${tag()}`
  const vendor = await openSession(browser, info, 'rv', ['vendor_owner'])
  const shop = await makeShopWithPoint(vendor.user.id, productName)
  const customer = await openSession(browser, info, 'rc')
  const c = customer.page

  // ---- customer orders for DELIVERY to the synthetic point and pays (test payment, local only) ----
  await c.goto(`/vendors/${shop.slug}`)
  await c.getByRole('link', { name: productName }).first().click()
  await c.getByRole('button', { name: 'Add to cart' }).click()
  await expect(c).toHaveURL(/\/cart$/)
  await c.goto('/checkout')
  await c.getByRole('radio', { name: /Delivery/ }).check()
  await c.getByLabel('Delivery point', { exact: true }).selectOption({ label: shop.pointLabel })
  await clickAndWait(c, () => c.getByRole('button', { name: 'Place order' }).click())
  await expect(c).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  const orderId = c.url().split('/').pop()!
  await c.getByRole('button', { name: /Pay \(test/ }).click()
  await expect(c.getByText('Payment received', { exact: true }).first()).toBeVisible()
  const order = (await admin().from('orders').select('order_number').eq('id', orderId).single())
    .data!
  const status = async () =>
    (await admin().from('orders').select('status').eq('id', orderId).single()).data!
      .status as string

  // ---- vendor accepts, prepares, marks ready (delivery orders then go on offer) ----
  const v = vendor.page
  await v.goto('/vendor/orders')
  for (const [button, expected] of [
    ['Accept order', 'ACCEPTED'],
    ['Start preparing', 'PREPARING'],
    ['Mark ready', 'AWAITING_RIDER'],
  ] as const) {
    await clickAndWait(v, () => v.getByRole('button', { name: button }).click())
    await expect.poll(status).toBe(expected)
    await v.reload()
  }

  // ---- a customer applies to be a rider; an administrator approves ----
  const riderUser = await openSession(browser, info, 'rr')
  const r = riderUser.page
  const fullName = `Ride ${tag()} Person`
  await r.goto('/rider-apply')
  await a11yClean(r, '/rider-apply')
  await r.getByLabel('Full name').fill(fullName)
  await r.getByLabel('Contact phone').fill('08012345678')
  await r.getByRole('checkbox').check()
  await clickAndWait(r, () => r.getByRole('button', { name: 'Apply to deliver' }).click())
  await expect(r.getByText('Your application is waiting for review.')).toBeVisible()

  const adm = await openSession(browser, info, 'ra', ['platform_admin'])
  const a = adm.page
  await a.goto('/admin/riders')
  const card = a
    .getByText(fullName, { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="Approve"]][1]')
  await clickAndWait(a, () => card.getByRole('button', { name: 'Approve' }).click())
  await expect
    .poll(
      async () =>
        (await admin().from('rider_profiles').select('status').eq('user_id', riderUser.user.id))
          .data?.[0]?.status,
    )
    .toBe('approved')

  // ---- rider: nothing is collected before Go Active ----
  await countGeolocationCalls(riderUser.context)
  await riderUser.context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:3000' })
  await riderUser.context.setGeolocation(FAR)
  await r.goto('/rider')
  // placeholder terms (the shipped default): the database refuses, and the UI says why instead of offering Go Active
  await a11yClean(r, '/rider (terms awaiting approval)')
  await expect(r.getByText(/rider terms are still awaiting approval/)).toBeVisible()
  await expect(r.getByRole('button', { name: 'Go Active' })).toHaveCount(0)
  await expect(r.getByRole('button', { name: 'I accept the rider terms' })).toHaveCount(0)
  expect(await geoCalls(r)).toBe(0)
  await installApprovedTermsFixture()
  await r.goto('/rider')
  await a11yClean(r, '/rider (terms)')
  await expect(r.getByText('I accept the rider terms')).toBeVisible()
  await r.getByRole('checkbox').check()
  await clickAndWait(r, () => r.getByRole('button', { name: 'I accept the rider terms' }).click())
  await r.goto('/rider')
  await expect(r.getByRole('button', { name: 'Go Active' })).toBeVisible()
  await a11yClean(r, '/rider (off duty)')
  expect(await geoCalls(r)).toBe(0)
  await r.goto('/rider/jobs')
  await expect(r.getByText('You are off duty')).toBeVisible()
  expect(await geoCalls(r)).toBe(0)
  await r.goto('/rider')
  await clickAndWait(r, () => r.getByRole('button', { name: 'Go Active' }).click())
  await expect(r.getByRole('button', { name: /Go Inactive/ })).toBeVisible()
  await expect.poll(() => geoCalls(r)).toBeGreaterThan(0) // permission is requested right after Go Active

  // ---- rider accepts the offer ----
  await r.goto('/rider/jobs')
  const offer = r
    .getByText(order.order_number, { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="Accept delivery"]][1]')
  await expect(offer).toBeVisible()
  await a11yClean(r, '/rider/jobs (offers)')
  await clickAndWait(r, () => offer.getByRole('button', { name: 'Accept delivery' }).click())
  await expect.poll(status).toBe('RIDER_ASSIGNED')
  await r.reload()
  await expect(r.getByText('Location sharing is')).toBeVisible()

  // ---- vendor-to-rider handover token: wrong code refused, real one works once ----
  await r.getByRole('button', { name: 'Show handover code to vendor' }).click()
  const codeEl = r.locator('p.tracking-widest').first()
  await expect(codeEl).toBeVisible()
  const code = (await codeEl.innerText()).trim()
  expect(code).toMatch(/^[0-9A-F]{10}$/)
  await a11yClean(r, '/rider/jobs (token)')

  await v.goto('/vendor/handover')
  await expect(v.getByText('Assigned rider:')).toContainText(fullName)
  await v.getByLabel('Code shown on the rider’s phone').fill('WRONGCODE1')
  await clickAndWait(v, () => v.getByRole('button', { name: 'Hand parcel to rider' }).click())
  await expect(alertIn(v)).toContainText(/not right/)
  expect(await status()).toBe('RIDER_ASSIGNED')
  await a11yClean(v, '/vendor/handover (rider pickup)')
  await v.getByLabel('Code shown on the rider’s phone').fill(code.toLowerCase())
  await clickAndWait(v, () => v.getByRole('button', { name: 'Hand parcel to rider' }).click())
  await expect.poll(status).toBe('PICKED_UP_BY_RIDER')

  // ---- rider starts the route; reports a GPS problem (never an arrival) ----
  await r.goto('/rider/jobs')
  await clickAndWait(r, () => r.getByRole('button', { name: 'Start route' }).click())
  await expect.poll(status).toBe('EN_ROUTE')
  await r.reload()
  await r.getByText('Report a problem').click()
  await r.getByLabel('What is the problem?').selectOption('gps_issue')
  await clickAndWait(r, () => r.getByRole('button', { name: 'Send report' }).click())
  await expect(statusIn(r)).toContainText(/does not mark you as arrived/)
  expect(await status()).toBe('EN_ROUTE')
  const issues = await admin().from('rider_issues').select('reason').eq('order_id', orderId)
  expect(issues.data).toEqual([{ reason: 'gps_issue' }])

  // ---- live location flows to the server; the customer sees it ----
  await expect
    .poll(
      async () => {
        await moveTo(riderUser.context, FAR) // emulated positions can be missed on a slow runner: nudge again
        return r.getByText(/Last position sent at/).isVisible()
      },
      { timeout: 60000, intervals: [2000] },
    )
    .toBe(true)
  await expect(r.getByText('Location sharing is ON')).toBeVisible()
  await c.goto(`/orders/${orderId}`)
  await expect(c.getByRole('heading', { name: 'Delivery tracking' })).toBeVisible()
  await expect(c.getByText('SAMPLE MAP: synthetic data, not AFIT')).toBeVisible()
  await expect(c.getByText(/about \d+ min/)).toBeVisible()
  await expect(c.getByText(/SAMPLE route service|approximation/)).toBeVisible()
  await a11yClean(c, '/orders/[id] (tracking)')

  // privacy: other accounts cannot read this order's tracking
  const stranger = await openSession(browser, info, 'rs')
  expect((await stranger.page.request.get(`/api/orders/${orderId}/tracking`)).status()).toBe(404)
  expect((await v.request.get(`/api/orders/${orderId}/tracking`)).status()).toBe(404)
  expect((await r.request.get(`/api/orders/${orderId}/tracking`)).status()).toBe(404)
  const anon = await openAnonymous(browser, info)
  expect((await anon.page.request.get(`/api/orders/${orderId}/tracking`)).status()).toBe(401)
  await Promise.all([stranger.context.close(), anon.context.close()])

  // a stale position is labelled stale (the rider's page stops sending, as when a phone locks)
  await r.goto('/rider/profile')
  await admin()
    .from('rider_location_current')
    .update({ observed_at: new Date(Date.now() - 5 * 60_000).toISOString() })
    .eq('rider_id', riderUser.user.id)
  await c.reload()
  await expect(c.getByText(/out of date/).first()).toBeVisible()
  expect(await status()).toBe('EN_ROUTE')

  // ---- fresh, accurate fix inside the geofence: arrival is detected by the SERVER ----
  await r.goto('/rider/jobs')
  await expect
    .poll(
      async () => {
        await moveTo(riderUser.context, INSIDE)
        await r.waitForTimeout(1500)
        return status()
      },
      { timeout: 90000, intervals: [3000] },
    )
    .toBe('ARRIVAL_DETECTED')
  await c.reload()
  await expect(c.getByText(/reached your delivery point/)).toBeVisible({ timeout: 20000 })
  expect(await status()).not.toMatch(/DELIVERED|COMPLETED/)

  // ---- cannot go inactive while carrying a parcel ----
  await r.goto('/rider')
  await clickAndWait(r, () => r.getByRole('button', { name: /Go Inactive/ }).click())
  await expect(alertIn(r)).toContainText(/carrying a parcel/)
  const shifts = await admin()
    .from('rider_shifts')
    .select('id')
    .eq('rider_id', riderUser.user.id)
    .is('ended_at', null)
  expect(shifts.data).toHaveLength(1)

  await Promise.all([
    vendor.context.close(),
    customer.context.close(),
    riderUser.context.close(),
    adm.context.close(),
  ])
})

test('capacity: the sixth delivery is refused with a clear message; denied location permission is handled; going inactive stops sharing', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  const vendor = await openSession(browser, info, 'rv2', ['vendor_owner'])
  const shop = await makeShopWithPoint(vendor.user.id, `Bun ${tag()}`)
  const cust = await openSession(browser, info, 'rc2')
  const fixture = await seedRider({ active: true })
  const orders = await seedOfferOrders(6, shop, cust.user.id)

  const rider = await openSessionFor(browser, info, fixture)
  await countGeolocationCalls(rider.context)
  const r = rider.page
  // Simulate the user refusing the browser's location prompt (headless Chromium has no prompt to answer).
  await rider.context.addInitScript(() => {
    navigator.geolocation.watchPosition = ((
      _ok: unknown,
      err?: (e: { code: number; message: string }) => void,
    ) => {
      setTimeout(() => err?.({ code: 1, message: 'User denied Geolocation' }), 50)
      return 1
    }) as typeof navigator.geolocation.watchPosition
  })
  // active but with no accepted delivery: location sharing stays OFF and nothing asks the browser for a position
  await r.goto('/rider/jobs')
  await expect(r.getByText('Location sharing is OFF')).toBeVisible()
  expect(await geoCalls(r)).toBe(0)

  // five accepted deliveries (inserted directly), the sixth offer remains
  const a = admin()
  for (let i = 0; i < 5; i++) {
    const { error } = await a.from('delivery_assignments').insert({
      order_id: orders[i]!.id,
      rider_id: rider.user.id,
      shift_id: fixture.shift,
      slot: i + 1,
    })
    if (error) throw error
    await a.from('orders').update({ status: 'RIDER_ASSIGNED' }).eq('id', orders[i]!.id)
  }
  await r.goto('/rider/jobs')
  await expect(r.getByText('5 of 5 active deliveries')).toBeVisible()
  await a11yClean(r, '/rider/jobs (five active)')
  const sixth = r
    .getByText(orders[5]!.order_number, { exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="Accept delivery"]][1]')
  await clickAndWait(r, () => sixth.getByRole('button', { name: 'Accept delivery' }).click())
  await expect(alertIn(r)).toContainText(/five active deliveries/)
  const active = await a.from('delivery_assignments').select('id').eq('rider_id', rider.user.id)
  expect(active.data).toHaveLength(5)

  // location permission was never granted in this context: the page says so, and nothing is stored
  await expect(r.getByText(/Location permission was denied/)).toBeVisible({ timeout: 20000 })
  const stored = await a
    .from('rider_location_current')
    .select('rider_id')
    .eq('rider_id', rider.user.id)
  expect(stored.data).toEqual([])

  // going inactive returns un-collected work to the pool and switches sharing off
  await r.goto('/rider')
  await clickAndWait(r, () => r.getByRole('button', { name: /Go Inactive/ }).click())
  await expect(r.getByRole('button', { name: 'Go Active' })).toBeVisible()
  const back = await a.from('orders').select('status').eq('id', orders[0]!.id).single()
  expect(back.data!.status).toBe('AWAITING_RIDER')
  await r.goto('/rider/jobs')
  await expect(r.getByText('You are off duty')).toBeVisible()
  await Promise.all([vendor.context.close(), cust.context.close(), rider.context.close()])
})

test('location is blocked by Permissions-Policy everywhere except the rider area', async ({
  request,
}) => {
  const policy = async (path: string) =>
    (await request.get(path, { maxRedirects: 0 })).headers()['permissions-policy']
  for (const p of [
    '/',
    '/vendors',
    '/login',
    '/orders',
    '/checkout',
    '/admin',
    '/riders-not-a-route',
  ])
    expect(await policy(p), p).toContain('geolocation=()')
  for (const p of ['/rider', '/rider/jobs', '/rider/profile'])
    expect(await policy(p), p).toContain('geolocation=(self)')
})

test('rider and admin pages reject the wrong accounts', async ({ browser }, info) => {
  const cust = await openSession(browser, info, 'nr')
  for (const p of ['/rider', '/rider/jobs', '/admin/riders', '/admin/rider-issues']) {
    expect((await cust.page.goto(p))?.status(), p).toBe(403)
  }
  await a11yClean(
    await (async () => {
      await cust.page.goto('/rider-apply')
      return cust.page
    })(),
    '/rider-apply',
  )
  const support = await openSession(browser, info, 'sup', ['support_agent'])
  expect((await support.page.goto('/admin/rider-issues'))?.status()).toBe(200)
  expect((await support.page.goto('/admin/riders'))?.status()).toBe(403)
  await a11yClean(support.page, '/admin/rider-issues')
  await Promise.all([cust.context.close(), support.context.close()])
})
