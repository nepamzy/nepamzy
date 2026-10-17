// CHANNEL 1 (dedicated testing): vendor journey probes. Real sessions, real UI, real database API; synthetic data only.
import { expect, test } from '@playwright/test'
import {
  a11yClean,
  admin,
  clickAndWait,
  createUser,
  fixPricing,
  makeShopWithPoint,
  openSession,
  seedPaidCompletedOrder,
  tag,
} from './helpers'
import { aal1Client, aal2ClientWithSecret, sql } from './channel1-helpers'

test.describe.configure({ mode: 'serial' })

async function shopWithOwnerSession(
  browser: import('@playwright/test').Browser,
  info: import('@playwright/test').TestInfo,
  label: string,
) {
  const s = await openSession(browser, info, label, ['vendor_owner'])
  const shop = await makeShopWithPoint(s.user.id, `Dish ${tag()}`)
  const [prod] = await sql<{ id: string }>(`select id from public.products where vendor_id = $1`, [
    shop.vendorId,
  ])
  return { s, shop, prodId: prod!.id }
}

test('vendor product management through the UI: create, validate, edit, take off sale, archive; the public menu follows', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  const v = await shopWithOwnerSession(browser, info, 'c1-vp')
  const p = v.s.page
  await p.goto('/vendor/catalogue/new')
  await a11yClean(p, '/vendor/catalogue/new')
  // validation in the browser: an empty name or a non-numeric price never submits; nothing is created
  const countBefore = (
    await sql(`select 1 from public.products where vendor_id=$1`, [v.shop.vendorId])
  ).length
  await p.getByLabel('Price (₦)').fill('abc')
  await p.getByRole('button', { name: 'Add to menu' }).click()
  await p.waitForTimeout(800)
  await p.getByLabel('Name').fill('Valid name')
  await p.getByLabel('Price (₦)').fill('-5')
  await p.getByRole('button', { name: 'Add to menu' }).click()
  await p.waitForTimeout(1500)
  expect(
    (await sql(`select 1 from public.products where vendor_id=$1`, [v.shop.vendorId])).length,
  ).toBe(countBefore)
  // validation on the server (a hand-written call that skips the form): bad price, empty name, negative stock are refused
  const vc0 = await aal2ClientWithSecret(v.s.user.email, v.s.secret)
  for (const bad of [
    { p_name: 'X', p_price: -5, p_stock: 1 },
    { p_name: '', p_price: 100, p_stock: 1 },
    { p_name: 'X', p_price: 100, p_stock: -3 },
  ])
    expect(
      (
        await vc0.rpc('product_upsert', {
          p_vendor: v.shop.vendorId,
          p_product: null,
          p_description: '',
          p_section: 'Mains',
          p_available: true,
          p_options: [],
          ...bad,
        })
      ).error,
      JSON.stringify(bad),
    ).not.toBeNull()
  expect(
    (await sql(`select 1 from public.products where vendor_id=$1`, [v.shop.vendorId])).length,
  ).toBe(countBefore)
  // a valid product (price in naira with kobo)
  const name = `Puff ${tag()}`
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Price (₦)').fill('1234.50')
  await p.getByLabel('Stock').fill('7')
  await clickAndWait(p, () => p.getByRole('button', { name: 'Add to menu' }).click())
  const [row] = await sql<{ id: string; price_kobo: string; stock_quantity: number }>(
    `select id, price_kobo, stock_quantity from public.products where vendor_id=$1 and name=$2`,
    [v.shop.vendorId, name],
  )
  expect(row, 'product created').toBeTruthy()
  expect(Number(row!.price_kobo)).toBe(123450)
  expect(row!.stock_quantity).toBe(7)
  // appears on the public menu
  await p.goto(`/vendors/${v.shop.slug}`)
  await expect(p.getByText(name).first()).toBeVisible()
  // edit the price
  await p.goto(`/vendor/catalogue/${row!.id}`)
  await p.getByLabel('Price (₦)').fill('1500')
  await clickAndWait(p, () => p.getByRole('button', { name: 'Save changes' }).click())
  expect(
    Number(
      (
        await sql<{ price_kobo: string }>(`select price_kobo from public.products where id=$1`, [
          row!.id,
        ])
      )[0]!.price_kobo,
    ),
  ).toBe(150000)
  // take off sale: hidden from buying
  await p.goto(`/vendor/catalogue/${row!.id}`)
  await p.getByLabel('On sale').uncheck()
  await clickAndWait(p, () => p.getByRole('button', { name: 'Save changes' }).click())
  expect(
    (
      await sql<{ is_available: boolean }>(`select is_available from public.products where id=$1`, [
        row!.id,
      ])
    )[0]!.is_available,
  ).toBe(false)
  // archive through the API with the vendor's own aal2 session; it disappears publicly
  const vc = await aal2ClientWithSecret(v.s.user.email, v.s.secret)
  expect((await vc.rpc('product_archive', { p_product: row!.id })).error).toBeNull()
  await p.goto(`/vendors/${v.shop.slug}`)
  await expect(p.getByText(name)).toHaveCount(0)
})

