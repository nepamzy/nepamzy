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
  await expect(admn.page.getByText('process-notifications', { exact: true })).toBeVisible()
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

test('jobs: every worker route rejects callers without the secret, and the notification worker uses the local sink only', async ({
  browser,
}, info) => {
  const base = 'http://127.0.0.1:3000/api/jobs'
  for (const job of ['expire-orders', 'purge-location', 'process-notifications']) {
    expect((await fetch(`${base}/${job}`, { method: 'POST' })).status).toBe(401)
    expect(
      (await fetch(`${base}/${job}`, { method: 'POST', headers: { authorization: 'Bearer nope' } }))
        .status,
    ).toBe(401)
    // GET is not offered
    expect((await fetch(`${base}/${job}`)).status).toBe(405)
  }
  const secret = process.env.JOBS_SECRET
  test.skip(!secret, 'JOBS_SECRET not configured in this environment')

  const customer = await openSession(browser, info, 'jcust')
  const owner = await openSession(browser, info, 'jowner', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.user.id, `Fixture dish ${tag()}`)
  const o = await seedPaidCompletedOrder(shop, customer.user.id)
  // the customer opts in to the local sink, then something happens to their order
  await customer.page.goto('/notifications')
  await customer.page.getByLabel(/local test sink/).check()
  await clickAndWait(customer.page, () =>
    customer.page.getByRole('button', { name: 'Save' }).click(),
  )
  await admin()
    .from('order_status_history')
    .insert({ order_id: o.id, from_status: 'PAID', to_status: 'COMPLETED' })
  const pending = await admin()
    .from('notification_outbox')
    .select('id, status, notifications!inner(user_id)')
    .eq('notifications.user_id', customer.user.id)
  expect(pending.data?.map((r) => r.status)).toEqual(['pending'])

  const res = await fetch(`${base}/process-notifications`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.failed).toBe(0)
  const done = await admin()
    .from('notification_outbox')
    .select('status, notifications!inner(user_id)')
    .eq('notifications.user_id', customer.user.id)
  expect(done.data?.map((r) => r.status)).toEqual(['sent'])
  const runs = await admin()
    .from('job_runs')
    .select('ok')
    .eq('job', 'process-notifications')
    .order('id', { ascending: false })
    .limit(1)
  expect(runs.data?.[0]?.ok).toBe(true)
})

test('keyboard only: the report disclosure and the admin filter form can be operated without a mouse', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'kcust')
  const owner = await openSession(browser, info, 'kowner', ['vendor_owner'])
  const reader = await openSession(browser, info, 'kread')
  const fin = await openSession(browser, info, 'kfin', ['finance_admin'])
  const shop = await makeShopWithPoint(owner.user.id, `Fixture dish ${tag()}`)
  const o = await seedPaidCompletedOrder(shop, customer.user.id)
  const comment = `Keyboard check ${tag()}`
  const { error } = await admin().from('reviews').insert({
    order_id: o.id,
    vendor_id: shop.vendorId,
    customer_id: customer.user.id,
    rating: 5,
    comment,
  })
  expect(error).toBeNull()

  const r = reader.page
  await r.goto(`/vendors/${shop.slug}`)
  const summary = r.getByText('Report this review')
  await summary.focus()
  await expect(summary).toBeFocused()
  await r.keyboard.press('Enter') // a <details> summary opens with Enter
  const why = r.getByLabel('Why?')
  await expect(why).toBeVisible()
  await r.keyboard.press('Tab')
  await expect(why).toBeFocused()
  // the form's controls come next in the tab order and the submit button is reachable
  await r.keyboard.press('Tab') // note
  await r.keyboard.press('Tab') // submit
  await expect(r.getByRole('button', { name: 'Send report' })).toBeFocused()

  const f = fin.page
  await f.goto('/admin/refunds')
  const status = f.getByLabel('Status')
  await status.focus()
  await f.keyboard.press('Tab')
  await expect(f.getByLabel('Search order number')).toBeFocused()
  await f.keyboard.type('AFM-NOPE')
  await f.keyboard.press('Enter') // Enter in a text field submits the GET form
  await expect(f).toHaveURL(/q=AFM-NOPE/)
  await expect(f.getByText('No refund requests')).toBeVisible()
})

