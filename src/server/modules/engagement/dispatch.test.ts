import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: (f: () => unknown) => f() }))
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: () => ({}) }))
vi.mock('@/server/modules/identity-and-access/security', () => ({
  rateLimit: async () => true,
  sha256Hex: (s: string) => s,
}))
import { drainNotifications, type Claimed, type Deps, type Report } from './dispatch'
import { appLink, escapeHtml, notificationEmail, welcomeEmail } from './email-templates'
import { mailConfig, sendMail } from './mail'
import { isAllowedPushEndpoint, pushConfig } from './push'

const MAIL = { apiKey: 'k'.repeat(30), from: 'a@b.co', fromName: 'AFIT Market', replyTo: null }
const PUSH = { publicKey: 'p'.repeat(87), privateKey: 'q'.repeat(43), subject: 'mailto:a@b.co' }
const N = (o: Partial<Claimed> = {}): Claimed => ({
  id: 'n1',
  user_id: 'u1',
  kind: 'order',
  title: 'Order update',
  body: 'Your order changed.',
  link: '/orders/abc',
  attempts: 1,
  email_status: 'pending',
  push_status: 'pending',
  ...o,
})

function deps(items: Claimed[], o: Partial<Deps> = {}) {
  const reports: Record<string, Report> = {}
  const d: Deps = {
    mail: MAIL as never,
    push: PUSH as never,
    siteUrl: 'https://x.test',
    claim: async () => items,
    confirmedEmail: async () => 'u@x.test',
    emailOptOuts: async () => new Set(),
    subscriptions: async () =>
      new Map([
        [
          'u1',
          [
            {
              id: 's',
              user_id: 'u1',
              endpoint: 'https://fcm.googleapis.com/x',
              p256dh: 'a',
              auth: 'b',
            },
          ],
        ],
      ]),
    sendEmail: vi.fn(async () => 'sent' as const),
    sendPush: vi.fn(async () => 'sent' as const),
    dropSubscription: vi.fn(async () => undefined),
    report: async (id, r) => void (reports[id] = r),
    ...o,
  }
  return { d, reports }
}

describe('templates', () => {
  it('escapes dynamic text', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
    const m = notificationEmail(
      { kind: 'order', title: '<b>x</b>', body: '"><script>', link: '/orders/1' },
      'https://x.test',
    )
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<b>x</b>')
  })
  it('only links to plain in-app paths', () => {
    expect(appLink('https://x.test/', '/orders/1')).toBe('https://x.test/orders/1')
    expect(appLink('https://x.test', '//evil.com')).toBeNull()
    expect(appLink('https://x.test', 'https://evil.com')).toBeNull()
    expect(appLink('https://x.test', '/a?b=1')).toBeNull()
  })
  it('welcome mail greets and links to the shops', () => {
    const m = welcomeEmail('https://x.test')
    expect(m.subject).toMatch(/Welcome/)
    expect(m.html).toContain('https://x.test/vendors')
  })
})

describe('configuration', () => {
  it('mail needs a key and a sender', () => {
    expect(mailConfig({})).toBeNull()
    expect(mailConfig({ BREVO_API_KEY: 'k'.repeat(30), MAIL_FROM: 'bad' })).toBeNull()
    expect(mailConfig({ BREVO_API_KEY: 'k'.repeat(30), MAIL_FROM: 'a@b.co' })).not.toBeNull()
  })
  it('push needs both VAPID keys', () => {
    expect(pushConfig({})).toBeNull()
    expect(pushConfig({ VAPID_PUBLIC_KEY: 'x' })).toBeNull()
  })
  it('only browser push services are allowed as endpoints', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(
      true,
    )
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://169.254.169.254/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://u:p@fcm.googleapis.com/x')).toBe(false)
  })
  it('sendMail reports disabled / sent / failed without throwing', async () => {
    const mail = { subject: 's', html: '<p>h</p>', text: 't' }
    expect(await sendMail('a@b.co', mail, { config: null })).toBe('disabled')
    expect(
      await sendMail('a@b.co', mail, {
        config: MAIL as never,
        fetchImpl: async () => new Response('{}', { status: 201 }),
      }),
    ).toBe('sent')
    expect(
      await sendMail('a@b.co', mail, {
        config: MAIL as never,
        fetchImpl: async () => new Response('', { status: 400 }),
      }),
    ).toBe('failed')
    expect(
      await sendMail('a@b.co', mail, {
        config: MAIL as never,
        fetchImpl: async () => {
          throw new Error('x')
        },
      }),
    ).toBe('failed')
  })
})

describe('drainNotifications', () => {
  it('does nothing and claims nothing when neither channel is configured', async () => {
    const claim = vi.fn(async () => [N()])
    const { d } = deps([], { mail: null, push: null, claim })
    expect((await drainNotifications(5, d)).disabled).toBe(true)
    expect(claim).not.toHaveBeenCalled()
  })
  it('sends one e-mail and one pop-up and marks both sent', async () => {
    const { d, reports } = deps([N()])
    const r = await drainNotifications(5, d)
    expect(r).toMatchObject({ claimed: 1, emailed: 1, pushed: 1, failed: 0 })
    expect(reports.n1).toMatchObject({ email_status: 'sent', push_status: 'sent' })
  })
  it('respects the e-mail opt-out and unconfirmed addresses', async () => {
    const a = deps([N()], { emailOptOuts: async () => new Set(['u1']) })
    await drainNotifications(5, a.d)
    expect(a.d.sendEmail).not.toHaveBeenCalled()
    expect(a.reports.n1?.email_status).toBe('skipped')
    const b = deps([N()], { confirmedEmail: async () => null })
    await drainNotifications(5, b.d)
    expect(b.reports.n1?.email_status).toBe('skipped')
  })
  it('does not resend a channel that already succeeded', async () => {
    const { d, reports } = deps([N({ email_status: 'sent', attempts: 2 })])
    await drainNotifications(5, d)
    expect(d.sendEmail).not.toHaveBeenCalled()
    expect(reports.n1?.email_status).toBe('sent')
  })
  it('keeps a failed channel pending until the third attempt, then fails it', async () => {
    const fail = { sendEmail: vi.fn(async () => 'failed' as const) }
    const a = deps([N({ attempts: 1 })], fail)
    await drainNotifications(5, a.d)
    expect(a.reports.n1?.email_status).toBe('pending')
    const b = deps([N({ attempts: 3 })], fail)
    expect((await drainNotifications(5, b.d)).failed).toBe(1)
    expect(b.reports.n1?.email_status).toBe('failed')
  })
  it('drops expired devices and skips push when none remain', async () => {
    const { d, reports } = deps([N()], { sendPush: vi.fn(async () => 'gone' as const) })
    await drainNotifications(5, d)
    expect(d.dropSubscription).toHaveBeenCalledWith('https://fcm.googleapis.com/x')
    expect(reports.n1?.push_status).toBe('skipped')
  })
  it('never throws', async () => {
    const { d } = deps([], {
      claim: async () => {
        throw new Error('db down')
      },
    })
    await expect(drainNotifications(5, d)).resolves.toMatchObject({ claimed: 0 })
  })
})