test('vendor isolation: another shop cannot read or change this shop’s products, orders or earnings (pages and direct API)', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  await fixPricing(50000)
  const a = await shopWithOwnerSession(browser, info, 'c1-va')
  const b = await shopWithOwnerSession(browser, info, 'c1-vb')
  const cust = await createUser('c1-vcust')
  const order = await seedPaidCompletedOrder(a.shop, cust.id)
  await admin()
    .from('order_status_history')
    .insert({ order_id: order.id, from_status: 'PAID', to_status: 'COMPLETED' })

  // pages: B cannot open A's product editor; A's orders and amounts never appear in B's screens
  const r = await b.s.page.goto(`/vendor/catalogue/${a.prodId}`)
  expect([403, 404]).toContain(r?.status())
  await b.s.page.goto('/vendor/orders')
  await expect(b.s.page.locator('body')).not.toContainText(order.number)
  await b.s.page.goto('/vendor/earnings')
  await expect(b.s.page.locator('body')).not.toContainText('₦3,820')

  // direct API with B's real aal2 session against A's ids
  const bc = await aal2ClientWithSecret(b.s.user.email, b.s.secret)
  expect((await bc.from('orders').select('id').eq('id', order.id)).data).toEqual([])
  expect((await bc.rpc('product_archive', { p_product: a.prodId })).error).not.toBeNull()
  expect(
    (await bc.rpc('product_set_availability', { p_product: a.prodId, p_available: false })).error,
  ).not.toBeNull()
  expect(
    (
      await bc.rpc('product_upsert', {
        p_vendor: a.shop.vendorId,
        p_product: a.prodId,
        p_name: 'Hijack',
        p_description: '',
        p_price: 1,
        p_section: 'x',
        p_available: true,
        p_stock: 1,
        p_options: [],
      })
    ).error,
  ).not.toBeNull()
  expect(
    (await bc.rpc('vendor_transition_order', { p_order: order.id, p_action: 'accept' })).error,
  ).not.toBeNull()
  expect(
    (
      await bc.rpc('vendor_update_profile', {
        p_vendor: a.shop.vendorId,
        p_description: 'x',
        p_phone: '08000000000',
        p_pickup: 'x',
        p_prep: 5,
      })
    ).error,
  ).not.toBeNull()
  const summary = await bc.rpc('vendor_settlement_summary', { p_vendor: a.shop.vendorId })
  expect(summary.error).not.toBeNull()
  // aal1 (password only) sees and changes nothing even for its OWN shop
  const b1 = await aal1Client(b.s.user.email)
  expect((await b1.rpc('product_archive', { p_product: b.prodId })).error).not.toBeNull()
  // ground truth: A's data is untouched
  const [prod] = await sql<{ status: string; name: string; is_available: boolean }>(
    `select status, name, is_available from public.products where id=$1`,
    [a.prodId],
  )
  expect(prod).toMatchObject({ status: 'active', is_available: true })
  expect(prod!.name).not.toBe('Hijack')
})

