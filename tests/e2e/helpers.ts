import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import * as OTPAuth from 'otpauth'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

// Load .env.local (local-stack values) for the test process.
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!
  }
}
export const SUPABASE_URL = process.env.SUPABASE_URL!
export const MAIL_SINK = process.env.MAIL_SINK_URL ?? 'http://127.0.0.1:54326'
export const PASSWORD = 'Correct-Horse-9-Battery'

export const admin = () =>
  createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

export const totp = (secret: string) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate()

/** Wait for the next TOTP window if we are in the last 2 seconds of the current one. */
export async function freshCode(secret: string) {
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30)
  if (remaining <= 2) await new Promise((r) => setTimeout(r, (remaining + 1) * 1000))
  return totp(secret)
}

export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`

export async function createUser(label: string, roles: string[] = []) {
  const email = uniqueEmail(label)
  const a = admin()
  const { data, error } = await a.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  for (const role of roles) {
    const { error: e } = await a.from('role_assignments').insert({ user_id: data.user.id, role })
    if (e) throw e
  }
  return { id: data.user.id, email }
}

/** Enrol a TOTP factor through the Auth API (test setup only) and return its secret. */
export async function enrolFactorViaApi(email: string, friendlyName = 'Authenticator app') {
  const c = createClient(SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const si = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (si.error) throw si.error
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName })
  if (en.error || !en.data) throw en.error ?? new Error('enroll failed')
  const ch = await c.auth.mfa.challenge({ factorId: en.data.id })
  if (ch.error) throw ch.error
  const v = await c.auth.mfa.verify({
    factorId: en.data.id,
    challengeId: ch.data.id,
    code: await freshCode(en.data.totp.secret),
  })
  if (v.error) throw v.error
  return { secret: en.data.totp.secret, factorId: en.data.id }
}

/** Fill and submit the sign-in form WITHOUT assuming success (use for failure-path tests). */
export async function uiSignInAttempt(
  page: Page,
  email: string,
  password = PASSWORD,
  next?: string,
) {
  if (!page.url().includes('/login'))
    await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])
}

/** Sign in and wait until the server action has finished and redirected away from /login. */
export async function uiSignIn(page: Page, email: string, password = PASSWORD, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

/** Submit a 6-digit code on a challenge/enrol form and wait for the server action + form reset. */
export async function submitCode(page: Page, code: string, button: string | RegExp) {
  const input = page.getByLabel('6-digit code')
  await input.fill(code)
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.getByRole('button', { name: button }).click(),
  ])
}

export const statusIn = (page: Page) => page.locator('main [role="status"]').first()

export async function uiMfaChallenge(page: Page, secret: string) {
  await expect(page).toHaveURL(/\/mfa\/challenge/)
  await page.getByLabel('6-digit code').fill(await freshCode(secret))
  await page.getByRole('button', { name: 'Verify' }).click()
  // Wait for the server action to finish (it sets the upgraded session cookie) before navigating on.
  await page.waitForURL((u) => !u.pathname.startsWith('/mfa/challenge'))
}

/** Page-level alert (excludes Next's hidden route announcer, which also has role=alert). */
export const alertIn = (page: Page) => page.locator('main [role="alert"]').first()

export async function uiSignOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL('http://127.0.0.1:3000/')
}

/** Sign in through the UI and complete the MFA challenge. */
export async function uiSignInWithMfa(page: Page, email: string, secret: string, next?: string) {
  await uiSignIn(page, email, PASSWORD, next)
  await uiMfaChallenge(page, secret)
}

let _pool: pg.Pool | undefined
const pool = () => (_pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }))
/** Look a user up by email (local database only; the Auth admin list is paginated and unreliable at scale). */
export async function userIdByEmail(email: string): Promise<string> {
  const r = await pool().query('select id from auth.users where email = $1', [email])
  if (!r.rows[0]) throw new Error(`no user ${email}`)
  return r.rows[0].id as string
}

// ---------------------------------------------------------------------------------------------
// Batch 2 helpers
// ---------------------------------------------------------------------------------------------
import type { Browser, BrowserContext, TestInfo } from '@playwright/test'

export const randIp = () =>
  `10.${100 + Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
export const tag = () => Math.random().toString(36).slice(2, 8)

/** Known fee configuration so totals are deterministic (N500 delivery; the customer platform fee is retired and pinned to 0). */
export async function fixPricing(deliveryKobo = 50000, bps = 0) {
  const { error } = await admin()
    .from('platform_settings')
    .upsert([
      { key: 'delivery_fee_kobo', value: deliveryKobo },
      { key: 'platform_fee_bps', value: bps },
    ])
  if (error) throw error
}

export type Session = {
  page: Page
  context: BrowserContext
  user: { id: string; email: string }
  secret: string
}

/** A user with a verified authenticator, signed in through the UI at aal2, in its own browser context. */
export async function openSession(
  browser: Browser,
  info: TestInfo,
  label: string,
  roles: string[] = [],
): Promise<Session> {
  const user = await createUser(label, roles)
  const { secret } = await enrolFactorViaApi(user.email)
  const use = info.project.use
  const context = await browser.newContext({
    viewport: use.viewport ?? undefined,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  await uiSignInWithMfa(page, user.email, secret)
  return { page, context, user, secret }
}

/** Anonymous visitor in its own context. */
export async function openAnonymous(browser: Browser, info: TestInfo) {
  const use = info.project.use
  const context = await browser.newContext({
    viewport: use.viewport ?? undefined,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  return { context, page: await context.newPage() }
}

/** Server-action friendly click: wait for the POST to finish. */
export async function clickAndWait(page: Page, click: () => Promise<void>) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), click()])
}

export async function a11yClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    `axe on ${label}`,
  ).toEqual([])
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `horizontal overflow on ${label}`).toBeLessThanOrEqual(0)
}

