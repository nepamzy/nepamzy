import { expect, test } from '@playwright/test'
import { a11yClean } from './helpers'

test('the landing page: illustrated people, interactive tabs and order walk-through, WhatsApp and contact', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Shop. Order. Receive.')
  await a11yClean(page, '/ (landing)')

  // the three people are in the page
  const tabs = page.getByRole('tablist', { name: 'Who is AFIT Market for?' })
  await expect(tabs.getByRole('tab')).toHaveCount(3)
  await expect(tabs.getByRole('tab', { selected: true })).toContainText('I want to order')
  await expect(page.getByRole('tabpanel')).toContainText('Order from campus shops')
  await tabs.getByRole('tab', { name: 'I run a shop' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Sell to the whole campus')
  await expect(page.getByRole('link', { name: /Open a shop/ }).first()).toHaveAttribute(
    'href',
    '/apply',
  )
  // arrow keys move between the tabs
  await page.getByRole('tab', { name: 'I run a shop' }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'I want to deliver' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('tabpanel')).toContainText('Deliver and earn')
  await expect(page.getByRole('link', { name: /Become a rider/ }).first()).toHaveAttribute(
    'href',
    '/rider-apply',
  )

  // the order walk-through can be paused and stepped
  const demo = page
    .getByRole('heading', { name: 'From tap to your door' })
    .locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
  await demo.getByRole('button', { name: 'Pause' }).click()
  await demo.getByRole('button', { name: /Handed over at the door/ }).click()
  await expect(demo).toContainText('Step 5 of 5')
  await expect(demo).toContainText('scan their QR code')
  await expect(demo).toContainText('not a real order')

  // WhatsApp: the floating button and the contact band both open the real number
  const wa = page.getByRole('link', { name: /WhatsApp/ })
  expect(await wa.count()).toBeGreaterThanOrEqual(2)
  for (const l of await wa.all()) {
    await expect(l).toHaveAttribute('href', /^https:\/\/wa\.me\/2349115930445/)
    await expect(l).toHaveAttribute('target', '_blank')
    await expect(l).toHaveAttribute('rel', /noopener/)
  }
  await expect(page.getByText('0911 5930 445').first()).toBeVisible()

  // the contact page has it too
  await page.goto('/contact')
  await expect(page.getByRole('link', { name: /Chat on WhatsApp/ })).toHaveAttribute(
    'href',
    /wa\.me\/2349115930445/,
  )
  await a11yClean(page, '/contact')
  expect(errors, errors.join('\n')).toEqual([])
})
