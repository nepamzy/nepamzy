import { expect, test } from '@playwright/test'
import { a11yClean, openSession } from './helpers'

test('an administrator only ever sees the administration frame: no customer view, no switch, account and security inside the admin menu', async ({
  browser,
}, info) => {
  const s = await openSession(browser, info, 'admin-only', ['platform_admin'])
  const p = s.page
  const wide = (info.project.use.viewport?.width ?? 1280) >= 768
  for (const path of ['/admin', '/account', '/account/security', '/notifications']) {
    await p.goto(path)
    await expect(p.getByText(/Customer mode|Administrator mode|Mode:/i)).toHaveCount(0)
    await expect(p.getByRole('link', { name: /^Cart/ })).toHaveCount(0)
    await expect(p.getByRole('button', { name: 'Customer', exact: true })).toHaveCount(0)
    if (wide) {
      const side = p.locator('aside')
      await expect(side.getByRole('link', { name: 'Dashboard' })).toBeVisible()
      await expect(side.getByRole('link', { name: 'My account' })).toBeVisible()
      await expect(side.getByRole('link', { name: 'Security' })).toBeVisible()
    }
  }
  await p.goto('/account')
  await expect(p.getByRole('heading', { name: 'Administrator account', level: 1 })).toBeVisible()
  await expect(p.getByRole('link', { name: /Overview/ }).first()).toBeVisible()
  await expect(p.getByText('Wishlist')).toHaveCount(0)
  await a11yClean(p, '/account as admin')
  // the account menu at the top holds Overview, My account and Security
  await p.locator('summary[aria-label="Account menu"]').click()
  await expect(p.getByRole('link', { name: 'Overview' }).last()).toBeVisible()
  await expect(p.getByRole('link', { name: 'Security' }).last()).toBeVisible()
  // the old switch page is gone
  expect((await p.goto('/account/mode'))?.status()).toBe(404)
  await s.context.close()
})
