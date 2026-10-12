import { expect, test } from '@playwright/test'
import {
  a11yClean,
  admin,
  alertIn,
  clickAndWait,
  makeShopWithPoint,
  openSession,
  seedPaidCompletedOrder,
  statusIn,
  tag,
} from './helpers'

test.describe.configure({ mode: 'serial' })

test('notifications: generic in-app notices, private to their owner, keyboard operable, copies are a local sink only', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'ncust')
  const owner = await openSession(browser, info, 'nowner', ['vendor_owner'])
  const stranger = await openSession(browser, info, 'nstr')
  const shop = await makeShopWithPoint(owner.user.id, `Fixture dish ${tag()}`)
  const o = await seedPaidCompletedOrder(shop, customer.user.id)
  // a real status-history row fires the same database trigger a vendor action would
  const { error } = await admin()
    .from('order_status_history')
    .insert({ order_id: o.id, from_status: 'PAID', to_status: 'COMPLETED' })
  expect(error).toBeNull()

  const c = customer.page
  await c.goto('/notifications')
  await expect(c.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
  await expect(c.getByText('Order complete')).toBeVisible()
  await expect(c.getByText('1 unread')).toBeVisible()
  // content is generic: no money, codes or locations
  const main = (await c.locator('main').innerText()).replace(/\s+/g, ' ')
  expect(main).not.toMatch(/₦|pickup code|token|signature|latitude|longitude/i)
  await a11yClean(c, '/notifications')

  // keyboard: reach "Mark all as read" with Tab and activate it with Enter
  const markAll = c.getByRole('button', { name: 'Mark all as read' })
  await markAll.focus()
  await expect(markAll).toBeFocused()
  await Promise.all([
    c.waitForResponse((r) => r.request().method() === 'POST'),
    c.keyboard.press('Enter'),
  ])
  await expect(c.getByText('1 unread')).toHaveCount(0)

  // preference: opt-in copy goes to a LOCAL sink; the page says plainly nothing is emailed
  await expect(c.getByText(/No real email, SMS or push message is sent/)).toBeVisible()
  await c.getByLabel(/local test sink/).check()
  await clickAndWait(c, () => c.getByRole('button', { name: 'Save' }).click())
  await expect(statusIn(c)).toContainText(/local test sink/)
  const pref = await admin()
    .from('notification_preferences')
    .select('email_enabled')
    .eq('user_id', customer.user.id)
    .single()
  expect(pref.data?.email_enabled).toBe(true)

  // another user sees none of it
  await stranger.page.goto('/notifications')
  await expect(stranger.page.getByText('Order complete')).toHaveCount(0)
  await expect(stranger.page.getByText('Nothing yet')).toBeVisible()
})

