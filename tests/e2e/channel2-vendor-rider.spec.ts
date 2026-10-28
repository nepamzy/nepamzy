import { expect, test } from '@playwright/test'
import {
  a11yClean,
  createUser,
  makeShopWithPoint,
  openSession,
  openSessionFor,
  restorePlaceholderTerms,
  seedPaidCompletedOrder,
  seedRider,
  tag,
} from './helpers'

/**
 * Master channel 2: the redesigned vendor and rider areas show REAL data, keep their role gates, and say only what is true
 * about rider commission. The mode cookie / forged client state can never reach another role's area.
 */
test.describe.configure({ mode: 'serial' })

// seedRider installs the approved-terms test fixture globally; put the shipped placeholder back for the specs that follow
test.afterAll(async () => {
  await restorePlaceholderTerms()
})

test('vendor area: every page renders for the shop owner with real figures, no serious a11y issues, no horizontal scroll', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  const owner = await openSession(browser, info, 'c2-owner', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.user.id, `C2 dish ${tag()}`)
  const customer = await createUser('c2-cust')
  await seedPaidCompletedOrder(shop, customer.id)
  const p = owner.page

  await p.goto('/vendor')
  await expect(p.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(p.getByText('Orders today')).toBeVisible()
  await expect(p.getByText('Calculated amount due')).toBeVisible()
  await expect(p.getByRole('heading', { name: 'Needs attention' })).toBeVisible()
  await expect(p.getByRole('heading', { name: 'Recent orders' })).toBeVisible()
  // the paid fixture order really appears (data comes from the database, not from the page)
  await expect(p.getByTestId('paid-count').first()).toBeVisible()
  await a11yClean(p, '/vendor')

  for (const path of [
    '/vendor/orders',
    '/vendor/catalogue',
    '/vendor/catalogue/new',
    '/vendor/earnings',
    '/vendor/reviews',
    '/vendor/help',
    '/vendor/profile',
    '/vendor/handover',
    '/vendor/returns',
  ]) {
    const res = await p.goto(path)
    expect(res?.status(), path).toBe(200)
    await expect(p.getByRole('heading', { level: 1 }), path).toBeVisible()
    await a11yClean(p, path)
  }
  // honest about what does not exist
  await p.goto('/vendor/catalogue')
  await expect(p.getByText(/file storage has not been set up/i).first()).toBeVisible()
  await p.goto('/vendor/earnings')
  await expect(p.getByText('Nothing has been paid out')).toBeVisible()
  await owner.context.close()
})

test('roles stay separate: customers, riders and vendors cannot open each other’s areas, and an expired session is sent to sign in', async ({
  browser,
}, info) => {
  const cust = await openSession(browser, info, 'c2-plain')
  for (const path of [
    '/vendor',
    '/vendor/reviews',
    '/vendor/help',
    '/vendor/earnings',
    '/rider',
    '/rider/payments',
  ]) {
    const res = await cust.page.goto(path)
    expect(res?.status(), `customer on ${path}`).toBe(403)
  }
  const rider = await seedRider()
  const rs = await openSessionFor(browser, info, rider)
  for (const path of ['/vendor', '/vendor/reviews', '/admin', '/admin/users'])
    expect((await rs.page.goto(path))?.status(), `rider on ${path}`).toBe(403)
  const owner = await openSession(browser, info, 'c2-vonly', ['vendor_owner'])
  for (const path of ['/rider', '/rider/jobs', '/rider/payments', '/admin'])
    expect((await owner.page.goto(path))?.status(), `vendor on ${path}`).toBe(403)

  // forged client state: the mode cookie only ever REDUCES access and has no vendor/rider value at all
  await cust.context.addCookies([
    { name: 'afit_mode', value: 'vendor', url: 'http://127.0.0.1:3000' },
  ])
  expect((await cust.page.goto('/vendor'))?.status()).toBe(403)
  await cust.context.addCookies([
    { name: 'afit_mode', value: 'admin', url: 'http://127.0.0.1:3000' },
  ])
  expect((await cust.page.goto('/vendor/orders'))?.status()).toBe(403)

  // expired / missing session
  await owner.context.clearCookies()
  await owner.page.goto('/vendor/orders')
  await expect(owner.page).toHaveURL(/\/login/)
  await rs.context.close()
  await cust.context.close()
  await owner.context.close()
})

test('an administrator in Customer mode gets no vendor or rider access from the switch', async ({
  browser,
}, info) => {
  const adm = await openSession(browser, info, 'c2-adm', ['platform_admin'])
  await adm.page.goto('/account/mode')
  await Promise.all([
    adm.page.waitForResponse((r) => r.request().method() === 'POST'),
    adm.page.locator('#main').getByRole('button', { name: 'Customer', exact: true }).click(),
  ])
  await expect(adm.page.locator('#main').getByText('Mode: Customer')).toBeVisible()
  // staff area: closed behind the mode page (no administrator content is served)
  await adm.page.goto('/admin/users')
  await expect(adm.page).toHaveURL(/\/account\/mode\?next=/)
  await expect(adm.page.getByRole('heading', { name: 'Users' })).toHaveCount(0)
  // vendor and rider areas: the account holds neither role, so the switch grants nothing
  for (const path of ['/vendor', '/vendor/earnings', '/rider', '/rider/payments'])
    expect((await adm.page.goto(path))?.status(), path).toBe(403)
  await adm.context.close()
})

test('rider area: the commission-free notice is shown on every rider page and promises nothing about the future', async ({
  browser,
}, info) => {
  const rider = await seedRider()
  const rs = await openSessionFor(browser, info, rider)
  for (const path of ['/rider', '/rider/payments', '/rider/profile']) {
    await rs.page.goto(path)
    await expect(rs.page.getByText('Rider earnings: Free of charge.'), path).toBeVisible()
    await expect(rs.page.getByText('Delivery commission features: Coming Soon'), path).toBeVisible()
    await expect(rs.page.getByText(/under the current arrangement/i), path).toBeVisible()
    await expect(rs.page.getByText(/forever|always free|permanently free/i), path).toHaveCount(0)
    await a11yClean(rs.page, path)
  }
  await rs.page.goto('/rider/jobs')
  await expect(rs.page.getByRole('heading', { level: 1 })).toBeVisible()
  await rs.context.close()
})
