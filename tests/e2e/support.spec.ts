import { expect, test, type Page } from '@playwright/test'
import {
  a11yClean,
  admin,
  alertIn,
  clickAndWait,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  seedPaidCompletedOrder,
  tag,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const refundsOf = async (order: string) =>
  (
    await admin()
      .from('refunds')
      .select('id, status, amount_kobo, provider_mode, source')
      .eq('order_id', order)
      .order('created_at')
  ).data!
const orderStatus = async (id: string) =>
  (await admin().from('orders').select('status').eq('id', id).single()).data!.status as string
const paidBack = async (order: string) =>
  (
    await admin()
      .from('ledger_entries')
      .select('id')
      .eq('order_id', order)
      .eq('entry_type', 'refund_paid')
  ).data!.length
const caseStatus = async (id: string) =>
  (await admin().from('support_cases').select('status').eq('id', id).single()).data!
    .status as string

test('refund journey: request -> review -> approval (not paid) -> FAKE execution; every step is visible and labelled; others cannot see it', async ({
  browser,
}, info) => {
  test.setTimeout(120000) // five signed-in sessions and several role hand-overs: slow CI runners exceed the 30 s default
  const customer = await openSession(browser, info, 'scust')
  const owner = await openSession(browser, info, 'sowner', ['vendor_owner'])
  const support = await openSession(browser, info, 'ssup', ['support_agent'])
  const finance = await openSession(browser, info, 'sfin', ['finance_admin'])
  const stranger = await openSession(browser, info, 'sstr')
  const shop = await makeShopWithPoint(owner.user.id, `Fixture dish ${tag()}`)
  const o = await seedPaidCompletedOrder(shop, customer.user.id)
  const c = customer.page

  // ---- customer: the order page leads to the help page ----
  await c.goto(`/orders/${o.id}`)
  await c.getByRole('link', { name: /Problem with this order/ }).click()
  await expect(c.getByRole('heading', { name: 'Help with this order' })).toBeVisible()
  await a11yClean(c, '/orders/[id]/help')

  // choose the Jollof line (bought twice) and ask for BOTH; a double click must create only one request
  const refundForm = c.locator('form').filter({ hasText: 'What do you want refunded?' })
  await refundForm.getByRole('radio', { name: 'Only some items' }).check()
  await refundForm.getByRole('checkbox', { name: /Jollof rice/ }).check()
  await refundForm.getByLabel('Quantity of Jollof rice (fixture)').fill('2')
  await refundForm
    .getByLabel('What went wrong?')
    .fill('Both portions were cold and I could not eat them')
  await refundForm.getByRole('button', { name: 'Send refund request' }).dblclick()
  await expect.poll(async () => (await refundsOf(o.id)).length).toBe(1)
  const r1 = (await refundsOf(o.id))[0]!
  expect(r1).toMatchObject({
    status: 'requested',
    amount_kobo: 300000,
    provider_mode: 'none',
    source: 'customer',
  })
  await expect(c.getByText('Waiting for review')).toBeVisible()
  await expect(c.getByText(/not a refund/).first()).toBeVisible()
  expect(await orderStatus(o.id)).toBe('COMPLETED') // a request moves nothing

  // nothing of the Jollof line is left to choose any more, so it cannot be asked for twice
  await refundForm.getByRole('radio', { name: 'Only some items' }).check()
  await expect(refundForm.getByRole('checkbox', { name: /Jollof rice/ })).toHaveCount(0)
  expect((await refundsOf(o.id)).length).toBe(1)

  // ---- others cannot reach it ----
  expect((await stranger.page.goto(`/orders/${o.id}/help`))!.status()).toBe(404)
  const anon = await openAnonymous(browser, info)
  await anon.page.goto(`/orders/${o.id}/help`)
  await expect(anon.page).toHaveURL(/\/login/)

  // ---- support reviews but cannot approve money movement (limit 0) ----
  const group = (page: Page, id: string) =>
    page.getByRole('group', { name: `Refund ${o.number} ${id.slice(0, 8)}` })
  const s = support.page
  await s.goto('/admin/refunds')
  await a11yClean(s, '/admin/refunds')
  await clickAndWait(s, () => group(s, r1.id).getByRole('button', { name: 'Start review' }).click())
  await expect.poll(async () => (await refundsOf(o.id))[0]!.status).toBe('under_review')
  await s.reload()
  await group(s, r1.id).getByLabel('Reason for approving').fill('Looks reasonable to me')
  await clickAndWait(s, () =>
    group(s, r1.id).getByRole('button', { name: 'Approve', exact: true }).click(),
  )
  await expect(alertIn(s)).toContainText(/not allowed/i)
  expect((await refundsOf(o.id))[0]!.status).toBe('under_review')
  await expect(
    group(s, r1.id).getByRole('button', { name: /Execute with the FAKE provider/ }),
  ).toHaveCount(0)

  // ---- finance approves; approval does NOT pay ----
  const f = finance.page
  await f.goto('/admin/refunds')
  await group(f, r1.id).getByLabel('Reason for approving').fill('Approved after checking the order')
  await clickAndWait(f, () =>
    group(f, r1.id).getByRole('button', { name: 'Approve', exact: true }).click(),
  )
  await expect.poll(async () => (await refundsOf(o.id))[0]!.status).toBe('approved')
  await f.reload()
  await expect(group(f, r1.id).getByText('Approved: NOT executed')).toBeVisible()
  expect(await paidBack(o.id)).toBe(0)
  await c.reload()
  await expect(c.getByText('Approved (not paid yet)')).toBeVisible()

  // ---- FAKE execution: clearly labelled; the customer sees the label too ----
  await expect(
    group(f, r1.id).getByText(/FAKE PROVIDER: nothing is sent to Paystack/),
  ).toBeVisible()
  await clickAndWait(f, () =>
    group(f, r1.id).getByRole('button', { name: 'Execute with the FAKE provider' }).click(),
  )
  await expect.poll(async () => (await refundsOf(o.id))[0]!.status).toBe('succeeded')
  expect((await refundsOf(o.id))[0]).toMatchObject({ provider_mode: 'fake' })
  expect(await paidBack(o.id)).toBe(1)
  expect(await orderStatus(o.id)).toBe('PARTIALLY_REFUNDED')
  await f.reload()
  await expect(group(f, r1.id).getByText('FAKE provider: no real money')).toBeVisible()
  await c.reload()
  await expect(c.getByText('Paid back')).toBeVisible()
  await expect(c.getByText('Test mode: no real money moved')).toBeVisible()
  await a11yClean(c, '/orders/[id]/help (after refund)')

  // ---- a second refund whose (fake) provider does not answer needs reconciliation ----
  await refundForm.getByRole('radio', { name: 'Everything still refundable' }).check()
  await refundForm
    .getByLabel('What went wrong?')
    .fill('The drink was also bad, please refund the rest')
  await clickAndWait(c, () =>
    refundForm.getByRole('button', { name: 'Send refund request' }).click(),
  )
  await expect.poll(async () => (await refundsOf(o.id)).length).toBe(2)
  const second = (await refundsOf(o.id))[1]!
  expect(second.amount_kobo).toBe(120000)
  await f.reload()
  await group(f, second.id).getByLabel('Reason for approving').fill('Approved the remainder')
  await clickAndWait(f, () =>
    group(f, second.id).getByRole('button', { name: 'Approve', exact: true }).click(),
  )
  await expect.poll(async () => (await refundsOf(o.id))[1]!.status).toBe('approved')
  await f.reload()
  await group(f, second.id).getByLabel('Pretend the provider answers…').selectOption('timeout')
  await clickAndWait(f, () =>
    group(f, second.id).getByRole('button', { name: 'Execute with the FAKE provider' }).click(),
  )
  await expect.poll(async () => (await refundsOf(o.id))[1]!.status).toBe('reconciliation_required')
  await f.reload()
  await expect(group(f, second.id).getByText('Needs reconciliation').first()).toBeVisible()
  expect(await paidBack(o.id)).toBe(1) // an unknown outcome pays nothing

  await Promise.all(
    [customer, owner, support, finance, stranger, anon].map((x) => x.context.close()),
  )
})

test('report -> support decision -> a refund REQUEST (not a refund); return approved by support and confirmed by the shop; parties see only their side', async ({
  browser,
}, info) => {
  test.setTimeout(120000)
  const customer = await openSession(browser, info, 'rcust')
  const owner = await openSession(browser, info, 'rowner', ['vendor_owner'])
  const support = await openSession(browser, info, 'rsup', ['support_agent'])
  const shop = await makeShopWithPoint(owner.user.id, `Fixture dish ${tag()}`)
  const o = await seedPaidCompletedOrder(shop, customer.user.id)
  const c = customer.page

  // ---- customer reports a problem (a double click makes one report) ----
  await c.goto(`/orders/${o.id}/help`)
  await c.getByLabel('Tell us what happened').fill('The zobo drink was missing from the bag')
  await c.getByRole('button', { name: 'Send report' }).dblclick()
  await expect
    .poll(
      async () =>
        (await admin().from('support_cases').select('id').eq('order_id', o.id)).data!.length,
    )
    .toBe(1)
  expect(await orderStatus(o.id)).toBe('DISPUTED')
  const kase = (
    await admin().from('support_cases').select('id, case_no').eq('order_id', o.id).single()
  ).data!
  await c.goto(`/cases/${kase.id}`)
  await expect(c.getByRole('heading', { name: kase.case_no })).toBeVisible()
  await a11yClean(c, '/cases/[id] (customer)')
  await c.getByLabel('Your statement').fill('I paid for it and it was not there')
  await clickAndWait(c, () => c.getByRole('button', { name: 'Add statement' }).click())
  await expect(c.getByText('I paid for it and it was not there')).toBeVisible()

  // ---- the shop sees the case, its own side only, and not the customer's words ----
  const v = owner.page
  await v.goto(`/cases/${kase.id}`)
  await expect(v.getByRole('heading', { name: kase.case_no })).toBeVisible()
  await expect(v.getByText('I paid for it and it was not there')).toHaveCount(0)
  await expect(v.getByText('The zobo drink was missing from the bag')).toHaveCount(0)
  await v.getByLabel('Your statement').fill('We packed everything and sealed the bag')
  await clickAndWait(v, () => v.getByRole('button', { name: 'Add statement' }).click())
  await expect(v.getByText('We packed everything and sealed the bag')).toBeVisible()
  await c.reload()
  await expect(c.getByText('We packed everything and sealed the bag')).toHaveCount(0)

  // ---- support sees both, decides, and only a refund REQUEST results ----
  const s = support.page
  await s.goto(`/admin/cases/${kase.id}`)
  await a11yClean(s, '/admin/cases/[id]')
  await expect(s.getByText('I paid for it and it was not there')).toBeVisible()
  await expect(s.getByText('We packed everything and sealed the bag')).toBeVisible()
  await expect(s.getByText(/not used to decide a case/).first()).toBeVisible()
  await clickAndWait(s, () => s.getByRole('button', { name: 'Start review' }).click())
  await expect.poll(() => caseStatus(kase.id)).toBe('under_review')
  await s.reload()
  await s.getByLabel('Decision', { exact: true }).selectOption('partial_refund')
  await s
    .getByLabel('Reason (kept with the decision)')
    .fill('The drink was not in the bag according to the customer; shop could not show otherwise')
  await s.getByRole('checkbox', { name: /Zobo drink/ }).check()
  await clickAndWait(s, () => s.getByRole('button', { name: 'Record decision' }).click())
  await expect.poll(async () => (await refundsOf(o.id)).length).toBe(1)
  expect((await refundsOf(o.id))[0]).toMatchObject({
    status: 'requested',
    amount_kobo: 100000,
    source: 'case',
    provider_mode: 'none',
  })
  expect(await paidBack(o.id)).toBe(0)
  await c.reload()
  await expect(c.getByText(/finance still has to approve/)).toBeVisible()
  await s.reload()
  await clickAndWait(s, () => s.getByRole('button', { name: 'Close report' }).click())
  await expect.poll(() => caseStatus(kase.id)).toBe('closed')
  expect(await orderStatus(o.id)).toBe('COMPLETED')

  // ---- return flow: customer asks, support approves, the shop confirms ----
  await c.goto(`/orders/${o.id}/help`)
  const returnForm = c.locator('form').filter({ hasText: 'Why do you want to return it?' })
  await returnForm.getByRole('checkbox', { name: /Jollof rice/ }).check()
  await returnForm
    .getByLabel('Why do you want to return it?')
    .fill('It arrived spilled and I do not want it')
  await clickAndWait(c, () =>
    returnForm.getByRole('button', { name: 'Send return request' }).click(),
  )
  await expect
    .poll(
      async () =>
        (await admin().from('return_requests').select('id').eq('order_id', o.id)).data!.length,
    )
    .toBe(1)
  const ret = (await admin().from('return_requests').select('id').eq('order_id', o.id).single())
    .data!
  const rgroup = (page: Page) =>
    page.getByRole('group', { name: `Return ${o.number} ${ret.id.slice(0, 8)}` })
  const returnStatus = async () =>
    (await admin().from('return_requests').select('status').eq('order_id', o.id).single()).data!
      .status
  await s.goto('/admin/returns')
  await a11yClean(s, '/admin/returns')
  await rgroup(s).getByLabel('Reason for approving').fill('Spillage reported, approved by support')
  await clickAndWait(s, () => rgroup(s).getByRole('button', { name: 'Approve return' }).click())
  await expect.poll(returnStatus).toBe('approved')
  expect((await refundsOf(o.id)).length).toBe(1) // a return created no refund
  await v.goto('/vendor/returns')
  await a11yClean(v, '/vendor/returns')
  await rgroup(v).getByLabel('Condition of the returned item').fill('Box opened, food spilled')
  await clickAndWait(v, () =>
    rgroup(v).getByRole('button', { name: 'Confirm item received' }).click(),
  )
  await expect.poll(returnStatus).toBe('received_by_vendor')
  await c.goto(`/orders/${o.id}/help`)
  await expect(c.getByText('The shop has the item')).toBeVisible()
  await Promise.all([customer, owner, support].map((x) => x.context.close()))
})
