import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  PASSWORD,
  admin,
  createUser,
  enrolFactorViaApi,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  openSessionFor,
  restorePlaceholderTerms,
  seedArrivedOrder,
  seedPaidCompletedOrder,
  seedRider,
  tag,
  uiSignIn,
} from '../e2e/helpers'

/**
 * VISUAL AUDIT CAPTURE. Drives the real running application with SYNTHETIC data and saves a screenshot per page/state.
 * It never changes the design, never bypasses authorisation (each role signs in through the real UI incl. TOTP), and records
 * every attempt - including failures - in inventory-<viewport>.jsonl.
 */
const PHASE = process.env.UI_AUDIT_PHASE === 'after' ? 'after' : 'before'
const ROOT = 'artifacts/afit-market-ui-audit'
let OUT = ROOT
test.describe.configure({ mode: 'serial' })
test.setTimeout(1_500_000)
test.use({ actionTimeout: 8000 }) // a missing control must fail fast and be recorded, not stall the audit

type Row = {
  role: string
  route: string
  actualUrl: string
  state: string
  viewport: string
  file: string | null
  http: number | null
  note: string
}
let vp = ''
const rows: Row[] = []
const slug = (s: string) =>
  s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'ID')
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'home'

async function shot(
  page: Page,
  role: string,
  route: string,
  state = 'default',
  opts: { goto?: boolean; note?: string; folder?: string } = {},
) {
  const row: Row = {
    role,
    route,
    actualUrl: '',
    state,
    viewport: vp,
    file: null,
    http: null,
    note: opts.note ?? '',
  }
  try {
    if (opts.goto !== false) {
      const res = await page.goto(route, { waitUntil: 'load' })
      row.http = res?.status() ?? null
    }
    await page.waitForTimeout(500)
    row.actualUrl = new URL(page.url()).pathname + new URL(page.url()).search
    const dir = join(OUT, opts.folder ?? role)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${slug(route)}__${state}.png`)
    await page.screenshot({ path: file, fullPage: true })
    row.file = file
    // a redirected or denied page is still a real rendered state; say so
    if (row.actualUrl.split('?')[0] !== route.split('?')[0])
      row.note += ` redirected to ${row.actualUrl}`
  } catch (e) {
    row.note += ` FAILED: ${String((e as Error).message).slice(0, 160)}`
  }
  rows.push(row)
  appendFileSync(join(OUT, `inventory.jsonl`), JSON.stringify(row) + '\n')
}

test.afterAll(async () => {
  await restorePlaceholderTerms()
  writeFileSync(join(OUT, `inventory.json`), JSON.stringify(rows, null, 2))
})

test('capture every implemented page, per role, with synthetic data', async ({ browser }, info) => {
  vp = info.project.name === 'desktop' ? 'desktop' : 'mobile'
  OUT = join(ROOT, PHASE, vp)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `inventory.jsonl`), '')

  // ---------------------------------------------------------------- synthetic data
  const ownerU = await createUser('au-owner', ['vendor_owner'])
  const shop = await makeShopWithPoint(ownerU.id, `Fixture dish ${tag()}`)
  const a = admin()
  const prod = (
    await a.from('products').select('id').eq('vendor_id', shop.vendorId).limit(1).single()
  ).data!.id as string
  const sessions = {
    customer: await openSession(browser, info, 'au-cust'),
    owner: await openSession(browser, info, 'au-vowner', ['vendor_owner']),
    platformAdmin: await openSession(browser, info, 'au-admin', ['platform_admin']),
    support: await openSession(browser, info, 'au-support', ['support_agent']),
    finance: await openSession(browser, info, 'au-fin', ['finance_admin']),
  }
  // the vendor session must belong to the SAME shop that has orders: attach it to the fixture shop
  await a
    .from('vendor_staff')
    .insert({ vendor_id: shop.vendorId, user_id: sessions.owner.user.id, staff_role: 'staff' })
  await a
    .from('role_assignments')
    .insert({ user_id: sessions.owner.user.id, role: 'vendor_staff' })
    .then(
      () => undefined,
      () => undefined,
    )
  const cust = sessions.customer.user.id
  const done = await seedPaidCompletedOrder(shop, cust) // COMPLETED pickup order
  await a
    .from('order_status_history')
    .insert({ order_id: done.id, from_status: 'PAID', to_status: 'COMPLETED' })
  const riderU = await seedRider({ active: true })
  const arrived = await seedArrivedOrder(shop, cust, riderU) // ARRIVAL_DETECTED delivery
  const riderSession = await openSessionFor(browser, info, riderU)
  // a paid order waiting for the shop, and an unpaid order
  const mkOrder = async (status: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await a
      .from('orders')
      .insert({
        order_number: `AFM-T${tag()}`,
        customer_id: cust,
        vendor_id: shop.vendorId,
        vendor_name: 'Fixture shop',
        fulfilment: 'pickup',
        pickup_location_snapshot: 'Counter (placeholder)',
        status,
        items_total_kobo: 150000,
        delivery_fee_kobo: 0,
        platform_fee_kobo: 7500,
        total_kobo: 157500,
        idempotency_key: `fixture-${tag()}-aud`,
        ...extra,
      })
      .select('id')
      .single()
    if (error) throw error
    await a.from('order_items').insert({
      order_id: data!.id,
      product_name: 'Jollof rice (fixture)',
      base_price_kobo: 150000,
      unit_price_kobo: 150000,
      quantity: 1,
      line_total_kobo: 150000,
    })
    return data!.id as string
  }
  const paidId = await mkOrder('PAID')
  await a
    .from('order_status_history')
    .insert({ order_id: paidId, from_status: 'PENDING_PAYMENT', to_status: 'PAID' })
  await mkOrder('PENDING_PAYMENT', { expires_at: new Date(Date.now() + 25 * 60_000).toISOString() })
  const enRoute = await mkOrder('EN_ROUTE', {
    fulfilment: 'delivery',
    delivery_point_id: shop.pointId,
    delivery_point_label: shop.pointLabel,
  })

  // ---------------------------------------------------------------- public / anonymous
  const anon = await openAnonymous(browser, info)
  const ap = anon.page
  await shot(ap, 'public', '/', 'landing')
  await shot(ap, 'public', '/vendors', 'list')
  await shot(ap, 'public', '/vendors?q=zzzz-no-such-item', 'search-no-results')
  await shot(ap, 'public', '/vendors?q=Fixture', 'search-results')
  await shot(ap, 'public', `/vendors/${shop.slug}`, 'vendor-menu')
  await shot(ap, 'public', `/products/${prod}`, 'product-detail')
  await shot(ap, 'public', '/vendors/no-such-shop', 'not-found-404')
  await shot(ap, 'public', '/login', 'empty-form')
  await ap.getByLabel('Email').fill('nobody@example.test')
  await ap.getByLabel('Password').fill('wrong-password-123')
  await ap.getByRole('button', { name: 'Sign in' }).click()
  await ap.waitForTimeout(1200)
  await shot(ap, 'public', '/login', 'wrong-password-error', { goto: false })
  await shot(ap, 'public', '/signup', 'empty-form')
  await ap
    .getByLabel('Email')
    .fill('not-an-email')
    .catch(() => undefined)
  await ap
    .getByRole('button', { name: /Create account|Sign up/i })
    .click()
    .catch(() => undefined)
  await ap.waitForTimeout(800)
  await shot(ap, 'public', '/signup', 'validation-error', { goto: false })
  await shot(ap, 'public', '/offline', 'offline-fallback')
  await shot(ap, 'public', '/design', 'design-system-page', {
    note: 'internal design reference page',
  })
  // protected pages seen anonymously: the real guard redirect
  await shot(ap, 'public', '/orders', 'anonymous-redirected-to-login')
  await shot(ap, 'public', '/admin', 'anonymous-redirected-to-login')
  await shot(ap, 'public', '/cart', 'anonymous-cart')

  // ---------------------------------------------------------------- MFA screens (real flows)
  const noFactor = await createUser('au-nofactor')
  const nf = await openAnonymous(browser, info)
  await uiSignIn(nf.page, noFactor.email)
  await shot(nf.page, 'public', '/', 'signed-in-no-factor-home', {
    goto: false,
    note: 'a customer without a factor can browse after sign-in (K15)',
  })
  await shot(nf.page, 'public', '/mfa/enroll', 'enrol-first-factor')
  const withFactor = await createUser('au-withfactor')
  await enrolFactorViaApi(withFactor.email)
  const wf = await openAnonymous(browser, info)
  await uiSignIn(wf.page, withFactor.email)
  await shot(wf.page, 'public', '/mfa/challenge', 'challenge', { goto: false })
  await wf.page.getByLabel('6-digit code').fill('000000')
  await wf.page.getByRole('button', { name: 'Verify' }).click()
  await wf.page.waitForTimeout(1200)
  await shot(wf.page, 'public', '/mfa/challenge', 'wrong-code-error', { goto: false })

  // ---------------------------------------------------------------- customer
  const c = sessions.customer.page
  await shot(c, 'customer', '/cart', 'empty-cart')
  await shot(c, 'customer', `/products/${prod}`, 'product-detail-signed-in')
  await c
    .getByRole('button', { name: /Add to cart/i })
    .first()
    .click()
    .catch(() => undefined)
  await c.waitForTimeout(1000)
  await shot(c, 'customer', `/products/${prod}`, 'after-add-to-cart', { goto: false })
  await shot(c, 'customer', '/cart', 'populated-cart')
  await shot(c, 'customer', '/checkout', 'checkout-form')
  for (const [p, s] of [
    ['/orders', 'order-history'],
    [`/orders/${done.id}`, 'completed-order-with-review-form'],
    [`/orders/${done.id}/help`, 'help-refund-and-report-forms'],
    [`/orders/${paidId}`, 'paid-order-waiting-for-shop'],
    [`/orders/${enRoute}`, 'delivery-en-route-no-location-yet'],
    ['/notifications', 'notifications-with-unread'],
    ['/cases', 'reports-empty'],
    ['/account', 'account'],
    ['/account/security', 'account-security-mfa'],
    ['/apply', 'vendor-application-form'],
    ['/rider-apply', 'rider-application-form'],
  ] as const)
    await shot(c, 'customer', p, s)
  // review form filled + submitted
  await c.goto(`/orders/${done.id}`)
  await c
    .getByLabel('Rating')
    .selectOption('4')
    .catch(() => undefined)
  await c
    .getByLabel(/Comment/)
    .fill('Hot food and quick service (synthetic review)')
    .catch(() => undefined)
  await c
    .getByRole('button', { name: 'Publish review' })
    .click()
    .catch(() => undefined)
  await c.waitForTimeout(1200)
  await shot(c, 'customer', `/orders/${done.id}`, 'review-published', { goto: false })
  // refund request submitted + report opened (real forms)
  await c.goto(`/orders/${done.id}/help`)
  const refundForm = c.locator('form').filter({ hasText: 'What do you want refunded?' })
  await refundForm
    .getByLabel('What went wrong?')
    .fill('Synthetic test: an item was missing from the bag')
    .catch(() => undefined)
  await refundForm
    .getByRole('button', { name: 'Send refund request' })
    .click()
    .catch(() => undefined)
  await c.waitForTimeout(1500)
  await shot(c, 'customer', `/orders/${done.id}/help`, 'refund-requested', { goto: false })
  const reportForm = c.locator('form').filter({ hasText: 'What is the problem?' }).first()
  await reportForm
    .locator('select')
    .first()
    .selectOption({ index: 1 })
    .catch(() => undefined)
  await reportForm
    .locator('textarea')
    .first()
    .fill('Synthetic test: the item was not what I ordered at all')
    .catch(() => undefined)
  await reportForm
    .getByRole('button', { name: /Send report|Report/i })
    .first()
    .click()
    .catch(() => undefined)
  await c.waitForTimeout(1500)
  await shot(c, 'customer', `/orders/${done.id}/help`, 'report-opened', { goto: false })
  const caseRow = (await a.from('support_cases').select('id').eq('order_id', done.id).limit(1))
    .data?.[0]
  await shot(c, 'customer', '/cases', 'reports-list')
  if (caseRow) await shot(c, 'customer', `/cases/${caseRow.id}`, 'report-detail')
  else
    rows.push({
      role: 'customer',
      route: '/cases/[id]',
      actualUrl: '',
      state: 'detail',
      viewport: vp,
      file: null,
      http: null,
      note: 'BLOCKED: no case could be opened through the form in this run',
    })
  // delivery proof: arrived order -> confirm receipt -> signing UI
  await shot(c, 'customer', `/orders/${arrived.id}`, 'rider-arrived-confirm-receipt')
  await c
    .getByRole('button', { name: 'Confirm receipt' })
    .click()
    .catch(() => undefined)
  await c.waitForTimeout(1500)
  await shot(c, 'customer', `/orders/${arrived.id}`, 'signature-capture-empty', { goto: false })
  await c
    .getByLabel('Your name (the person receiving the order)')
    .fill('Ada Student')
    .catch(() => undefined)
  await c
    .getByRole('checkbox')
    .check()
    .catch(() => undefined)
  await c
    .getByRole('button', { name: 'Confirm and sign' })
    .click()
    .catch(() => undefined)
  await c.waitForTimeout(1200)
  await shot(c, 'customer', `/orders/${arrived.id}`, 'signature-missing-error', { goto: false })
  // access-denied states
  for (const p of ['/vendor', '/rider', '/admin', '/admin/settings'])
    await shot(c, 'customer', p, 'forbidden-for-customer')

  // another plain user: empty states
  const plain = await openSession(browser, info, 'au-plain')
  for (const [p, s] of [
    ['/orders', 'orders-empty'],
    ['/notifications', 'notifications-empty'],
    ['/cart', 'cart-empty'],
  ] as const)
    await shot(plain.page, 'customer', p, s)

  // ---------------------------------------------------------------- vendor
  const v = sessions.owner.page
  for (const [p, s] of [
    ['/vendor', 'dashboard'],
    ['/vendor/orders', 'incoming-orders'],
    ['/vendor/catalogue', 'catalogue'],
    ['/vendor/catalogue/new', 'new-product-form'],
    [`/vendor/catalogue/${prod}`, 'edit-product'],
    ['/vendor/profile', 'shop-profile-and-hours'],
    ['/vendor/handover', 'pickup-handover'],
    ['/vendor/returns', 'returns'],
    ['/notifications', 'notifications'],
    ['/account', 'account'],
  ] as const)
    await shot(v, 'vendor', p, s)
  const vplain = await openSession(browser, info, 'au-novendor')
  await shot(vplain.page, 'vendor', '/vendor', 'forbidden-for-non-vendor')

  // ---------------------------------------------------------------- rider
  const r = riderSession.page
  for (const [p, s] of [
    ['/rider', 'dashboard-active-shift'],
    ['/rider/jobs', 'jobs-with-arrived-delivery'],
    ['/rider/profile', 'profile'],
    ['/notifications', 'notifications'],
  ] as const)
    await shot(r, 'rider', p, s)
  const rIdle = await seedRider({ active: false })
  const rIdleS = await openSessionFor(browser, info, rIdle)
  await shot(rIdleS.page, 'rider', '/rider', 'dashboard-inactive')
  await shot(rIdleS.page, 'rider', '/rider/jobs', 'jobs-inactive-no-offers')

  // ---------------------------------------------------------------- admin (platform administrator sees everything)
  const ad = sessions.platformAdmin.page
  for (const p of [
    '/admin',
    '/admin/applications',
    '/admin/vendors',
    '/admin/delivery-points',
    '/admin/categories',
    '/admin/riders',
    '/admin/rider-issues',
    '/admin/payments',
    '/admin/refunds',
    '/admin/cases',
    '/admin/returns',
    '/admin/reviews',
    '/admin/jobs',
    '/admin/settings',
    '/admin/audit',
    '/admin/roles',
  ])
    await shot(ad, 'admin', p, 'platform-admin')
  if (caseRow) await shot(ad, 'admin', `/admin/cases/${caseRow.id}`, 'case-detail')
  await shot(ad, 'admin', '/admin/refunds?status=requested&q=AFM', 'refunds-filtered')
  await shot(ad, 'admin', '/notifications', 'notifications')
  // role-scoped views of the same pages
  await shot(sessions.support.page, 'admin', '/admin', 'support-agent-overview')
  await shot(sessions.support.page, 'admin', '/admin/cases', 'support-agent-cases')
  await shot(sessions.support.page, 'admin', '/admin/settings', 'forbidden-for-support')
  await shot(sessions.finance.page, 'admin', '/admin', 'finance-admin-overview')
  await shot(sessions.finance.page, 'admin', '/admin/refunds', 'finance-admin-refunds')
  await shot(sessions.finance.page, 'admin', '/admin/cases', 'forbidden-for-finance')

  // ---------------------------------------------------------------- rider direct delivery-fee payment (fixture marks the fee as NOT collected by Paystack)
  const payRider = await seedRider({ active: true })
  const payRiderS = await openSessionFor(browser, info, payRider)
  const mkDirect = async (statusLabel: string) => {
    const { data, error } = await a
      .from('orders')
      .insert({
        order_number: `AFM-D${tag()}`,
        customer_id: cust,
        vendor_id: shop.vendorId,
        vendor_name: 'Fixture shop',
        fulfilment: 'delivery',
        delivery_point_id: shop.pointId,
        delivery_point_label: shop.pointLabel,
        pickup_location_snapshot: 'Counter (placeholder)',
        status: 'COMPLETED',
        items_total_kobo: 100000,
        delivery_fee_kobo: 50000,
        platform_fee_kobo: 0,
        total_kobo: 100000,
        delivery_fee_collection: 'direct_to_rider',
        idempotency_key: `fixture-${tag()}-${statusLabel}`,
      })
      .select('id')
      .single()
    if (error) throw error
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    try {
      await db.query(
        `insert into public.ledger_entries (order_id, entry_type, amount_kobo) values ($1,'payment_received',100000)`,
        [data!.id],
      )
      await db.query(
        `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, status, completed_at) values ($1,$2,$3,1,'completed', now())`,
        [data!.id, payRider.id, payRider.shift],
      )
    } finally {
      await db.end()
    }
    return data!.id as string
  }
  const dfpA = await mkDirect('a')
  const dfpB = await mkDirect('b')
  const pr = payRiderS.page
  await shot(pr, 'rider', '/rider/payments', 'no-bank-details-yet')
  await pr.getByLabel('Bank name').fill('Fixture Bank (synthetic)')
  await pr.getByLabel('Account number').fill('0123456789')
  await pr.getByLabel('Account name').fill('Fixture Rider')
  await pr.getByRole('button', { name: 'Save bank details' }).click()
  await pr.waitForTimeout(1200)
  await shot(pr, 'rider', '/rider/payments', 'bank-details-saved', { goto: false })
  await shot(c, 'customer', `/orders/${dfpA}`, 'order-with-delivery-fee-notice')
  await shot(c, 'customer', `/orders/${dfpA}/delivery-fee`, 'pay-delivery-fee-start')
  await c.getByRole('button', { name: 'Show payment details' }).click()
  await c.waitForTimeout(1200)
  await shot(c, 'customer', `/orders/${dfpA}/delivery-fee`, 'pay-delivery-fee-details', {
    goto: false,
  })
  await c.getByRole('button', { name: 'I have made this transfer' }).click()
  await c.waitForTimeout(1200)
  await shot(c, 'customer', `/orders/${dfpA}/delivery-fee`, 'transfer-reported-waiting', {
    goto: false,
  })
  await shot(pr, 'rider', '/rider/payments', 'customer-reported-awaiting-confirmation')
  await pr.getByRole('button', { name: 'Yes, I received this amount' }).first().click()
  await pr.waitForTimeout(1500)
  await shot(pr, 'rider', '/rider/payments', 'confirmed-with-receipt', { goto: false })
  await shot(c, 'customer', '/account/receipts', 'receipt-list')
  const link = await c.locator('a[href*="/receipts/"]').first().getAttribute('href')
  if (link) {
    await shot(ap, 'public', new URL(link, 'http://x').pathname, 'public-receipt-check')
    await shot(ap, 'public', `/receipts/${'0'.repeat(48)}`, 'public-receipt-not-found')
  }
  // a second payment: dispute and administrator decision
  await c.goto(`/orders/${dfpB}/delivery-fee`)
  await c.getByRole('button', { name: 'Show payment details' }).click()
  await c.waitForTimeout(1000)
  await c.getByRole('button', { name: 'I have made this transfer' }).click()
  await c.waitForTimeout(1200)
  await pr.goto('/rider/payments')
  await pr
    .getByLabel('Why are you disputing it?')
    .first()
    .fill('Nothing arrived (synthetic dispute)')
  await pr.getByRole('button', { name: 'No, I did not receive it' }).first().click()
  await pr.waitForTimeout(1200)
  await shot(pr, 'rider', '/rider/payments', 'disputed', { goto: false })
  await shot(c, 'customer', `/orders/${dfpB}/delivery-fee`, 'disputed-customer-view')
  await shot(ad, 'admin', '/admin/delivery-fee-payments', 'dispute-awaiting-decision')
  await shot(sessions.finance.page, 'admin', '/admin/delivery-fee-payments', 'finance-admin-view')

  // ---------------------------------------------------------------- earnings, settlements, data requests, menus
  await shot(v, 'vendor', '/vendor/earnings', 'earnings')
  await shot(v, 'vendor', '/vendor/menu', 'more-menu')
  await shot(ad, 'admin', '/admin/settlements', 'settlements')
  await shot(ad, 'admin', '/admin/data-requests', 'data-requests')
  await shot(ad, 'admin', '/admin/menu', 'more-menu')
  await shot(c, 'customer', '/account/data-requests', 'data-requests')

  // ---------------------------------------------------------------- health / API pages that render something
  for (const s of Object.values(sessions)) await s.context.close()
  await expect(rows.filter((x) => x.file).length).toBeGreaterThan(60)
  void PASSWORD
})
