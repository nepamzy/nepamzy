import { expect, test } from '@playwright/test'
import {
  PASSWORD,
  admin,
  createUser,
  enrolFactorViaApi,
  openSession,
  randIp,
  uiMfaChallenge,
} from './helpers'

/**
 * One login, two modes. The mode cookie only chooses the interface; roles and the second step are checked on the server
 * every time, so editing the cookie (or the switch form) can never grant administrator access.
 */
test.describe.configure({ mode: 'serial' })

test('an administrator switches between Administrator and Customer mode; each switch is audited', async ({
  browser,
}, info) => {
  const s = await openSession(browser, info, 'mode-admin', ['platform_admin'])
  const page = s.page

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin$/)

  // the switch lives on the mode page everywhere (and in the sidebar on desktop)
  await page.goto('/account/mode')
  await expect(page.locator('[data-mode-indicator]:visible').first()).toContainText(
    'Administrator mode',
  )
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.locator('#main').getByRole('button', { name: 'Customer', exact: true }).click(),
  ])
  await expect(page.locator('#main').getByText('Mode: Customer')).toBeVisible()

  // Customer mode: staff areas are closed, the marketplace works as for any customer
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/account\/mode\?next=%2Fadmin/)
  await page.goto('/orders')
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible()
  await page.goto('/cart')
  await expect(page).toHaveURL(/\/cart$/)
  await expect(page.locator('[data-mode-indicator]:visible').first()).toContainText('Customer mode')

  // back to Administrator mode
  await page.goto('/account/mode')
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.locator('#main').getByRole('button', { name: 'Administrator', exact: true }).click(),
  ])
  await expect(page).toHaveURL(/\/admin$/)

  const { data } = await admin()
    .from('audit_events')
    .select('action, details')
    .eq('actor_id', s.user.id)
    .eq('action', 'auth.mode_switched')
    .order('occurred_at')
  expect(data?.map((e) => (e.details as { to: string }).to)).toEqual(['customer', 'admin'])
  await s.context.close()
})

test('the mode cookie cannot grant access: a customer who forges it still gets 403 on /admin', async ({
  browser,
}, info) => {
  const s = await openSession(browser, info, 'mode-forger')
  await s.context.addCookies([{ name: 'afit_mode', value: 'admin', url: 'http://127.0.0.1:3000' }])
  const res = await s.page.goto('/admin')
  expect(res?.status()).toBe(403)
  await s.page.goto('/account/mode')
  await expect(s.page.getByText('Customer mode only')).toBeVisible()
  await expect(s.page.getByRole('button', { name: 'Administrator', exact: true })).toHaveCount(0)
  await s.context.close()
})

test('a vendor who is not staff gets no switch and no administrator access', async ({
  browser,
}, info) => {
  const s = await openSession(browser, info, 'mode-vendor', ['vendor_owner'])
  await s.page.goto('/account/mode')
  await expect(s.page.getByText('Customer mode only')).toBeVisible()
  const res = await s.page.goto('/admin')
  expect(res?.status()).toBe(403)
  await s.context.close()
})

test('the sign-in choice picks the interface for accounts with administrator access', async ({
  browser,
}, info) => {
  const u = await createUser('mode-login', ['platform_admin'])
  const { secret } = await enrolFactorViaApi(u.email)
  for (const [choice, landing] of [
    ['Administrator', /\/admin$/],
    ['Customer', /^http:\/\/127\.0\.0\.1:3000\/$/],
  ] as const) {
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? undefined,
      extraHTTPHeaders: { 'x-forwarded-for': randIp() },
    })
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Email').fill(u.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByLabel(choice, { exact: true }).check()
    await page.getByRole('button', { name: 'Sign in' }).click()
    await uiMfaChallenge(page, secret)
    await expect(page).toHaveURL(landing)
    await context.close()
  }
})