test('settings: only administrators; invalid values are refused; a valid change is audited; locked keys are not editable', async ({
  browser,
}, info) => {
  const support = await openSession(browser, info, 'ssup2', ['support_agent'])
  const admn = await openSession(browser, info, 'sadm2', ['platform_admin'])
  await support.page.goto('/admin/settings')
  await expect(support.page.getByText(/don’t have access to this page/)).toBeVisible()

  const a = admn.page
  await a.goto('/admin/settings')
  await expect(a.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await a11yClean(a, '/admin/settings')
  const original = (
    await admin()
      .from('platform_settings')
      .select('value')
      .eq('key', 'max_cart_item_quantity')
      .single()
  ).data!.value
  const group = a.getByRole('group', { name: 'Setting max_cart_item_quantity' })

  await group.getByLabel(/Reason for the change/).fill('Trying an out-of-range value')
  await group.getByLabel(/New value/).fill('9999')
  await clickAndWait(a, () => group.getByRole('button', { name: 'Save' }).click())
  await expect(alertIn(a)).toContainText(/refused/i)
  expect(
    (
      await admin()
        .from('platform_settings')
        .select('value')
        .eq('key', 'max_cart_item_quantity')
        .single()
    ).data!.value,
  ).toEqual(original)

  try {
    await group.getByLabel(/Reason for the change/).fill('Rehearsal of an audited change')
    await group.getByLabel(/New value/).fill('21')
    await clickAndWait(a, () => group.getByRole('button', { name: 'Save' }).click())
    await expect(statusIn(a)).toContainText(/Saved/)
    const audit = await admin()
      .from('audit_events')
      .select('action, entity_id')
      .eq('action', 'setting.changed')
      .eq('entity_id', 'max_cart_item_quantity')
      .eq('actor_id', admn.user.id)
    expect(audit.data).toHaveLength(1)
    const detail = await admin()
      .from('audit_events')
      .select('details')
      .eq('action', 'setting.changed')
      .eq('entity_id', 'max_cart_item_quantity')
      .eq('actor_id', admn.user.id)
      .single()
    expect(detail.data?.details).toMatchObject({
      new: 21,
      reason: 'Rehearsal of an audited change',
    })
  } finally {
    await admin()
      .from('platform_settings')
      .update({ value: original })
      .eq('key', 'max_cart_item_quantity')
  }

  // locked keys are shown read-only
  await expect(
    a.getByRole('group', { name: 'Setting mock_payments_enabled' }).getByText('Not editable here'),
  ).toBeVisible()
  await expect(
    a.getByRole('group', { name: 'Setting settlement_policy' }).getByText('Not editable here'),
  ).toBeVisible()
})

test('job monitoring: the health endpoint needs the secret, reports problems until every job has run, and the local runner refuses non-local targets', async () => {
  const base = 'http://127.0.0.1:3000/api/jobs'
  expect((await fetch(`${base}/health`)).status).toBe(401)
  expect(
    (await fetch(`${base}/health`, { headers: { authorization: 'Bearer nope' } })).status,
  ).toBe(401)
  expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(405)
  const secret = process.env.JOBS_SECRET
  test.skip(!secret, 'JOBS_SECRET not configured in this environment')

  const { spawnSync } = await import('node:child_process')
  // The runner calls every job once and then the health check. The shared test database may hold unrelated leftovers
  // (for example old pending notices from other specs), so this test does not demand a perfectly clean verdict: it demands that
  // every job ran OK, that the verdict never claims the jobs themselves are missing, stale or failing, and that the runner's exit
  // status is 0 exactly when the verdict is healthy.
  const ran = spawnSync('node', ['scripts/run-jobs.mjs', 'once'], {
    env: { ...process.env, JOBS_SECRET: secret },
    encoding: 'utf8',
  })
  const lines = ran.stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  expect(lines.filter((l) => l.name).map((l) => [l.name, l.ok])).toEqual([
    ['process-notifications', true],
    ['expire-orders', true],
    ['purge-location', true],
  ])
  const health = lines.at(-1).health as {
    status: number
    ok: boolean
    problems: { job: string; kind: string }[]
  }
  const jobKinds = new Set(['never_run', 'stale', 'last_run_failed', 'repeated_failures'])
  expect(
    health.problems.filter((p) => jobKinds.has(p.kind)),
    JSON.stringify(health),
  ).toEqual([])
  expect(health.status).toBe(health.ok ? 200 : 503)
  expect(ran.status === 0, JSON.stringify({ status: ran.status, health })).toBe(health.ok)

  const remote = spawnSync('node', ['scripts/run-jobs.mjs', 'check'], {
    env: { ...process.env, JOBS_SECRET: secret, JOBS_BASE_URL: 'https://example.com' },
    encoding: 'utf8',
  })
  expect(remote.status).toBe(2)
  expect(remote.stderr).toMatch(/refusing/)
})

test('effective protection: every API route refuses an anonymous caller with a non-2xx answer (only /api/health is public)', async () => {
  const { readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) =>
      statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
    )
  const routes = walk('src/app/api')
    .filter((f) => f.endsWith('route.ts'))
    .map(
      (f) =>
        '/' +
        f
          .replace(/^src\/app\//, '')
          .replace(/\/route\.ts$/, '')
          .replace('[id]', '00000000-0000-4000-8000-000000000000'),
    )
  expect(routes.length).toBeGreaterThanOrEqual(8)
  for (const path of routes) {
    for (const method of ['GET', 'POST']) {
      const res = await fetch(`http://127.0.0.1:3000${path}`, {
        method,
        redirect: 'manual',
        body: method === 'POST' ? '{}' : undefined,
      })
      const publicByDesign = path === '/api/health' && method === 'GET'
      if (publicByDesign) {
        expect([200, 503], `${method} ${path}`).toContain(res.status)
        expect(Object.keys(await res.json())).toEqual(['ok'])
      } else {
        expect(res.status, `${method} ${path}`).toBeGreaterThanOrEqual(300)
        expect(res.status, `${method} ${path}`).not.toBe(500)
      }
    }
  }
})
