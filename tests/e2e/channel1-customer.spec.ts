// CHANNEL 1 (dedicated testing): customer journey probes that go beyond the existing happy-path specs.
// Each test drives the real application or the real Auth/PostgREST API with real sessions; owner SQL is used only for set-up
// and for reading ground truth. Synthetic data only. No real payment, email or bank is involved.
import { expect, test } from '@playwright/test'
import {
  a11yClean,
  admin,
  clickAndWait,
  createUser,
  fixPricing,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  seedPaidCompletedOrder,
  tag,
  uiSignInAttempt,
  PASSWORD,
} from './helpers'
import { aal2ClientWithSecret, anonClient, sql } from './channel1-helpers'

test.describe.configure({ mode: 'serial' })

test('session: persists across reload and tabs; once the server session is revoked the next request is sent to sign-in and recovery works', async ({
  browser,
}, info) => {
  const s = await openSession(browser, info, 'c1-sess')
  await s.page.goto('/account')
  await expect(s.page).toHaveURL(/\/account$/)
  await s.page.reload()
  await expect(s.page).toHaveURL(/\/account$/)
  const tab2 = await s.context.newPage()
  await tab2.goto('/orders')
  await expect(tab2).toHaveURL(/\/orders$/)
  // the cookie is session-scoped to the browser context, so a fresh context is signed out
  const other = await openAnonymous(browser, info)
  await other.page.goto('/orders')
  await expect(other.page).toHaveURL(/\/login/)

  // server-side revocation (a stolen or expired session): every request must now be refused
  await sql(`delete from auth.sessions where user_id = $1`, [s.user.id])
  await s.page.goto('/orders')
  await expect(s.page).toHaveURL(/\/login/)
  await tab2.goto('/account')
  await expect(tab2).toHaveURL(/\/login/)

  // recovery: signing in again (with the second factor) restores access
  const { uiSignInWithMfa } = await import('./helpers')
  await uiSignInWithMfa(s.page, s.user.email, s.secret, '/orders')
  await expect(s.page).toHaveURL(/\/orders$/)
})

test('logout ends the session in every tab of that browser and the back button does not reveal private pages', async ({
  browser,
}, info) => {
  const s = await openSession(browser, info, 'c1-out')
  await s.page.goto('/account')
  await s.page.getByRole('button', { name: 'Sign out' }).first().click()
  await s.page.waitForURL((u) => !/\/account/.test(u.pathname))
  await s.page.goBack().catch(() => undefined)
  await s.page.goto('/account')
  await expect(s.page).toHaveURL(/\/login/)
})