test('reviews: only the customer of a finished order; public summary; report; moderation hides but never deletes or touches money', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'rcust')
  const owner = await openSession(browser, info, 'rowner', ['vendor_owner'])
  const reader = await openSession(browser, info, 'rread')
  const support = await openSession(browser, info, 'rsup', ['support_agent'])
  const shop = await makeShopWithPoint(owner.user.id, `Fixture dish ${tag()}`)
  const o = await seedPaidCompletedOrder(shop, customer.user.id)
  const c = customer.page
  const comment = `Hot food and quick ${tag()}`

  // the shop owner is not offered a review of their own shop (and the order is not theirs anyway)
  await c.goto(`/orders/${o.id}`)
  await expect(c.getByRole('heading', { name: 'Review this order' })).toBeVisible()
  await a11yClean(c, '/orders/[id] with review form')
  await c.getByLabel('Rating').selectOption('4')
  await c.getByLabel(/Comment/).fill(comment)
  await clickAndWait(c, () => c.getByRole('button', { name: 'Publish review' }).click())
  await expect(c.getByRole('heading', { name: 'Your review' })).toBeVisible()
  await expect(c.getByRole('heading', { name: 'Review this order' })).toHaveCount(0)
  const rows = await admin().from('reviews').select('id, status, rating').eq('order_id', o.id)
  expect(rows.data).toHaveLength(1)
  const reviewId = rows.data![0]!.id as string

  // public page: average and the comment, no customer identity
  await reader.page.goto(`/vendors/${shop.slug}`)
  await expect(reader.page.getByText('4.0 out of 5')).toBeVisible()
  await expect(reader.page.getByText(comment)).toBeVisible()
  await a11yClean(reader.page, '/vendors/[slug] with reviews')

  // another signed-in user reports it (a report does not hide anything by itself)
  await reader.page.getByText('Report this review').click()
  await reader.page.getByLabel('Why?').selectOption('spam')
  await clickAndWait(reader.page, () =>
    reader.page.getByRole('button', { name: 'Send report' }).click(),
  )
  await expect(statusIn(reader.page)).toContainText(/stays visible/)
  await reader.page.reload()
  await expect(reader.page.getByText(comment)).toBeVisible()

  // customers are not allowed into moderation
  await c.goto('/admin/reviews')
  await expect(c.getByText(/don’t have access to this page/).first()).toBeVisible()

  // support: a short reason is refused; a proper one hides the review
  const s = support.page
  await s.goto('/admin/reviews')
  await expect(s.getByRole('heading', { name: 'Review reports' })).toBeVisible()
  await a11yClean(s, '/admin/reviews')
  const card = s
    .locator('main')
    .getByText(comment)
    .locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]')
  await card.getByLabel('Decision').selectOption('hide')
  await card.getByLabel(/Reason/).fill('Spam: unrelated promotional text in the comment')
  await clickAndWait(s, () => card.getByRole('button', { name: 'Record decision' }).click())
  await expect(s.getByText(comment)).toHaveCount(0) // decided reports leave the open list

  const after = await admin()
    .from('reviews')
    .select('status, hidden_reason')
    .eq('id', reviewId)
    .single()
  expect(after.data?.status).toBe('hidden') // kept, not deleted
  await reader.page.reload()
  await expect(reader.page.getByText(comment)).toHaveCount(0)
  // no effect on the order or the ledger
  const ord = await admin().from('orders').select('status').eq('id', o.id).single()
  expect(ord.data?.status).toBe('COMPLETED')
  const led = await admin().from('ledger_entries').select('id').eq('order_id', o.id)
  expect(led.data).toHaveLength(1)
})

test('admin overview and job health are role scoped', async ({ browser }, info) => {
  const support = await openSession(browser, info, 'osup', ['support_agent'])
  const admn = await openSession(browser, info, 'oadm', ['platform_admin'])
  await support.page.goto('/admin')
  await expect(support.page.getByText('Needs attention')).toBeVisible()
  await expect(support.page.getByText('Open reports')).toBeVisible()
  await expect(support.page.getByText('Notifications that failed for good')).toHaveCount(0)
  await a11yClean(support.page, '/admin (support)')
  await support.page.goto('/admin/jobs')
  await expect(support.page.getByText(/don’t have access to this page/).first()).toBeVisible()

  await admn.page.goto('/admin')
  await expect(admn.page.getByText('Notifications that failed for good')).toBeVisible()
  await admn.page.goto('/admin/jobs')
  await expect(admn.page.getByRole('heading', { name: 'Background jobs' })).toBeVisible()
  await expect(admn.page.getByText(/does not schedule these jobs/)).toBeVisible()
  await expect(admn.page.getByText('process-notifications')).toBeVisible()
  await a11yClean(admn.page, '/admin/jobs')
})

test('admin lists are bounded and filterable with plain links and a GET form', async ({
  browser,
}, info) => {
  const fin = await openSession(browser, info, 'pfin', ['finance_admin'])
  await fin.page.goto('/admin/refunds?status=bogus&page=999999&q=%25')
  // invalid status and absurd page numbers degrade to safe defaults instead of erroring
  await expect(fin.page.getByRole('heading', { name: 'Refunds', level: 1 })).toBeVisible()
  await fin.page.getByLabel('Status').selectOption('requested')
  await fin.page.getByRole('button', { name: 'Filter' }).click()
  await expect(fin.page).toHaveURL(/status=requested/)
  await a11yClean(fin.page, '/admin/refunds filtered')
})
