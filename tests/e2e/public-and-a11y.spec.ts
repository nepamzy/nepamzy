import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createUser, enrolFactorViaApi, uiSignInWithMfa } from './helpers'

test.use({
  extraHTTPHeaders: {
    'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})

async function expectNoSeriousA11yIssues(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    `axe on ${label}`,
  ).toEqual([])
}
async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `horizontal overflow on ${label}`).toBeLessThanOrEqual(0)
}

const PUBLIC = ['/', '/vendors', '/vendors/v1', '/login', '/signup', '/design', '/offline']

test.describe('public pages', () => {
  for (const path of PUBLIC) {
    test(`${path}: renders, no serious a11y issues, no horizontal scroll`, async ({ page }) => {
      const res = await page.goto(path)
      expect(res?.status()).toBe(200)
      await expect(page.getByRole('main')).toBeVisible()
      await expectNoSeriousA11yIssues(page, path)
      await expectNoHorizontalScroll(page, path)
    })
  }
  test('browsing needs no account and shows prices in naira', async ({ page }) => {
    await page.goto('/vendors/v1')
    await expect(page.getByText('₦2,500')).toBeVisible()
    await expect(page).not.toHaveURL(/login/)
  })
  test('unknown vendor gives a friendly 404', async ({ page }) => {
    const res = await page.goto('/vendors/nope')
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: /can.t find that page/i })).toBeVisible()
  })
})

test.describe('platform basics', () => {
  test('security headers and a per-request CSP nonce are set', async ({ request }) => {
    const a = await request.get('/')
    const b = await request.get('/')
    const cspA = a.headers()['content-security-policy']!
    const cspB = b.headers()['content-security-policy']!
    expect(cspA).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/)
    expect(cspA).toContain("frame-ancestors 'none'")
    expect(cspA).toContain("object-src 'none'")
    expect(cspA.match(/nonce-([^']+)/)![1]).not.toBe(cspB.match(/nonce-([^']+)/)![1])
    expect(a.headers()['x-frame-options']).toBe('DENY')
    expect(a.headers()['x-content-type-options']).toBe('nosniff')
    expect(a.headers()['x-powered-by']).toBeUndefined()
  })
  test('PWA: manifest, icon, service worker and offline page are served', async ({ request }) => {
    const m = await request.get('/manifest.webmanifest')
    expect(m.status()).toBe(200)
    expect((await m.json()).name).toBe('AFIT Market')
    expect((await request.get('/icons/icon.svg')).status()).toBe(200)
    expect((await request.get('/sw.js')).status()).toBe(200)
  })
  test('service worker serves the offline page when the network is down', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true)
    await context.setOffline(true)
    await page.goto('/vendors').catch(() => undefined)
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible()
    await context.setOffline(false)
  })
  test('skip link jumps to the main content', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#main$/)
  })
  test('the page works without JavaScript errors in the console', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto('/')
    await page.goto('/vendors')
    expect(errors).toEqual([])
  })
})

test.describe('authenticated shells (real sessions at aal2)', () => {
  const cases: { role: string; label: string; paths: string[] }[] = [
    { role: 'customer', label: 'customer', paths: ['/orders', '/account', '/account/security'] },
    {
      role: 'vendor_owner',
      label: 'vendor',
      paths: ['/vendor', '/vendor/orders', '/vendor/catalogue', '/vendor/handover'],
    },
    { role: 'rider', label: 'rider', paths: ['/rider', '/rider/jobs', '/rider/profile'] },
    {
      role: 'platform_admin',
      label: 'admin',
      paths: ['/admin', '/admin/applications', '/admin/audit', '/admin/roles'],
    },
  ]
  for (const c of cases) {
    test(`${c.label}: every shell page is accessible and fits a small screen`, async ({ page }) => {
      const roles = c.role === 'customer' ? [] : [c.role]
      const u = await createUser(c.label, roles)
      const { secret } = await enrolFactorViaApi(u.email)
      await uiSignInWithMfa(page, u.email, secret)
      for (const p of c.paths) {
        const res = await page.goto(p)
        expect(res?.status(), p).toBe(200)
        await expect(page.getByRole('main')).toBeVisible()
        await expectNoSeriousA11yIssues(page, `${c.label} ${p}`)
        await expectNoHorizontalScroll(page, `${c.label} ${p}`)
      }
    })
  }
})
