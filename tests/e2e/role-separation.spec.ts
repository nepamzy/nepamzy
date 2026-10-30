import { expect, test } from '@playwright/test'
import { admin, createUser, uiSignIn, userIdByEmail } from './helpers'

test.use({
  extraHTTPHeaders: {
    'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})

/** Shopping screens that a shop or a rider must never see. */
const CUSTOMER_ONLY = [
  '/cart',
  '/orders',
  '/checkout',
  '/apply',
  '/rider-apply',
  '/account/wishlist',
  '/account/addresses',
  '/account/receipts',
]

for (const [role, home, chip] of [
  ['vendor_owner', '/vendor', 'Shop'],
  ['rider', '/rider', 'Rider'],
] as const) {
  test.describe(`${role}: lives only in its own area`, () => {
    test('signs in to its own home, and every shopping screen sends it back there', async ({
      page,
    }) => {
      const u = await createUser(role, [role])
      await uiSignIn(page, u.email)
      await expect(page).toHaveURL(new RegExp(`${home}$`))
      await expect(page.getByTestId('area-chip')).toContainText(chip)
      for (const p of CUSTOMER_ONLY) {
        await page.goto(p)
        await expect(page, p).toHaveURL(new RegExp(`${home}$`))
      }
    })

    test('account and settings open inside its own frame, without customer tiles', async ({
      page,
    }) => {
      const u = await createUser(role, [role])
      await uiSignIn(page, u.email)
      await page.goto('/account')
      await expect(page.getByTestId('area-chip')).toContainText(chip)
      await expect(page.getByRole('heading', { name: /account/i }).first()).toBeVisible()
      for (const customerTile of ['Wishlist', 'Saved places', 'Delivery fee receipts']) {
        await expect(page.getByText(customerTile, { exact: true })).toHaveCount(0)
      }
      // no cart in the frame
      await expect(page.getByRole('link', { name: /^Cart/ })).toHaveCount(0)
      await page.goto('/account/security')
      await expect(page.getByTestId('area-chip')).toContainText(chip)
    })
  })
}

test('a plain customer keeps the customer frame and cannot open shop or rider areas', async ({
  page,
}) => {
  const u = await createUser('customer')
  await uiSignIn(page, u.email)
  await page.goto('/account')
  await expect(page.getByTestId('area-chip')).toHaveCount(0)
  await expect(page.getByText('Wishlist', { exact: true }).first()).toBeVisible()
  for (const p of ['/vendor', '/rider', '/vendor/earnings', '/rider/payments']) {
    expect((await page.goto(p))?.status(), p).toBe(403)
  }
})

test('one e-mail cannot hold both a shop and a rider role', async () => {
  const shop = await createUser('shopper', ['vendor_owner'])
  const a = admin()
  const id = await userIdByEmail(shop.email)
  const { error } = await a.from('role_assignments').insert({ user_id: id, role: 'rider' })
  expect(error?.message).toMatch(/one_business_role/)
  const rider = await createUser('driver', ['rider'])
  const rid = await userIdByEmail(rider.email)
  const { error: e2 } = await a
    .from('role_assignments')
    .insert({ user_id: rid, role: 'vendor_owner' })
  expect(e2?.message).toMatch(/one_business_role/)
})

test('every shop page can be reached by clicking, on desktop and on a phone', async ({
  page,
  isMobile,
}) => {
  const v = await createUser('nav-vendor', ['vendor_owner'])
  await uiSignIn(page, v.email)
  const labels = [
    'Orders',
    'Catalogue',
    'Handover',
    'Returns',
    'Earnings',
    'Shop',
    'Reviews',
    'Help',
  ]
  for (const label of labels) {
    await page.goto('/vendor')
    if (isMobile) {
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'More' })
        .click()
      await expect(page).toHaveURL(/\/vendor\/menu/)
      await page.getByRole('main').getByRole('link', { name: label, exact: true }).first().click()
    } else {
      await page
        .getByRole('navigation', { name: 'Main' })
        .first()
        .getByRole('link', { name: label, exact: true })
        .click()
    }
    await expect(page, label).toHaveURL(/\/vendor\/.+/)
  }
})

test('every rider page can be reached by clicking from the rider home', async ({
  page,
  isMobile,
}) => {
  const r = await createUser('nav-rider', ['rider'])
  await uiSignIn(page, r.email)
  for (const [label, path] of [
    ['Jobs', '/rider/jobs'],
    ['History', '/rider/history'],
    ['Payments', '/rider/payments'],
    ['Profile', '/rider/profile'],
  ] as const) {
    await page.goto('/rider')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await (isMobile ? nav.last() : nav.first())
      .getByRole('link', { name: label, exact: true })
      .click()
    await expect(page, label).toHaveURL(new RegExp(`${path}$`))
  }
})
