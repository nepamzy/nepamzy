import { spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import {
  PASSWORD,
  SUPABASE_URL,
  admin,
  alertIn,
  clickAndWait,
  createUser,
  enrolFactorViaApi,
  fixPricing,
  freshCode,
  openAnonymous,
  openSession,
  statusIn,
  tag,
  uiSignIn,
  uiSignInWithMfa,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const DAYS = [0, 1, 2, 3, 4, 5, 6]

test('vendor onboarding -> catalogue -> customer checkout -> test payment -> vendor sees order -> suspension', async ({
  browser,
}, info) => {
  test.setTimeout(240000)
  await fixPricing(50000)
  const t = tag()
  const shop = `Suya Spot ${t}`
  const item = `Suya ${t}`

  // 1. A registered customer (MFA done) applies to become a vendor.
  const applicant = await openSession(browser, info, 'applicant')
  await applicant.page.goto('/apply')
  await applicant.page.getByLabel('Business name').fill(shop)
  await applicant.page.getByLabel('Category').selectOption({ label: 'Food' })
  await applicant.page.getByLabel('Contact phone').fill('08012345678')
  await applicant.page
    .getByLabel('What do you sell?')
    .fill('Grilled suya and sides for the campus community')
  await applicant.page
    .getByLabel('Where will customers collect orders?')
    .fill('Sample pickup bench (placeholder)')
  await applicant.page.getByLabel(/I agree to follow/).check()
  await clickAndWait(applicant.page, () =>
    applicant.page.getByRole('button', { name: 'Submit application' }).click(),
  )
  // the page re-renders into the "waiting for review" state
  await expect(
    applicant.page.getByText(`Your application for “${shop}” is waiting for review.`),
  ).toBeVisible()
  // not yet a vendor: the vendor area is closed to them
  expect((await applicant.page.goto('/vendor'))?.status()).toBe(403)

  // 2. An administrator (aal2) approves it.
  const adminS = await openSession(browser, info, 'padmin', ['platform_admin'])
  await adminS.page.goto('/admin/applications')
  const card = adminS.page.getByTestId('pending-application').filter({ hasText: shop })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(statusIn(adminS.page)).toContainText(/Decision saved/)

  // 3. The new vendor sets opening hours and adds a product with a required option.
  await applicant.page.goto('/vendor')
  await expect(applicant.page.getByRole('heading', { name: shop, exact: true })).toBeVisible()
  await applicant.page.goto('/vendor/profile')
  for (const d of DAYS) {
    await applicant.page.locator(`input[name="d${d}_open"]`).check()
    await applicant.page.locator(`input[name="d${d}_from"]`).fill('00:00')
    await applicant.page.locator(`input[name="d${d}_to"]`).fill('23:59')
  }
  await clickAndWait(applicant.page, () =>
    applicant.page.getByRole('button', { name: 'Save opening hours' }).click(),
  )
  await expect(statusIn(applicant.page)).toContainText(/Opening hours saved/)

  await applicant.page.goto('/vendor/catalogue/new')
  await applicant.page.getByLabel('Name', { exact: true }).fill(item)
  await applicant.page.getByLabel('Price (₦)').fill('1500')
  await applicant.page.getByLabel('Stock').fill('3')
  await applicant.page.getByLabel('Menu section').fill('Mains')
  await applicant.page.getByRole('button', { name: 'Add an option group' }).click()
  await applicant.page.getByLabel('Group name').fill('Size')
  await applicant.page.getByLabel('At least').fill('1')
  await applicant.page.getByLabel('At most').fill('1')
  await applicant.page.getByRole('textbox', { name: 'Choice 1' }).fill('Regular')
  await applicant.page.getByRole('button', { name: 'Add a choice' }).click()
  await applicant.page.getByRole('textbox', { name: 'Choice 2' }).fill('Large')
  await applicant.page.getByLabel('Extra (₦)').nth(1).fill('300')
  await applicant.page.getByRole('button', { name: 'Add to menu' }).click()
  await expect(applicant.page).toHaveURL(/\/vendor\/catalogue\/[0-9a-f-]{36}\?created=1/)
  const productId = applicant.page.url().match(/catalogue\/([0-9a-f-]{36})/)![1]!
  await expect(statusIn(applicant.page)).toContainText(/Item added/)

  // 4. An anonymous visitor can find and read it without an account, but cannot add to a cart yet.
  const anon = await openAnonymous(browser, info)
  await anon.page.goto(`/vendors?q=${encodeURIComponent(item)}`)
  await expect(anon.page.getByRole('link', { name: shop })).toBeVisible()
  await anon.page.getByRole('link', { name: item }).first().click()
  await expect(anon.page).toHaveURL(new RegExp(`/products/${productId}`))
  await expect(anon.page.getByText('Large (+₦300)')).toBeVisible()
  await anon.page.getByRole('radio', { name: 'Regular' }).check()
  await anon.page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(anon.page).toHaveURL(new RegExp(`/login\\?next=%2Fproducts%2F${productId}`))

  // 5. A customer without two-step sign-in (optional) signs in, fills a cart and goes straight to checkout.
  const email = (await createUser('buyer')).email
  await uiSignIn(anon.page, email, PASSWORD, `/products/${productId}`)
  await expect(anon.page).toHaveURL(new RegExp(`/products/${productId}`))
  await anon.page.getByRole('radio', { name: /Large/ }).check()
  await anon.page.getByLabel('Quantity').fill('2')
  await anon.page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(anon.page).toHaveURL(/\/cart$/)
  await expect(anon.page.getByText(item)).toBeVisible()
  await expect(anon.page.getByText('₦3,600').first()).toBeVisible() // 2 x (1500 + 300)
  await anon.page.getByRole('link', { name: 'Proceed to checkout' }).click()
  await expect(anon.page).toHaveURL(/\/checkout$/)

  // 6. Checkout shows server-calculated totals for both choices.
  await expect(anon.page.getByTestId('checkout-total')).toHaveText('₦3,600') // 3600, no customer service fee, pickup
  await anon.page.getByRole('radio', { name: /Delivery/ }).check()
  await expect(anon.page.getByTestId('checkout-total')).toHaveText('₦4,100') // + 500 delivery
  await anon.page.getByLabel('Delivery point', { exact: true }).selectOption({ index: 1 })
  await clickAndWait(anon.page, () =>
    anon.page.getByRole('button', { name: 'Place order' }).click(),
  )
  await expect(anon.page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  const orderUrl = anon.page.url()
  const orderId = orderUrl.split('/').pop()!
  await expect(anon.page.getByText('Payment needed')).toBeVisible()
  const { data: o } = await admin()
    .from('orders')
    .select('total_kobo, items_total_kobo, status, fulfilment')
    .eq('id', orderId)
    .single()
  expect(o).toEqual({
    total_kobo: 410000,
    items_total_kobo: 360000,
    status: 'PENDING_PAYMENT',
    fulfilment: 'delivery',
  })
  const { data: stock1 } = await admin()
    .from('products')
    .select('stock_quantity')
    .eq('id', productId)
    .single()
  expect(stock1!.stock_quantity).toBe(1) // 3 - 2 reserved while the order is unpaid

  // 7. Test payment (clearly labelled), then the order is PAID.
  await expect(anon.page.getByRole('button', { name: /Pay \(test only/ })).toBeVisible()
  await anon.page.getByRole('button', { name: /Pay \(test only/ }).click()
  await expect(anon.page.getByText('Payment received').first()).toBeVisible()
  await expect(anon.page.getByText('Test payment succeeded')).toBeVisible()
  await expect(anon.page.getByText('Payment needed')).toHaveCount(0)

  // 8. The vendor sees the paid order (read-only); a stranger cannot open it.
  await applicant.page.goto('/vendor/orders')
  await expect(applicant.page.getByRole('cell', { name: /AFM-\d{6}/ })).toBeVisible()
  await expect(applicant.page.getByRole('button', { name: 'Accept order' })).toBeVisible() // paid order is ready for the vendor to act on
  await applicant.page.goto('/vendor')
  await expect(applicant.page.getByTestId('paid-count')).toHaveText('1')
  await applicant.page.goto('/vendor/catalogue')
  await expect(applicant.page.getByText('1 in stock')).toBeVisible()
  const stranger = await openSession(browser, info, 'stranger')
  expect((await stranger.page.goto(orderUrl))?.status()).toBe(404)
  await expect(stranger.page.getByRole('heading', { name: /can.t find that page/i })).toBeVisible()

  // 9. Suspension takes effect immediately for the public and for the vendor's own session.
  await adminS.page.goto('/admin/vendors')
  const vcard = adminS.page.getByTestId('vendor-row').filter({ hasText: shop })
  await vcard.getByLabel('Reason (required)').fill('policy breach rehearsal')
  await vcard.getByRole('button', { name: 'Suspend' }).click()
  await expect(statusIn(adminS.page)).toContainText(/Status changed/)
  const fresh = await openAnonymous(browser, info)
  await fresh.page.goto(`/vendors?q=${encodeURIComponent(t)}`)
  await expect(fresh.page.getByText('No matches')).toBeVisible()
  const slug = (await admin().from('vendors').select('slug').eq('name', shop).single()).data!.slug
  expect((await fresh.page.goto(`/vendors/${slug}`))?.status()).toBe(404)
  expect((await fresh.page.goto(`/products/${productId}`))?.status()).toBe(404)
  await applicant.page.goto('/vendor/catalogue')
  await expect(applicant.page.getByRole('alert').filter({ hasText: /suspended/ })).toBeVisible()
  await expect(applicant.page.getByRole('link', { name: 'Add an item' })).toHaveCount(0)
  const { data: audit } = await admin()
    .from('audit_events')
    .select('action')
    .in('action', [
      'vendor_application.submitted',
      'vendor_application.approved',
      'vendor.status_changed',
      'product.created',
      'order.created',
      'order.mock_paid',
    ])
  expect(audit!.map((a) => a.action)).toEqual(
    expect.arrayContaining([
      'vendor_application.submitted',
      'vendor_application.approved',
      'vendor.status_changed',
      'product.created',
      'order.created',
      'order.mock_paid',
    ]),
  )
  for (const s of [applicant, adminS, stranger]) await s.context.close()
  await anon.context.close()
  await fresh.context.close()
})

test('browse, search and filter; cart rules (one vendor at a time, quantities, removal)', async ({
  browser,
}, info) => {
  test.setTimeout(120000)
  const anon = await openAnonymous(browser, info)
  const p = anon.page
  await p.goto('/vendors?q=print')
  await expect(p.getByRole('link', { name: 'Sample Print Shop' })).toBeVisible()
  await expect(p.getByRole('link', { name: 'Sample Kitchen' })).toHaveCount(0)
  await p.goto('/vendors?category=food')
  await expect(p.getByRole('link', { name: 'Sample Kitchen' })).toBeVisible()
  await expect(p.getByRole('link', { name: 'Sample Print Shop' })).toHaveCount(0)
  await p.goto('/vendors?open=1')
  await expect(p.getByRole('link', { name: 'Sample Souvenirs' })).toHaveCount(0)
  // (unfiltered pages show 24 vendors and other tests keep adding shops, so look it up by name)
  await p.goto('/vendors?q=Sample%20Souvenirs')
  await expect(p.getByRole('link', { name: 'Sample Souvenirs' })).toBeVisible()
  await expect(p.getByText('Closed now').first()).toBeVisible()
  for (const q of ['%25', '_', '%27%3B%20drop%20table', 'zzzz-nothing']) {
    await p.goto(`/vendors?q=${q}`)
    await expect(p.getByText('No matches')).toBeVisible()
  }
  await p.goto('/vendors?q=rice')
  await expect(p.getByRole('heading', { name: 'Matching items' })).toBeVisible()
  await expect(p.getByRole('link', { name: 'Jollof rice and chicken' })).toBeVisible()
  await p.goto('/vendors/sample-kitchen')
  await expect(p.getByText('Sold out').first()).toBeVisible() // bottled water
  await expect(p.getByText('Open now').first()).toBeVisible()
  await anon.context.close()

  const buyer = await openSession(browser, info, 'cartuser')
  const b = buyer.page
  await b.goto('/vendors/sample-kitchen')
  await b.getByRole('link', { name: 'Jollof rice and chicken' }).first().click()
  await b.getByRole('radio', { name: /Beef/ }).check()
  await b.getByRole('checkbox', { name: /Coleslaw/ }).check()
  await b.getByRole('button', { name: 'Add to cart' }).click()
  await expect(b).toHaveURL(/\/cart$/)
  await expect(b.getByText('Beef, Coleslaw')).toBeVisible()
  await expect(b.getByText('₦3,400').first()).toBeVisible() // 2500 + 700 + 200

  // a different vendor needs an explicit replace
  await b.goto('/vendors/sample-print-shop')
  await b.getByRole('link', { name: 'Print A4 (per page)' }).first().click()
  await b.getByRole('button', { name: 'Add to cart' }).click()
  await expect(b.getByText('Start a new cart with this vendor?')).toBeVisible()
  await b.getByRole('link', { name: 'Keep my cart' }).click()
  await expect(b.getByText('Jollof rice and chicken')).toBeVisible()
  await b.goBack()
  await b.getByRole('button', { name: 'Add to cart' }).click()
  await b.getByRole('button', { name: 'Replace my cart' }).click()
  await expect(b).toHaveURL(/\/cart$/)
  await expect(b.getByText('Print A4 (per page)')).toBeVisible()
  await expect(b.getByText('Jollof rice and chicken')).toHaveCount(0)

  // quantity update and removal
  await b.getByLabel('Quantity').fill('4')
  await b.getByRole('button', { name: 'Update' }).click()
  await expect(b.getByText('₦200').first()).toBeVisible() // 4 x N50
  await b.getByRole('button', { name: 'Remove' }).click()
  await expect(b.getByText('Your cart is empty')).toBeVisible()
  await buyer.context.close()
})

test('checkout stays blocked with clear messages when the vendor is closed or an item sold out', async ({
  browser,
}, info) => {
  test.setTimeout(120000)
  const buyer = await openSession(browser, info, 'blocked')
  const b = buyer.page
  // Sample Souvenirs has no opening hours => closed
  await b.goto('/vendors/sample-souvenirs')
  await b.getByRole('link', { name: 'Branded notebook' }).first().click()
  await b.getByRole('button', { name: 'Add to cart' }).click()
  await expect(b).toHaveURL(/\/cart$/)
  await expect(alertIn(b)).toContainText(/closed right now/)
  await b.getByRole('link', { name: 'Proceed to checkout' }).click()
  await b.getByRole('button', { name: 'Place order' }).click()
  await expect(alertIn(b)).toContainText(/closed right now/)
  const { count } = await admin()
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', buyer.user.id)
  expect(count).toBe(0)
  await buyer.context.close()
})

test('double submission of the same checkout creates a single order', async ({ browser }, info) => {
  test.setTimeout(120000)
  await fixPricing(50000)
  const buyer = await openSession(browser, info, 'double')
  const b = buyer.page
  await b.goto('/vendors/sample-print-shop')
  await b.getByRole('link', { name: 'Spiral binding' }).first().click()
  await b.getByRole('button', { name: 'Add to cart' }).click()
  await expect(b).toHaveURL(/\/cart$/)
  await b.goto('/checkout')
  // a double-tap: two rapid clicks on the same button
  await Promise.all([
    b.waitForURL(/\/orders\//),
    b.getByRole('button', { name: 'Place order' }).dblclick(),
  ])
  await expect(b).toHaveURL(/\/orders\//)
  const { count } = await admin()
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', buyer.user.id)
  expect(count).toBe(1)
  await buyer.context.close()
})

test('production mode: the test payment does not exist (button absent, action refuses)', async ({
  browser,
}) => {
  test.setTimeout(180000)
  // A second copy of the built app, started with APP_ENV=production on another port.
  const port = 3101
  const child = spawn('node_modules/.bin/next', ['start', '-H', '127.0.0.1', '-p', String(port)], {
    env: { ...process.env, APP_ENV: 'production', PORT: String(port), PAYSTACK_SECRET_KEY: '' },
    stdio: 'ignore',
  })
  try {
    await expect
      .poll(
        async () =>
          fetch(`http://127.0.0.1:${port}/`)
            .then((r) => r.status)
            .catch(() => 0),
        { timeout: 60000 },
      )
      .toBe(200)
    const u = await createUser('prodmode')
    const { secret } = await enrolFactorViaApi(u.email)
    // create an unpaid order through the API at aal2
    const c = createClient(SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await c.auth.signInWithPassword({ email: u.email, password: PASSWORD })
    const f = (await c.auth.mfa.listFactors()).data!.totp[0]!
    const ch = await c.auth.mfa.challenge({ factorId: f.id })
    await c.auth.mfa.verify({
      factorId: f.id,
      challengeId: ch.data!.id,
      code: await freshCode(secret),
    })
    const { data: prod } = await admin()
      .from('products')
      .select('id')
      .eq('name', 'Spiral binding')
      .single()
    expect(
      (
        await c.rpc('cart_add_item', {
          p_product: prod!.id,
          p_qty: 1,
          p_options: [],
          p_replace: false,
        })
      ).error,
    ).toBeNull()
    const { data: orderId, error } = await c.rpc('create_order', {
      p_fulfilment: 'pickup',
      p_delivery_point: null,
      p_idempotency_key: `prod-${tag()}-key`,
    })
    expect(error).toBeNull()

    const ctx = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': `10.250.${Math.floor(Math.random() * 250)}.9` },
    })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${port}/login?next=/orders/${orderId}`)
    await page.getByLabel('Email').fill(u.email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/mfa\/challenge/)
    await page.getByLabel('6-digit code').fill(await freshCode(secret))
    await page.getByRole('button', { name: 'Verify' }).click()
    await page.waitForURL(new RegExp(`/orders/${orderId}`))
    await expect(page.getByText('Payment needed')).toBeVisible()
    await expect(page.getByText('Online payment is not open yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Pay \(test/ })).toHaveCount(0)
    await expect(page.getByText('Test mode')).toHaveCount(0)
    // the order was never paid
    expect(
      (await admin().from('orders').select('status').eq('id', orderId).single()).data!.status,
    ).toBe('PENDING_PAYMENT')
    await ctx.close()
  } finally {
    child.kill()
  }
})

test.afterAll(async () => {
  /* data is created with unique tags; `pnpm db:reset` clears it */
})
void uiSignInWithMfa
