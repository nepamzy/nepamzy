import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { admin, openAnonymous, openSession } from './helpers'

const SHOTS = process.env.ALERT_SHOTS ?? ''
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** Fake push service so the tap flow can run in a headless browser with no internet. */
const FAKE_PUSH = `
  (() => {
    const K = 'fake.push.endpoint', P = 'fake.push.perm'
    const state = { perm: window.__perm || localStorage.getItem(P) || 'default' }
    Object.defineProperty(Notification, 'permission', { get: () => state.perm, configurable: true })
    Notification.requestPermission = async () => {
      window.__asked = (window.__asked || 0) + 1
      state.perm = 'granted'
      localStorage.setItem(P, 'granted')
      return state.perm
    }
    const mk = (endpoint) => ({
      endpoint,
      toJSON() { return { endpoint, keys: { p256dh: 'P'.repeat(40), auth: 'A'.repeat(16) } } },
      unsubscribe: async () => { localStorage.removeItem(K); return true },
    })
    PushManager.prototype.getSubscription = async () => {
      const e = localStorage.getItem(K)
      return e ? mk(e) : null
    }
    PushManager.prototype.subscribe = async () => {
      const e = 'https://fcm.googleapis.com/fcm/send/' + Math.random().toString(36).slice(2) + 'abcdefghij'
      localStorage.setItem(K, e)
      return mk(e)
    }
  })()
`
/** Counts calls to Audio.play(). */
const SPY_AUDIO = `
  window.__plays = 0
  HTMLMediaElement.prototype.play = function () { window.__plays++; return Promise.resolve() }
`
const plays = (page: Page) =>
  page.evaluate(() => (window as unknown as { __plays: number }).__plays)

test('top bar: shows both buttons, 44px tall, install help, close for 7 days', async ({
  browser,
}, info) => {
  const { context, page } = await openAnonymous(browser, info)
  await page.goto('/')
  const bar = page.getByTestId('app-bar')
  await expect(bar).toBeVisible()
  const install = bar.getByRole('button', { name: 'Download app' })
  const notify = bar.getByRole('button', { name: 'Turn on notifications' })
  await expect(install).toBeVisible()
  await expect(notify).toBeVisible()
  for (const b of [install, notify])
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(bar.getByTestId('bar-state')).toContainText('not from the Play Store')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.viewportSize())!.width,
  )
  await shot(page, `bar-${info.project.name}`)
  // no install prompt available (headless / in-app browser): plain-words help
  await install.click()
  await expect(page.getByTestId('nobrowser-help')).toContainText(
    'Chrome (Android) or Safari (iPhone)',
  )
  // close: hidden for 7 days, still hidden after reload
  await bar.getByRole('button', { name: /Hide this bar/ }).click()
  await expect(bar).toBeHidden()
  await page.reload()
  await expect(bar).toBeHidden()
  // after 7 days it is back
  await page.evaluate(() => localStorage.setItem('afit.bar.hiddenUntil', String(Date.now() - 1)))
  await page.reload()
  await expect(bar).toBeVisible()
  await context.close()
})

test('top bar: iPhone gets step-by-step help; installed app shows "App installed"', async ({
  browser,
}) => {
  const iphone = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  })
  const p = await iphone.newPage()
  await p.goto('/')
  await p.getByRole('button', { name: 'Download app' }).click()
  const help = p.getByTestId('ios-help')
  await expect(help).toContainText('Share')
  await expect(help).toContainText('Add to Home Screen')
  await expect(help).toContainText('Add')
  await expect(p.getByTestId('bar-state')).toContainText(
    'only after you add the app to your Home Screen',
  )
  await shot(p, 'bar-iphone-help')
  await iphone.close()

  const standalone = await browser.newContext({ viewport: { width: 360, height: 740 } })
  const s = await standalone.newPage()
  await s.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (q: string) =>
      q.includes('standalone')
        ? ({
            matches: true,
            media: q,
            addEventListener() {},
            removeEventListener() {},
          } as unknown as MediaQueryList)
        : real(q)
  })
  await s.goto('/')
  await expect(s.getByText('✓ App installed')).toBeVisible()
  await expect(s.getByRole('button', { name: 'Download app' })).toHaveCount(0)
  await shot(s, 'bar-installed')
  await standalone.close()
})