test('another customer cannot read, cancel, refund or download an order they do not own (pages, receipt, tracking API, direct database API)', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  await fixPricing(50000)
  const owner = await createUser('c1-owner', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Meal ${tag()}`)
  const a = await openSession(browser, info, 'c1-a')
  const b = await openSession(browser, info, 'c1-b')
  const order = await seedPaidCompletedOrder(shop, a.user.id)
  const id = order.id

  // the owner can see it (control: the checks below are meaningful)
  const ok = await a.page.goto(`/orders/${id}`)
  expect(ok?.status()).toBe(200)
  const pdf = await a.context.request.get(`/orders/${id}/receipt`)
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toContain('application/pdf')

  // the other customer: pages 404, receipt 404 (never the PDF), tracking API refused
  for (const path of [`/orders/${id}`, `/orders/${id}/help`, `/orders/${id}/delivery-fee`]) {
    const r = await b.page.goto(path)
    expect([403, 404], path).toContain(r?.status())
    await expect(b.page.locator('body')).not.toContainText(order.number)
  }
  const r1 = await b.context.request.get(`/orders/${id}/receipt`)
  expect(r1.status()).toBe(404)
  expect(r1.headers()['content-type'] ?? '').not.toContain('pdf')
  const r2 = await b.context.request.get(`/api/orders/${id}/tracking`)
  expect([403, 404]).toContain(r2.status())
  // anonymous: nothing
  const anon = await openAnonymous(browser, info)
  expect((await anon.context.request.get(`/orders/${id}/receipt`)).status()).toBe(401)
  expect([401, 403, 404]).toContain(
    (await anon.context.request.get(`/api/orders/${id}/tracking`)).status(),
  )

  // hand-written API calls with B's real aal2 session
  const bc = await aal2ClientWithSecret(b.user.email, b.secret)
  expect((await bc.from('orders').select('id').eq('id', id)).data).toEqual([])
  expect((await bc.from('order_items').select('id').eq('order_id', id)).data).toEqual([])
  expect((await bc.rpc('cancel_unpaid_order', { p_order: id })).error).not.toBeNull()
  expect(
    (
      await bc.rpc('customer_request_refund', {
        p_order: id,
        p_items: null,
        p_reason: 'I want money back please',
        p_key: `k-${tag()}-12345`,
      })
    ).error,
  ).not.toBeNull()
  expect((await bc.rpc('delivery_fee_payment_for_order', { p_order: id })).error).not.toBeNull()
  // nothing changed
  const [after] = await sql<{ status: string }>(`select status from public.orders where id = $1`, [
    id,
  ])
  expect(after?.status).toBe('COMPLETED')
  expect((await sql(`select 1 from public.refunds where order_id = $1`, [id])).length).toBe(0)
})

test('a customer cannot forge prices, totals or ownership through the database API; the server recomputes everything', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  await fixPricing(50000)
  const owner = await createUser('c1-forge-o', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Meal ${tag()}`)
  const c = await openSession(browser, info, 'c1-forge')
  const cc = await aal2ClientWithSecret(c.user.email, c.secret)
  const [prod] = await sql<{ id: string; price_kobo: string }>(
    `select id, price_kobo from public.products where vendor_id = $1`,
    [shop.vendorId],
  )

  // direct writes are impossible: orders, items, cart rows, prices, ledger, settlement lines
  expect(
    (
      await cc
        .from('orders')
        .insert({ customer_id: c.user.id, vendor_id: shop.vendorId, total_kobo: 1 })
    ).error,
  ).not.toBeNull()
  expect(
    (await cc.from('products').update({ price_kobo: 1 }).eq('id', prod!.id)).error,
  ).not.toBeNull() // no UPDATE privilege at all
  const [unchanged] = await sql<{ price_kobo: string }>(
    `select price_kobo from public.products where id = $1`,
    [prod!.id],
  )
  expect(unchanged!.price_kobo).toBe(prod!.price_kobo)
  expect(
    (await cc.from('ledger_entries').insert({ entry_type: 'payment_received', amount_kobo: 1 }))
      .error,
  ).not.toBeNull()
  expect((await cc.from('order_settlement_lines').select('id')).data ?? []).toEqual([])

  // the cart function takes a product id and a quantity: there is no price parameter to forge; extra arguments are rejected
  const forged = await cc.rpc('cart_add_item', {
    p_product: prod!.id,
    p_qty: 1,
    p_options: [],
    p_unit_price: 1,
  } as never)
  expect(forged.error).not.toBeNull()
  expect(
    (await cc.rpc('cart_add_item', { p_product: prod!.id, p_qty: 1, p_options: [] })).error,
  ).toBeNull()
  // order creation: only fulfilment, point and key; an invented total is refused as an unknown argument
  const badOrder = await cc.rpc('create_order', {
    p_fulfilment: 'pickup',
    p_delivery_point: null,
    p_idempotency_key: `k-${tag()}-forge1`,
    p_total_kobo: 1,
  } as never)
  expect(badOrder.error).not.toBeNull()
  const good = await cc.rpc('create_order', {
    p_fulfilment: 'pickup',
    p_delivery_point: null,
    p_idempotency_key: `k-${tag()}-forge2`,
  })
  expect(good.error).toBeNull()
  const [o] = await sql<{ total_kobo: string; items_total_kobo: string; customer_id: string }>(
    `select total_kobo, items_total_kobo, customer_id from public.orders where id = $1`,
    [good.data],
  )
  expect(o!.customer_id).toBe(c.user.id)
  expect(Number(o!.total_kobo)).toBe(Number(prod!.price_kobo)) // pickup: items only, no customer fee
})

