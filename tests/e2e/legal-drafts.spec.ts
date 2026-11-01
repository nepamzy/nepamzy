import { expect, test } from '@playwright/test'
import { a11yClean, openSession, openAnonymous } from './helpers'

test('legal drafts are readable by the administrator and closed to everyone else', async ({
  browser,
}, info) => {
  const adm = await openSession(browser, info, 'legal-adm', ['platform_admin'])
  await adm.page.goto('/admin/legal-drafts')
  await expect(adm.page.getByRole('heading', { name: 'Legal drafts', level: 1 })).toBeVisible()
  await a11yClean(adm.page, '/admin/legal-drafts')
  await adm.page
    .getByRole('link', { name: /Privacy Policy/ })
    .first()
    .click()
  await expect(adm.page.getByText('DRAFT, not approved for publication.')).toBeVisible()
  await expect(adm.page.getByText('Delivery signature image')).toBeVisible()
  await a11yClean(adm.page, 'a privacy draft')
  await adm.page.goto('/admin/legal-drafts/where-legal-text-is-needed')
  await expect(adm.page.getByRole('cell', { name: 'Vendor payout account' })).toBeVisible()
  expect((await adm.page.goto('/admin/legal-drafts/nope'))?.status()).toBe(404)

  const anon = await openAnonymous(browser, info)
  await anon.page.goto('/admin/legal-drafts')
  await expect(anon.page).toHaveURL(/\/login/)
  await adm.context.close()
  await anon.context.close()
})