test('top bar: notification states in plain words (blocked, not supported, sign in first)', async ({
  browser,
}) => {
  const mk = async (init: string) => {
    const c = await browser.newContext({ viewport: { width: 360, height: 740 } })
    const p = await c.newPage()
    await p.addInitScript(init)
    await p.goto('/')
    return { c, p }
  }
  const blocked = await mk(`window.__perm = 'denied';` + FAKE_PUSH)
  await expect(blocked.p.getByTestId('bar-state')).toContainText(
    'Your phone has blocked alerts for this site. Open phone settings, then Site settings',
  )
  await expect(blocked.p.getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0)
  await shot(blocked.p, 'bar-blocked')
  await blocked.c.close()

  const unsupported = await mk(`delete window.PushManager`)
  await expect(unsupported.p.getByTestId('bar-state')).toContainText('cannot show phone alerts')
  await unsupported.c.close()

  // signed out: permission is asked once (after the tap), then we ask them to sign in
  const out = await mk(FAKE_PUSH)
  expect(await out.p.evaluate(() => (window as unknown as { __asked?: number }).__asked ?? 0)).toBe(
    0,
  )
  await out.p.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(out.p.getByRole('link', { name: 'Sign in to turn on notifications' })).toBeVisible()
  expect(await out.p.evaluate(() => (window as unknown as { __asked?: number }).__asked)).toBe(1)
  await out.c.close()
})

test('signed in: Alerts switch, Mute switch, sound plays once, remembered after reload', async ({
  browser,
}, info) => {
  const s = await openSession(browser, info, 'alerts')
  const p = s.page
  await p.context().addInitScript(FAKE_PUSH + SPY_AUDIO)
  await p.goto('/notifications')
  const state = p.getByTestId('alerts-state')
  await expect(state).toContainText('Phone alerts are off')
  // turning on: top bar button, then the badge
  const bar = p.getByTestId('app-bar')
  await bar.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(state).toContainText('Phone alerts are on')
  await expect(p.getByRole('switch', { name: 'Alerts' })).toBeChecked()
  await shot(p, 'notifications-page-on')
  await p.reload()
  await expect(p.getByTestId('alerts-state')).toContainText('Phone alerts are on')
  // switch off and on from the page
  await p.getByRole('switch', { name: 'Alerts' }).click()
  await expect(p.getByTestId('alerts-state')).toContainText('Phone alerts are off')
  await p.getByRole('switch', { name: 'Alerts' }).click()
  await expect(p.getByTestId('alerts-state')).toContainText('Phone alerts are on')

  // sound: needs one touch first; same id twice plays once
  const id = randomUUID()
  const ping = (i: string) =>
    p.evaluate(
      (x) =>
        navigator.serviceWorker.dispatchEvent(
          new MessageEvent('message', { data: { type: 'afit-notification', id: x } }),
        ),
      i,
    )
  await p.locator('main').click({ position: { x: 5, y: 5 } }) // the touch that unlocks sound
  await ping(id)
  await ping(id)
  expect(await plays(p)).toBe(1)
  await ping(randomUUID())
  expect(await plays(p)).toBe(2)

  // mute: silent, and remembered after a reload
  await p.getByRole('switch', { name: 'Mute sound' }).check()
  await shot(p, 'notifications-page-muted')
  await ping(randomUUID())
  expect(await plays(p)).toBe(2)
  await p.reload()
  await expect(p.getByRole('switch', { name: 'Mute sound' })).toBeChecked()
  await p.locator('main').click({ position: { x: 5, y: 5 } })
  await ping(randomUUID())
  expect(await plays(p)).toBe(0)

  // a real new notification reaches an open, un-muted page through the 30-second check
  await p.getByRole('switch', { name: 'Mute sound' }).uncheck()
  await p.locator('main').click({ position: { x: 5, y: 5 } })
  const before = await plays(p)
  const { error } = await admin()
    .from('notifications')
    .insert({
      user_id: s.user.id,
      kind: 'order',
      title: 'Order update',
      body: 'Your order changed.',
      link: '/orders',
      event_key: `test:${randomUUID()}`,
    })
  expect(error).toBeNull()
  await expect.poll(() => plays(p), { timeout: 45_000, intervals: [2000] }).toBe(before + 1)
  await s.context.close()
})

test('a person cannot register a phone for someone else', async ({ browser }, info) => {
  const a = await openSession(browser, info, 'pushA')
  const b = await openSession(browser, info, 'pushB')
  await a.page.context().addInitScript(FAKE_PUSH)
  await a.page.goto('/notifications')
  await a.page.getByTestId('app-bar').getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(a.page.getByTestId('alerts-state')).toContainText('Phone alerts are on')
  const rows = await admin().from('push_subscriptions').select('user_id').eq('user_id', a.user.id)
  expect(rows.data).toHaveLength(1)
  const other = await admin().from('push_subscriptions').select('user_id').eq('user_id', b.user.id)
  expect(other.data).toHaveLength(0)
  // B's browser session cannot read A's rows (table is closed to browser roles)
  const read = await b.page.request.get(
    `${process.env.SUPABASE_URL}/rest/v1/push_subscriptions?select=*`,
    { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' } },
  )
  expect([401, 403]).toContain(read.status())
  await a.context.close()
  await b.context.close()
})