// ---- Batch 4 fixtures (service role; SYNTHETIC coordinates only) ----------------------------------
export const SYNTH_POINT = { lat: 0.01, lng: 0.01, radius: 60 }

export async function makeShopWithPoint(ownerId: string, productName: string) {
  const a = admin()
  const { data: cat } = await a.from('categories').select('id').eq('slug', 'food').single()
  const slug = `shop-${tag()}`
  const { data: v, error } = await a
    .from('vendors')
    .insert({
      name: `Shop ${slug}`,
      slug,
      status: 'approved',
      category_id: cat!.id,
      owner_id: ownerId,
      pickup_location_text: 'Counter (placeholder)',
      prep_minutes: 10,
    })
    .select('id')
    .single()
  if (error) throw error
  await a.from('vendor_staff').insert({ vendor_id: v!.id, user_id: ownerId, staff_role: 'owner' })
  await a.from('store_hours').insert(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      vendor_id: v!.id,
      weekday,
      opens: '00:00',
      closes: '23:59:59',
    })),
  )
  const { error: pe } = await a.from('products').insert({
    vendor_id: v!.id,
    name: productName,
    price_kobo: 150000,
    stock_quantity: 50,
    status: 'active',
    is_available: true,
  })
  if (pe) throw pe
  const label = `AAA Test point ${tag()} (synthetic)`
  const { data: dp, error: de } = await a
    .from('approved_delivery_points')
    .insert({
      label,
      is_active: true,
      sort_order: -999,
      lat: SYNTH_POINT.lat,
      lng: SYNTH_POINT.lng,
      geofence_radius_m: SYNTH_POINT.radius,
    })
    .select('id')
    .single()
  if (de) throw de
  return { vendorId: v!.id as string, slug, pointId: dp!.id as string, pointLabel: label }
}

export const APPROVED_FIXTURE_TERMS = 'test-approved-fixture-1'