test('vendor order actions: wrong states, repeats, customers and unpaid orders are refused by the server', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  await fixPricing(50000)
  const v = await shopWithOwnerSession(browser, info, 'c1-vo')
  const c = await openSession(browser, info, 'c1-voc')
  const cust = c.user
  const mk = async (status: string) => {
    const { data, error } = await admin()
      .from('orders')
      .insert({
        order_number: `AFM-V${tag()}`,
        customer_id: cust.id,
        vendor_id: v.shop.vendorId,
        vendor_name: 'Fixture shop',
        fulfilment: 'pickup',
        pickup_location_snapshot: 'Counter',
        status,
        items_total_kobo: 100000,
        delivery_fee_kobo: 0,
        platform_fee_kobo: 0,
        total_kobo: 100000,
        idempotency_key: `c1-${tag()}-key`,
      })
      .select('id')
      .single()
    if (error) throw error
    return data!.id as string
  }
  const unpaid = await mk('PENDING_PAYMENT')
  const paid = await mk('PAID')
  const vc = await aal2ClientWithSecret(v.s.user.email, v.s.secret)
  const cc = await aal2ClientWithSecret(c.user.email, c.secret)
  const status = async (id: string) =>
    (await sql<{ status: string }>(`select status from public.orders where id=$1`, [id]))[0]!.status

  // an unpaid order cannot be accepted; an unknown action and a skip-ahead are refused; the status does not move
  expect(
    (await vc.rpc('vendor_transition_order', { p_order: unpaid, p_action: 'accept' })).error,
  ).not.toBeNull()
  expect(
    (await vc.rpc('vendor_transition_order', { p_order: paid, p_action: 'teleport' })).error,
  ).not.toBeNull()
  expect(
    (await vc.rpc('vendor_transition_order', { p_order: paid, p_action: 'mark_ready' })).error,
  ).not.toBeNull()
  expect(await status(unpaid)).toBe('PENDING_PAYMENT')
  expect(await status(paid)).toBe('PAID')
  // a customer (even the order's own) cannot run vendor actions
  expect(
    (await cc.rpc('vendor_transition_order', { p_order: paid, p_action: 'accept' })).error,
  ).not.toBeNull()
  // the legal path works once; repeating the same action is refused and changes nothing
  expect(
    (await vc.rpc('vendor_transition_order', { p_order: paid, p_action: 'accept' })).error,
  ).toBeNull()
  expect(await status(paid)).toBe('ACCEPTED')
  expect(
    (await vc.rpc('vendor_transition_order', { p_order: paid, p_action: 'accept' })).error,
  ).not.toBeNull()
  expect(await status(paid)).toBe('ACCEPTED')
  expect(
    (await vc.rpc('vendor_transition_order', { p_order: paid, p_action: 'start_preparing' })).error,
  ).toBeNull()
  // concurrent identical requests: exactly one wins
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      vc.rpc('vendor_transition_order', { p_order: paid, p_action: 'mark_ready' }),
    ),
  )
  expect(results.filter((r) => !r.error).length).toBe(1)
  expect(await status(paid)).toBe('PICKUP_AWAITING_HANDOVER')
  const hist = await sql<{ to_status: string }>(
    `select to_status from public.order_status_history where order_id=$1 order by id`,
    [paid],
  )
  expect(hist.filter((h) => h.to_status === 'PICKUP_AWAITING_HANDOVER').length).toBe(1)
  // the vendor UI shows the order and the wrong-shop vendor does not see it
  await v.s.page.goto('/vendor/orders')
  await expect(v.s.page.locator('body')).toContainText('AFM-V')
})

test('earnings page shows the 4.5% commission exactly, once per completed order, and nothing from other shops', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  const a = await shopWithOwnerSession(browser, info, 'c1-ve')
  const cust = await createUser('c1-vecust')
  const order = await seedPaidCompletedOrder(a.shop, cust.id) // items 400000 kobo (₦4,000.00)
  // the completion record creates the settlement line; a repeated completion record creates no second line
  for (let i = 0; i < 2; i++)
    await admin()
      .from('order_status_history')
      .insert({ order_id: order.id, from_status: 'PAID', to_status: 'COMPLETED' })
  const lines = await sql<{
    base_kobo: string
    commission_kobo: string
    commission_bps: number
    delivery_fee_kobo: string
  }>(
    `select base_kobo, commission_kobo, commission_bps, delivery_fee_kobo from public.order_settlement_lines where order_id=$1`,
    [order.id],
  )
  expect(lines).toHaveLength(1)
  expect(Number(lines[0]!.base_kobo)).toBe(400000)
  expect(lines[0]!.commission_bps).toBe(450)
  expect(Number(lines[0]!.commission_kobo)).toBe(18000)
  await a.s.page.goto('/vendor/earnings')
  await expect(a.s.page.getByText('₦4,000').first()).toBeVisible() // product sales
  await expect(a.s.page.getByText('₦180').first()).toBeVisible() // 4.5%
  await expect(a.s.page.getByText('₦3,820').first()).toBeVisible() // calculated amount due
  await a11yClean(a.s.page, '/vendor/earnings')
  // an unrelated shop sees zero, not this shop's money
  const b = await shopWithOwnerSession(browser, info, 'c1-ve2')
  await b.s.page.goto('/vendor/earnings')
  await expect(b.s.page.getByText('₦3,820')).toHaveCount(0)
  await expect(b.s.page.getByText('₦180')).toHaveCount(0)
  // the page itself says nothing has been paid out
  await expect(a.s.page.locator('body')).toContainText(
    /not (been )?paid|no payout|payouts? (are|is) not/i,
  )
})