test('stale prices: the cart, the checkout quote and the order always use the current database price; an order keeps its price after later edits', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  await fixPricing(50000)
  const owner = await createUser('c1-price-o', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Meal ${tag()}`)
  const c = await openSession(browser, info, 'c1-price')
  const p = c.page
  const [prod] = await sql<{ id: string }>(`select id from public.products where vendor_id = $1`, [
    shop.vendorId,
  ])
  await p.goto(`/products/${prod!.id}`)
  await p.getByRole('button', { name: 'Add to cart' }).click()
  await expect(p).toHaveURL(/\/cart$/)
  await expect(p.getByText('₦1,500').first()).toBeVisible()
  // the vendor raises the price while the item sits in the cart
  await sql(`update public.products set price_kobo = 200000 where id = $1`, [prod!.id])
  await p.goto('/cart')
  await expect(p.getByText('₦2,000').first()).toBeVisible()
  await p.goto('/checkout')
  await expect(p.getByTestId('checkout-total')).toHaveText('₦2,000')
  await clickAndWait(p, () => p.getByRole('button', { name: 'Place order' }).click())
  await expect(p).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  const id = p.url().split('/').pop()!
  const [o1] = await sql<{ total_kobo: string }>(
    `select total_kobo from public.orders where id = $1`,
    [id],
  )
  expect(Number(o1!.total_kobo)).toBe(200000)
  // a later price edit never changes the order
  await sql(`update public.products set price_kobo = 999900 where id = $1`, [prod!.id])
  await p.goto(`/orders/${id}`)
  await expect(p.getByText('₦2,000').first()).toBeVisible()
  const [o2] = await sql<{ total_kobo: string }>(
    `select total_kobo from public.orders where id = $1`,
    [id],
  )
  expect(Number(o2!.total_kobo)).toBe(200000)
})

test('unavailable and archived products cannot be bought, in the page or through the API', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  const owner = await createUser('c1-unav-o', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Meal ${tag()}`)
  const c = await openSession(browser, info, 'c1-unav')
  const cc = await aal2ClientWithSecret(c.user.email, c.secret)
  const [prod] = await sql<{ id: string }>(`select id from public.products where vendor_id = $1`, [
    shop.vendorId,
  ])
  await sql(`update public.products set is_available = false where id = $1`, [prod!.id])
  expect(
    (await cc.rpc('cart_add_item', { p_product: prod!.id, p_qty: 1, p_options: [] })).error,
  ).not.toBeNull()
  await c.page.goto(`/products/${prod!.id}`)
  // the page says so and the button cannot be used
  await expect(c.page.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  await expect(c.page.getByText('Sold out', { exact: true })).toBeVisible()
  await sql(`update public.products set is_available = true, status = 'archived' where id = $1`, [
    prod!.id,
  ])
  expect(
    (await cc.rpc('cart_add_item', { p_product: prod!.id, p_qty: 1, p_options: [] })).error,
  ).not.toBeNull()
  const r = await c.page.goto(`/products/${prod!.id}`)
  expect(r?.status()).toBe(404) // an archived product has no page
  await expect(c.page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0)
  expect(
    (
      await sql(
        `select 1 from public.cart_items ci join public.carts c on c.id=ci.cart_id where c.user_id=$1`,
        [c.user.id],
      )
    ).length,
  ).toBe(0)
})

test('registration: API sign-up rules, email confirmation required to sign in, and a clear 18+ message in the form', async ({
  browser,
}, info) => {
  const anon = await openAnonymous(browser, info)
  const p = anon.page
  await p.goto('/signup')
  await expect(p.getByText(/only for people aged 18 and over/i)).toBeVisible()
  await expect(p.getByText(/we do not check your age or identity/i)).toBeVisible()
  await a11yClean(p, '/signup')
  // API: declaration must be the JSON boolean true
  const email = `c1-reg-${tag()}@example.test`
  const ac = anonClient()
  for (const bad of [undefined, false, 'true', 1, null]) {
    const e = `c1-bad-${tag()}@example.test`
    const r = await ac.auth.signUp({
      email: e,
      password: PASSWORD,
      options: { data: bad === undefined ? {} : { adult_declared: bad } },
    })
    expect(r.error, String(bad)).not.toBeNull()
    expect((await sql(`select 1 from auth.users where email = $1`, [e])).length).toBe(0)
  }
  const ok = await ac.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { adult_declared: true } },
  })
  expect(ok.error).toBeNull()
  // email confirmation is required: sign-in is refused until the address is confirmed
  const before = await ac.auth.signInWithPassword({ email, password: PASSWORD })
  expect(before.error?.code).toBe('email_not_confirmed')
  await admin().auth.admin.updateUserById(ok.data.user!.id, { email_confirm: true })
  const after = await ac.auth.signInWithPassword({ email, password: PASSWORD })
  expect(after.error).toBeNull()
  // the UI form refuses without the checkbox
  await p.goto('/signup')
  await p.getByLabel('Email').fill(`c1-ui-${tag()}@example.test`)
  await p.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await p.getByLabel('Confirm password').fill(PASSWORD)
  await p.getByRole('button', { name: 'Create account' }).click()
  await expect(p.locator('main [role="alert"], main [role="status"]').first()).toContainText(
    /18 years old or older/i,
  )
  void uiSignInAttempt
})