/** TEST-ONLY: installs a synthetic non-placeholder terms version and makes it current (A8). Never real AFIT terms. */
export async function installApprovedTermsFixture() {
  const a = admin()
  const { error } = await a.from('rider_terms_versions').upsert(
    {
      version: APPROVED_FIXTURE_TERMS,
      title: 'TEST FIXTURE - not real terms',
      body: 'Synthetic test fixture. Not approved by AFIT.',
      is_placeholder: false,
    },
    { onConflict: 'version', ignoreDuplicates: true },
  )
  if (error) throw error
  const { error: e2 } = await a
    .from('platform_settings')
    .update({ value: APPROVED_FIXTURE_TERMS })
    .eq('key', 'rider_terms_current_version')
  if (e2) throw e2
}

/** Puts the shipped placeholder back as the current terms so no test leaves the fixture behind. */
export async function restorePlaceholderTerms() {
  const { error } = await admin()
    .from('platform_settings')
    .update({ value: 'dev-placeholder-1' })
    .eq('key', 'rider_terms_current_version')
  if (error) throw error
}

/** An approved rider with the current terms accepted (optionally with an active shift) - created directly, no UI. */
export async function seedRider(opts: { active?: boolean } = {}) {
  const a = admin()
  await installApprovedTermsFixture()
  const u = await createUser('seedrider', ['rider'])
  const { error } = await a.from('rider_profiles').insert({
    user_id: u.id,
    full_name: 'Fixture Rider',
    contact_phone: '08000000000',
    status: 'approved',
  })
  if (error) throw error
  const { data: ver } = await a
    .from('platform_settings')
    .select('value')
    .eq('key', 'rider_terms_current_version')
    .single()
  await a
    .from('rider_terms_acknowledgements')
    .insert({ user_id: u.id, version: ver!.value as string })
  let shift: string | null = null
  if (opts.active) {
    const { data: sh, error: se } = await a
      .from('rider_shifts')
      .insert({ rider_id: u.id })
      .select('id')
      .single()
    if (se) throw se
    shift = sh!.id as string
  }
  return { ...u, shift }
}

/** Inserts `n` AWAITING_RIDER delivery orders for a shop (bypassing checkout) and returns their ids/numbers. */
export async function seedOfferOrders(
  n: number,
  shop: { vendorId: string; pointId: string; pointLabel: string },
  customerId: string,
) {
  const a = admin()
  const rows = Array.from({ length: n }, (_, i) => ({
    order_number: `AFM-T${tag()}${i}`,
    customer_id: customerId,
    vendor_id: shop.vendorId,
    vendor_name: 'Fixture shop',
    fulfilment: 'delivery',
    delivery_point_id: shop.pointId,
    delivery_point_label: shop.pointLabel,
    pickup_location_snapshot: 'Counter (placeholder)',
    status: 'AWAITING_RIDER',
    items_total_kobo: 100000,
    delivery_fee_kobo: 50000,
    platform_fee_kobo: 5000,
    total_kobo: 155000,
    idempotency_key: `fixture-${tag()}-${i}-key`,
  }))
  const { data, error } = await a.from('orders').insert(rows).select('id, order_number')
  if (error) throw error
  return data as { id: string; order_number: string }[]
}

/** Signs in an existing (fixture) user with a freshly enrolled authenticator, in its own browser context. */
export async function openSessionFor(
  browser: Browser,
  info: TestInfo,
  user: { id: string; email: string },
): Promise<Session> {
  const { secret } = await enrolFactorViaApi(user.email)
  const use = info.project.use
  const context = await browser.newContext({
    viewport: use.viewport ?? undefined,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  await uiSignInWithMfa(page, user.email, secret)
  return { page, context, user, secret }
}

/** Counts every geolocation call the page makes (to prove none happens before Go Active). */
export async function countGeolocationCalls(context: import('@playwright/test').BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __geoCalls: number }
    w.__geoCalls = 0
    const g = navigator.geolocation
    for (const m of ['getCurrentPosition', 'watchPosition'] as const) {
      const orig = g[m].bind(g) as (...a: unknown[]) => unknown
      ;(g as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
        w.__geoCalls++
        return orig(...a)
      }
    }
  })
}
export const geoCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __geoCalls?: number }).__geoCalls ?? 0)