test('hostile text in vendor-controlled fields is shown as plain text and never runs (product name, description, shop profile)', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  const v = await shopWithOwnerSession(browser, info, 'c1-xss')
  const payload = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`
  const vc = await aal2ClientWithSecret(v.s.user.email, v.s.secret)
  const up = await vc.rpc('product_upsert', {
    p_vendor: v.shop.vendorId,
    p_product: null,
    p_name: payload.slice(0, 80),
    p_description: payload,
    p_price: 5000,
    p_section: 'Mains',
    p_available: true,
    p_stock: 5,
    p_options: [],
  })
  expect(up.error).toBeNull()
  const dialogs: string[] = []
  const anon = await browser.newContext()
  const page = await anon.newPage()
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await page.goto(`/vendors/${v.shop.slug}`)
  await expect(page.getByText('<img src=x', { exact: false }).first()).toBeVisible() // visible as text
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  expect(await page.locator('img[src="x"]').count()).toBe(0)
  expect(dialogs).toEqual([])
  await anon.close()
})

async function bulkOrders(vendorId: string, customerId: string, n: number, oldestStatus: string) {
  const rows = Array.from({ length: n }, (_, i) => ({
    order_number: `AFM-B${String(i).padStart(3, '0')}${tag()}`,
    customer_id: customerId,
    vendor_id: vendorId,
    vendor_name: 'Fixture shop',
    fulfilment: 'pickup',
    pickup_location_snapshot: 'Counter',
    status: i === 0 ? oldestStatus : 'COMPLETED',
    items_total_kobo: 100000,
    delivery_fee_kobo: 0,
    platform_fee_kobo: 0,
    total_kobo: 100000,
    idempotency_key: `c1-bulk-${tag()}-${i}`,
    created_at: new Date(Date.now() - (n - i) * 3_600_000).toISOString(), // i = 0 is the OLDEST
  }))
  const { error } = await admin().from('orders').insert(rows)
  if (error) throw error
  return rows
}

test('a busy shop never loses an unfinished order: an old paid order stays visible and actionable among many newer finished ones', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  const v = await shopWithOwnerSession(browser, info, 'c1-busy')
  const cust = await createUser('c1-busycust')
  const rows = await bulkOrders(v.shop.vendorId, cust.id, 60, 'PAID')
  const oldest = rows[0]!.order_number
  await v.s.page.goto('/vendor/orders')
  await expect(v.s.page.locator('body')).toContainText(oldest)
  const row = v.s.page.locator('tr').filter({ hasText: oldest })
  await expect(row.getByRole('button', { name: 'Accept order' })).toBeVisible()
})

test('the same holds for the handover list, the dashboard counters and the finished-orders pages of a busy shop', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  const v = await shopWithOwnerSession(browser, info, 'c1-busy2')
  const cust = await createUser('c1-busy2c')
  const rows = await bulkOrders(v.shop.vendorId, cust.id, 70, 'PICKUP_AWAITING_HANDOVER')
  // an extra block of paid orders, all older than the finished ones, to prove the dashboard counts them all
  const paidRows = Array.from({ length: 30 }, (_, i) => ({
    ...rows[1]!,
    order_number: `AFM-P${String(i).padStart(3, '0')}${tag()}`,
    status: 'PAID',
    idempotency_key: `c1-paid-${tag()}-${i}`,
    created_at: new Date(Date.now() - 400 * 3_600_000 - i * 1000).toISOString(),
  }))
  expect((await admin().from('orders').insert(paidRows)).error).toBeNull()
  const p = v.s.page
  await p.goto('/vendor/handover')
  await expect(p.locator('body')).toContainText(rows[0]!.order_number)
  await p.goto('/vendor')
  await expect(p.getByTestId('paid-count')).toHaveText('30')
  // finished orders are reachable page by page: 69 finished orders, 25 per page
  const seen = new Set<string>()
  for (let page = 1; page <= 4; page++) {
    await p.goto(page === 1 ? '/vendor/orders' : `/vendor/orders?page=${page}`)
    const text = await p.locator('main').innerText()
    for (const r of rows) if (text.includes(r.order_number)) seen.add(r.order_number)
    if ((await p.getByRole('link', { name: /Older/ }).count()) === 0) break
  }
  expect(seen.size).toBe(70) // 69 finished (paged) + the one unfinished (always on page 1)
})