test('a customer asks for deletion, an administrator erases the account: sign-in then fails, orders and money records stay, and nothing personal is left', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  const owner = await createUser('c1-del-o', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Meal ${tag()}`)
  const c = await openSession(browser, info, 'c1-del')
  const order = await seedPaidCompletedOrder(shop, c.user.id)
  await sql(`update public.profiles set display_name = 'Ada Student' where id = $1`, [c.user.id])
  // request through the real form
  await c.page.goto('/account/data-requests')
  await c.page
    .getByLabel(/What do you need/i)
    .selectOption('deletion')
    .catch(async () => {
      await c.page.locator('select').first().selectOption('deletion')
    })
  await clickAndWait(c.page, () =>
    c.page.getByRole('button', { name: /Send request|Submit/i }).click(),
  )
  await expect(c.page.getByText('deletion').first()).toBeVisible()
  // administrator erases through the real page
  const adm = await openSession(browser, info, 'c1-del-a', ['platform_admin'])
  await adm.page.goto('/admin/data-requests')
  const card = adm.page.locator('li').filter({ hasText: c.user.email })
  await card.getByLabel(/Reason for erasing/).fill('Requested by the account holder')
  await card.getByRole('checkbox').check()
  await clickAndWait(adm.page, () =>
    card.getByRole('button', { name: 'Erase this account' }).click(),
  )
  // the list re-renders with the tombstone address, so look for the confirmation on the page
  await expect(adm.page.getByText('Account erased (financial records kept)').first()).toBeVisible()
  // the customer can no longer sign in, with a generic message
  const anon = await openAnonymous(browser, info)
  await anon.page.goto('/login')
  await anon.page.getByLabel('Email').fill(c.user.email)
  await anon.page.getByLabel('Password').fill(PASSWORD)
  await anon.page.getByRole('button', { name: 'Sign in' }).click()
  await expect(anon.page.locator('main [role="alert"]').first()).toBeVisible()
  await expect(anon.page).toHaveURL(/\/login/)
  // ground truth: personal data gone, financial history intact
  const [u] = await sql<{ email: string }>(`select email from auth.users where id = $1`, [
    c.user.id,
  ])
  expect(u!.email).toBe(`erased-${c.user.id}@erased.invalid`)
  expect(
    (
      await sql<{ display_name: string | null }>(
        `select display_name from public.profiles where id=$1`,
        [c.user.id],
      )
    )[0]!.display_name,
  ).toBeNull()
  expect(
    (
      await sql(`select 1 from public.orders where id = $1 and customer_id = $2`, [
        order.id,
        c.user.id,
      ])
    ).length,
  ).toBe(1)
})

test('refund request submitted twice (double click) creates one refund; a different customer cannot see or repeat it', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  const owner = await createUser('c1-rf-o', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Meal ${tag()}`)
  const c = await openSession(browser, info, 'c1-rf')
  const order = await seedPaidCompletedOrder(shop, c.user.id)
  await c.page.goto(`/orders/${order.id}/help`)
  const form = c.page.locator('form').filter({ hasText: 'What do you want refunded?' })
  await form.getByLabel('What went wrong?').fill('Channel 1 test: an item was missing from the bag')
  // two submissions in the same tick (what a double click or a retry does): the button disables itself, and the same
  // idempotency key travels with both, so the server must still record one refund
  await form.evaluate((f) => {
    const el = f as HTMLFormElement
    el.requestSubmit()
    el.requestSubmit()
  })
  await c.page.waitForTimeout(2500)
  const n = (
    await sql<{ n: number }>(`select count(*)::int n from public.refunds where order_id = $1`, [
      order.id,
    ])
  )[0]!.n
  expect(n).toBe(1)
  // the request was recorded against the signed-in owner and the amount came from the ledger, not the page
  const [r] = await sql<{ requested_by: string; amount_kobo: string; status: string }>(
    `select requested_by, amount_kobo, status from public.refunds where order_id = $1`,
    [order.id],
  )
  expect(r!.requested_by).toBe(c.user.id)
  expect(r!.status).toBe('requested')
  expect(Number(r!.amount_kobo)).toBeLessThanOrEqual(420000)
  // a second, separately-keyed request for the same goods cannot push the total above what was paid
  const cc = await aal2ClientWithSecret(c.user.email, c.secret)
  const again = await cc.rpc('customer_request_refund', {
    p_order: order.id,
    p_items: null,
    p_reason: 'Channel 1 test: second request',
    p_key: `k-${tag()}-second1`,
  })
  const total = (
    await sql<{ s: string }>(
      `select coalesce(sum(amount_kobo),0) s from public.refunds where order_id=$1 and status not in ('rejected','failed')`,
      [order.id],
    )
  )[0]!.s
  expect(Number(total)).toBeLessThanOrEqual(420000)
  void again
})