/**
 * (Batch 5) A delivery order that has reached ARRIVAL_DETECTED with an active en-route assignment, created directly in
 * the database (the journey up to this point is covered by the rider journey test). SYNTHETIC data only.
 */
export async function seedArrivedOrder(
  shop: { vendorId: string; pointId: string; pointLabel: string },
  customerId: string,
  rider: { id: string; shift: string | null },
) {
  const a = admin()
  const order_number = `AFM-T${tag()}`
  const { data: o, error } = await a
    .from('orders')
    .insert({
      order_number,
      customer_id: customerId,
      vendor_id: shop.vendorId,
      vendor_name: 'Fixture shop',
      fulfilment: 'delivery',
      delivery_point_id: shop.pointId,
      delivery_point_label: shop.pointLabel,
      pickup_location_snapshot: 'Counter (placeholder)',
      status: 'ARRIVAL_DETECTED',
      items_total_kobo: 300000,
      delivery_fee_kobo: 50000,
      platform_fee_kobo: 15000,
      total_kobo: 365000,
      idempotency_key: `fixture-${tag()}-arrived-key`,
    })
    .select('id, order_number')
    .single()
  if (error) throw error
  const { error: ie } = await a.from('order_items').insert({
    order_id: o!.id,
    product_name: 'Jollof rice (fixture)',
    base_price_kobo: 150000,
    unit_price_kobo: 150000,
    quantity: 2,
    line_total_kobo: 300000,
  })
  if (ie) throw ie
  const { data: asg, error: ae } = await a
    .from('delivery_assignments')
    .insert({
      order_id: o!.id,
      rider_id: rider.id,
      shift_id: rider.shift,
      slot: 1,
      status: 'en_route',
      arrival_detected_at: new Date().toISOString(),
      dest_lat: SYNTH_POINT.lat,
      dest_lng: SYNTH_POINT.lng,
      dest_radius_m: SYNTH_POINT.radius,
    })
    .select('id')
    .single()
  if (ae) throw ae
  return { id: o!.id as string, number: order_number, assignmentId: asg!.id as string }
}

/**
 * (Batch 5) A paid, COMPLETED pickup order with two lines (2 x 1,500 and 1 x 1,000 naira = 4,000 + 5% fee = 4,200 naira received),
 * created directly in the database. SYNTHETIC data only.
 */
export async function seedPaidCompletedOrder(shop: { vendorId: string }, customerId: string) {
  const a = admin()
  const order_number = `AFM-T${tag()}`
  const { data: o, error } = await a
    .from('orders')
    .insert({
      order_number,
      customer_id: customerId,
      vendor_id: shop.vendorId,
      vendor_name: 'Fixture shop',
      fulfilment: 'pickup',
      pickup_location_snapshot: 'Counter (placeholder)',
      status: 'COMPLETED',
      items_total_kobo: 400000,
      delivery_fee_kobo: 0,
      platform_fee_kobo: 20000,
      total_kobo: 420000,
      idempotency_key: `fixture-${tag()}-paid-key`,
    })
    .select('id')
    .single()
  if (error) throw error
  const { data: items, error: ie } = await a
    .from('order_items')
    .insert([
      {
        order_id: o!.id,
        product_name: 'Jollof rice (fixture)',
        base_price_kobo: 150000,
        unit_price_kobo: 150000,
        quantity: 2,
        line_total_kobo: 300000,
      },
      {
        order_id: o!.id,
        product_name: 'Zobo drink (fixture)',
        base_price_kobo: 100000,
        unit_price_kobo: 100000,
        quantity: 1,
        line_total_kobo: 100000,
      },
    ])
    .select('id, product_name')
  if (ie) throw ie
  const { error: le } = await a
    .from('ledger_entries')
    .insert({ order_id: o!.id, entry_type: 'payment_received', amount_kobo: 420000 })
  if (le) throw le
  return {
    id: o!.id as string,
    number: order_number,
    jollofId: items!.find((i) => i.product_name.startsWith('Jollof'))!.id as string,
    zoboId: items!.find((i) => i.product_name.startsWith('Zobo'))!.id as string,
  }
}
