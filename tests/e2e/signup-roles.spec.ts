import { expect, test } from '@playwright/test'
import {
  PASSWORD,
  admin,
  createUser,
  enrolFactorViaApi,
  randIp,
  uiMfaChallenge,
  uiSignIn,
  uniqueEmail,
  userIdByEmail,
} from './helpers'

/**
 * Sign-up asks what the person wants to be (customer, vendor, rider) and routes vendors and riders to their application.
 * The choice never grants a role. The administrator option is not offered on the public pages; the administrator enters through
 * a hidden page reached by tapping the logo three times on the home page.
 */
test.describe.configure({ mode: 'serial' })

test('the public pages never mention the administrator, and sign-up offers customer, vendor and rider', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('Administrator')).toHaveCount(0)
  await expect(page.getByLabel('Administrator')).toHaveCount(0)
  await page.goto('/signup')
  await expect(page.getByText('Administrator')).toHaveCount(0)
  const group = page.getByRole('group', { name: 'I want to use AFIT Market as a' })
  await expect(group.getByRole('radio', { name: /Customer/ })).toBeChecked()
  await expect(group.getByRole('radio', { name: /Vendor/ })).not.toBeChecked()
  await expect(group.getByRole('radio', { name: /Rider/ })).not.toBeChecked()
})

test('signing up as a vendor or rider records the choice; a customer sign-up records none', async ({
  browser,
}, info) => {
  for (const [choice, expected] of [
    ['Vendor', 'vendor'],
    ['Rider', 'rider'],
    ['Customer', undefined],
  ] as const) {
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? undefined,
      extraHTTPHeaders: { 'x-forwarded-for': randIp() },
    })
    const page = await context.newPage()
    const email = uniqueEmail(`signup-${choice.toLowerCase()}`)
    await page.goto('/signup')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('radio', { name: new RegExp(choice) }).check()
    await page.getByLabel(/I confirm that I am 18/).check()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText(/Check your email/)).toBeVisible()
    if (expected) await expect(page.getByText(new RegExp(`${expected} application`))).toBeVisible()
    const id = await userIdByEmail(email)
    const { data: found } = await admin().auth.admin.getUserById(id)
    expect(found.user?.user_metadata?.intended_role).toBe(expected)
    // the choice grants nothing: no role beyond the customer role exists for this account
    const { data: roles } = await admin().from('role_assignments').select('role').eq('user_id', id)
    expect((roles ?? []).map((r) => r.role).filter((r) => r !== 'customer')).toEqual([])
    await context.close()
  }
})

test('after signing in, someone who chose vendor or rider lands on that application, and an ordinary customer on the home page', async ({
  browser,
}, info) => {
  for (const [intent, path] of [
    ['vendor', /\/apply$/],
    ['rider', /\/rider-apply$/],
    [undefined, /^http:\/\/127\.0\.0\.1:3000\/$/],
  ] as const) {
    const u = await createUser(`intent-${intent ?? 'customer'}`)
    if (intent)
      await admin().auth.admin.updateUserById(u.id, { user_metadata: { intended_role: intent } })
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? undefined,
      extraHTTPHeaders: { 'x-forwarded-for': randIp() },
    })
    const page = await context.newPage()
    await uiSignIn(page, u.email)
    await expect(page).toHaveURL(path)
    await context.close()
  }
})

test('three quick taps on the logo on the home page open the administrator sign-in; one tap does not; a non-administrator gets nothing extra', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  await page.goto('/')
  const logo = page.getByRole('link', { name: 'AFIT Market home' }).first()
  await logo.click()
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/)
  await logo.click({ clickCount: 3, delay: 60 })
  await expect(page).toHaveURL(/\/staff-login$/)
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible()

  // an ordinary customer who finds this page is signed in as a customer: it opens nothing
  const customer = await createUser('staff-door-customer')
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/staff-login'))
  const res = await page.goto('/admin')
  expect(res?.status()).toBe(403)
  await context.close()

  // an administrator signs in there and lands in the administrator interface
  const adm = await createUser('staff-door-admin', ['platform_admin'])
  const { secret } = await enrolFactorViaApi(adm.email)
  const ctx2 = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const p2 = await ctx2.newPage()
  await p2.goto('/staff-login')
  await p2.getByLabel('Email').fill(adm.email)
  await p2.getByLabel('Password').fill(PASSWORD)
  await p2.getByRole('button', { name: 'Sign in' }).click()
  await uiMfaChallenge(p2, secret)
  await expect(p2).toHaveURL(/\/admin$/)
  await ctx2.close()
})
