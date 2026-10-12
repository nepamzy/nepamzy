import { expect, test, type Page } from '@playwright/test'
import {
  admin,
  clickAndWait,
  makeShopWithPoint,
  openAnonymous,
  openSession,
  openSessionFor,
  restorePlaceholderTerms,
  seedArrivedOrder,
  seedPaidCompletedOrder,
  seedRider,
  tag,
} from './helpers'

/**
 * SCRIPTED keyboard, focus and zoom checks (post-Batch 6 remediation). These drive the real pages with real key presses
 * and read the browser's computed styles and DOM order. They are automation: they do NOT replace a person using a screen
 * reader, a real device, or browser zoom, none of which has been done (docs/testing/accessibility-and-performance.md).
 */
test.describe.configure({ mode: 'serial' })
test.afterEach(async () => {
  await restorePlaceholderTerms()
})

type Stop = {
  tag: string
  name: string
  visibleFocus: boolean
  rect: boolean
  order: number
  inOrder: boolean
}

/** Tab through the page (up to `max` stops) and describe each place keyboard focus lands. */
async function tabAudit(page: Page, max = 60): Promise<Stop[]> {
  await page.evaluate(() => {
    ;(window as unknown as { __prevStop?: HTMLElement }).__prevStop = undefined
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  const stops: Stop[] = []
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const name =
        el.getAttribute('aria-label') ||
        el
          .getAttribute('aria-labelledby')
          ?.split(' ')
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ') ||
        (el as HTMLInputElement).labels?.[0]?.textContent ||
        el.textContent ||
        el.getAttribute('title') ||
        ''
      const r = el.getBoundingClientRect()
      // Compare with the previous stop by DOM position at the moment of the key press (robust against content that
      // appears or disappears between presses, unlike a global index).
      const w = window as unknown as { __prevStop?: HTMLElement }
      const prev = w.__prevStop
      const inOrder =
        !prev ||
        !prev.isConnected ||
        prev === el ||
        !!(prev.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      w.__prevStop = el
      const all = Array.from(document.querySelectorAll('*'))
      return {
        inOrder,
        tag: el.tagName.toLowerCase(),
        name: name.trim().replace(/\s+/g, ' ').slice(0, 60),
        visibleFocus:
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== 'none',
        rect: r.width > 0 && r.height > 0,
        order: all.indexOf(el),
      }
    })
    if (!s) break // focus left the document: the cycle is complete
    if (stops.length > 0 && s.order === stops[0]!.order) break // wrapped around to the first stop: the cycle is complete
    stops.push(s)
  }
  return stops
}
function expectGood(stops: Stop[], label: string) {
  expect(stops.length, `${label}: something is focusable`).toBeGreaterThan(0)
  for (const s of stops) {
    expect(s.name, `${label}: <${s.tag}> has an accessible name`).not.toBe('')
    expect(s.visibleFocus, `${label}: "${s.name}" shows a focus indicator`).toBe(true)
    expect(s.rect, `${label}: "${s.name}" is actually on screen`).toBe(true)
  }
  // logical order: focus never jumps backwards in the document (positive tabindex would break this)
  for (const st of stops) expect(st.inOrder, `${label}: focus order at "${st.name}"`).toBe(true)
}
/** 320 CSS px wide is what 400 % browser zoom gives a 1280 px window (WCAG 1.4.10). */
async function reflowAt320(page: Page, label: string) {
  const size = page.viewportSize()
  await page.setViewportSize({ width: 320, height: 640 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, `${label}: horizontal scrolling at 320 px`).toBeLessThanOrEqual(0)
  if (size) await page.setViewportSize(size)
}

test('keyboard focus order, visible focus, names and 320 px reflow on the main screens', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'acust')
  const owner = await openSession(browser, info, 'aowner', ['vendor_owner'])
  const adm = await openSession(browser, info, 'aadm', ['platform_admin'])
  const shop = await makeShopWithPoint(owner.user.id, `Fixture dish ${tag()}`)
  const o = await seedPaidCompletedOrder(shop, customer.user.id)
  await admin()
    .from('order_status_history')
    .insert({ order_id: o.id, from_status: 'PAID', to_status: 'COMPLETED' })

  const anon = await openAnonymous(browser, info)
  const pages: [Page, string, string][] = [
    [anon.page, '/login', 'sign-in'],
    [anon.page, '/vendors', 'vendor list'],
    [anon.page, `/vendors/${shop.slug}`, 'vendor page'],
    [customer.page, '/notifications', 'notifications'],
    [customer.page, `/orders/${o.id}`, 'completed order with review form'],
    [customer.page, `/orders/${o.id}/help`, 'order help (refund / report)'],
    [customer.page, '/cart', 'cart'],
    [adm.page, '/admin', 'admin home'],
    [adm.page, '/admin/settings', 'admin settings'],
    [adm.page, '/admin/reviews', 'review moderation'],
    [adm.page, '/admin/refunds', 'refunds'],
    [adm.page, '/admin/jobs', 'job health'],
  ]
  for (const [page, path, label] of pages) {
    await page.goto(path)
    await expect(page.locator('main, body').first()).toBeVisible()
    expectGood(await tabAudit(page), label)
    await reflowAt320(page, label)
  }
})

test('MFA challenge screen is keyboard operable and labelled', async ({ browser }, info) => {
  // sign in up to the second factor and audit the challenge page
  const { createUser, enrolFactorViaApi, uiSignIn } = await import('./helpers')
  const user = await createUser('amfa')
  await enrolFactorViaApi(user.email)
  const { page } = await openAnonymous(browser, info)
  await uiSignIn(page, user.email)
  await expect(page).toHaveURL(/mfa\/challenge/)
  expectGood(await tabAudit(page), 'MFA challenge')
  await reflowAt320(page, 'MFA challenge')
})

test('signature capture: the known limitation is exactly as documented (no keyboard path), and the way out is reachable by keyboard', async ({
  browser,
}, info) => {
  const customer = await openSession(browser, info, 'asig')
  const ownerId = (await openSession(browser, info, 'asigo')).user.id
  const shop = await makeShopWithPoint(ownerId, `Fixture dish ${tag()}`)
  const rider = await seedRider({ active: true })
  const o = await seedArrivedOrder(shop, customer.user.id, rider)
  await openSessionFor(browser, info, rider)
  const c = customer.page
  await c.goto(`/orders/${o.id}`)
  await clickAndWait(c, () => c.getByRole('button', { name: 'Confirm receipt' }).click())
  await expect(c.locator('canvas')).toBeVisible()

  // the drawing surface cannot take keyboard focus: this is K27, kept visible, NOT fixed by a typed fallback
  expect(await c.locator('canvas').getAttribute('tabindex')).toBeNull()
  const stops = await tabAudit(c)
  expect(stops.some((s) => s.tag === 'canvas')).toBe(false)
  // everything else in the panel is reachable and named, including the escape route to a person
  expect(stops.map((s) => s.name).join('|')).toMatch(/Get help from support/)
  expect(stops.map((s) => s.name).join('|')).toMatch(/Clear signature/)
  expectGood(stops, 'signature panel')
  // the typed alternative stays disabled
  await expect(c.getByLabel(/type your name as acknowledgement/i)).toHaveCount(0)
  // the state of the pad is announced politely
  expect(await c.locator('#sig-hint').getAttribute('aria-live')).toBe('polite')
  // nothing completed
  expect((await admin().from('orders').select('status').eq('id', o.id).single()).data!.status).toBe(
    'AWAITING_RECIPIENT_PROOF',
  )
  await reflowAt320(c, 'signature panel')
})