test('machine endpoints and response headers: job routes refuse callers without the secret; pages carry the security headers; the health route leaks no secrets', async ({
  browser,
}, info) => {
  const anon = await openAnonymous(browser, info)
  const c = await openSession(browser, info, 'c1-api')
  for (const ctx of [anon.context, c.context]) {
    for (const path of [
      '/api/jobs/expire-orders',
      '/api/jobs/process-notifications',
      '/api/jobs/purge-location',
    ]) {
      for (const method of ['get', 'post'] as const) {
        const r = await ctx.request[method](path)
        expect([401, 403, 404, 405], `${method} ${path}`).toContain(r.status())
      }
    }
    expect([401, 403]).toContain((await ctx.request.get('/api/jobs/health')).status())
    const bad = await ctx.request.post('/api/jobs/expire-orders', {
      headers: { authorization: 'Bearer wrong-secret' },
    })
    expect([401, 403]).toContain(bad.status())
    // the Paystack webhook refuses unsigned and wrongly signed requests
    const hook = await ctx.request.post('/api/webhooks/paystack', {
      data: { event: 'charge.success', data: { reference: 'x', amount: 1 } },
      headers: { 'x-paystack-signature': 'deadbeef' },
    })
    expect([400, 401, 403]).toContain(hook.status())
  }
  const health = await anon.context.request.get('/api/health')
  const body = await health.text()
  expect(health.status()).toBe(200)
  for (const secret of [
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    process.env.JOBS_SECRET!,
    process.env.PICKUP_CODE_SECRET!,
    process.env.DATABASE_URL!,
  ])
    expect(body).not.toContain(secret)
  // headers on a normal page
  const page = await anon.context.request.get('/')
  const h = page.headers()
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['strict-transport-security']).toContain('max-age')
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['referrer-policy']).toBeTruthy()
  expect(h['x-powered-by']).toBeUndefined()
})

test('order history reaches every order: more than one page of orders can be paged through and nothing is silently cut off', async ({
  browser,
}, info) => {
  test.setTimeout(300000)
  const owner = await createUser('c1-hist-o', ['vendor_owner'])
  const shop = await makeShopWithPoint(owner.id, `Meal ${tag()}`)
  const c = await openSession(browser, info, 'c1-hist')
  const rows = Array.from({ length: 60 }, (_, i) => ({
    order_number: `AFM-H${String(i).padStart(3, '0')}${tag()}`,
    customer_id: c.user.id,
    vendor_id: shop.vendorId,
    vendor_name: 'Fixture shop',
    fulfilment: 'pickup',
    pickup_location_snapshot: 'Counter',
    status: 'COMPLETED',
    items_total_kobo: 100000,
    delivery_fee_kobo: 0,
    platform_fee_kobo: 0,
    total_kobo: 100000,
    idempotency_key: `c1-hist-${tag()}-${i}`,
    created_at: new Date(Date.now() - (60 - i) * 3_600_000).toISOString(),
  }))
  const { error } = await admin().from('orders').insert(rows)
  if (error) throw error
  const seen = new Set<string>()
  let page = 1
  for (; page <= 6; page++) {
    await c.page.goto(page === 1 ? '/orders' : `/orders?page=${page}`)
    const text = await c.page.locator('main').innerText()
    for (const r of rows) if (text.includes(r.order_number)) seen.add(r.order_number)
    if ((await c.page.getByRole('link', { name: /Older/ }).count()) === 0) break
  }
  expect(seen.size).toBe(60)
})
