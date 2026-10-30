import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock('@/server/modules/identity-and-access/security', () => ({
  rateLimit: vi.fn(async () => true),
}))

import {
  adminAlertConfig,
  alertablePaymentOutcome,
  buildAdminAlert,
  clean,
  maskEmail,
  sendAdminAlert,
  type AdminAlertEvent,
} from './admin-alerts'

const KEY = 'xkeysib-unit-test-key-0000000000'
const config = {
  apiKey: KEY,
  to: 'owner@example.com',
  from: 'market@example.com',
  fromName: 'AFIT Market',
}
const ok = () => vi.fn(async () => new Response('{}', { status: 201 }))

describe('configuration', () => {
  it('is off unless the key and both addresses are present and well formed', () => {
    expect(adminAlertConfig({})).toBeNull()
    expect(adminAlertConfig({ BREVO_API_KEY: KEY, ADMIN_ALERT_TO: 'owner@example.com' })).toBeNull()
    expect(
      adminAlertConfig({
        BREVO_API_KEY: 'short',
        ADMIN_ALERT_TO: 'a@b.co',
        ADMIN_ALERT_FROM: 'c@d.co',
      }),
    ).toBeNull()
    expect(
      adminAlertConfig({
        BREVO_API_KEY: KEY,
        ADMIN_ALERT_TO: 'not an email',
        ADMIN_ALERT_FROM: 'c@d.co',
      }),
    ).toBeNull()
    expect(
      adminAlertConfig({
        BREVO_API_KEY: KEY,
        ADMIN_ALERT_TO: 'a@b.co',
        ADMIN_ALERT_FROM: 'c@d.co',
      }),
    ).toEqual({ apiKey: KEY, to: 'a@b.co', from: 'c@d.co', fromName: 'AFIT Market' })
  })
})

describe('message content', () => {
  it('masks e-mail addresses and keeps subjects free of user text', () => {
    expect(maskEmail('jane.doe@gmail.com')).toBe('j***@gmail.com')
    expect(maskEmail('nonsense')).toBe('***')
    const m = buildAdminAlert({ type: 'signup', email: 'jane.doe@gmail.com' }, 'https://x.test/')
    expect(m.text).toContain('j***@gmail.com')
    expect(m.text).not.toContain('jane.doe')
    expect(m.text).toContain('Open: https://x.test/admin/roles')
    const v = buildAdminAlert(
      { type: 'vendor_application', businessName: 'Evil\r\nBcc: x@y.z' },
      'https://x.test',
    )
    expect(v.subject).toBe('[AFIT Market] New vendor application')
    expect(v.text).not.toMatch(/\r|Evil\nBcc/)
  })

  it('formats payments and strips odd characters from identifiers', () => {
    const m = buildAdminAlert(
      {
        type: 'payment',
        outcome: 'paid',
        amountKobo: 378000,
        currency: 'NGN',
        reference: 'AFM-001<script>',
      },
      'https://x.test',
    )
    expect(m.text).toContain('₦3,780')
    expect(m.text).toContain('Reference: AFM-001script')
    expect(clean('a\u0000b\n\nc', 10)).toBe('a b c')
  })

  it('alerts only for meaningful payment outcomes', () => {
    for (const o of ['paid', 'late_payment', 'amount_mismatch', 'duplicate_payment', 'failed'])
      expect(alertablePaymentOutcome(o)).toBe(true)
    for (const o of [
      'duplicate_event',
      'ignored_event_type',
      'unknown_reference',
      'already_succeeded',
    ])
      expect(alertablePaymentOutcome(o)).toBe(false)
  })
})

describe('delivery fee alerts', () => {
  it('say what happened, point at the delivery fee page and carry no personal data', () => {
    for (const [step, words] of [
      ['reported', /customer says they sent/],
      ['confirmed', /rider confirmed/],
      ['disputed', /did NOT arrive/],
    ] as const) {
      const m = buildAdminAlert({ type: 'delivery_fee', step }, 'https://x.test/')
      expect(m.subject).toBe('[AFIT Market] Delivery fee update')
      expect(m.text).toMatch(words)
      expect(m.text).toContain('https://x.test/admin/delivery-fee-payments')
    }
  })
})

describe('sending', () => {
  const ev: AdminAlertEvent = { type: 'rider_application' }
  beforeEach(() => vi.clearAllMocks())

  it('does nothing when alerts are not configured', async () => {
    const f = ok()
    expect(await sendAdminAlert(ev, { config: null, fetchImpl: f })).toBe('disabled')
    expect(f).not.toHaveBeenCalled()
  })

  it('posts to Brevo with the key in a header and nowhere in the body', async () => {
    const f = ok()
    expect(await sendAdminAlert(ev, { config, fetchImpl: f, underCap: async () => true })).toBe(
      'sent',
    )
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect((init.headers as Record<string, string>)['api-key']).toBe(KEY)
    expect(String(init.body)).not.toContain(KEY)
    const body = JSON.parse(String(init.body))
    expect(body.to).toEqual([{ email: 'owner@example.com' }])
    expect(body.sender).toEqual({ name: 'AFIT Market', email: 'market@example.com' })
  })

  it('respects the daily cap', async () => {
    const f = ok()
    expect(await sendAdminAlert(ev, { config, fetchImpl: f, underCap: async () => false })).toBe(
      'capped',
    )
    expect(f).not.toHaveBeenCalled()
  })

  it('never throws when the provider fails, errors or times out', async () => {
    const bad = vi.fn(async () => new Response('no', { status: 401 }))
    expect(await sendAdminAlert(ev, { config, fetchImpl: bad, underCap: async () => true })).toBe(
      'failed',
    )
    const boom = vi.fn(async () => {
      throw new Error(`down ${KEY}`)
    })
    expect(await sendAdminAlert(ev, { config, fetchImpl: boom, underCap: async () => true })).toBe(
      'failed',
    )
  })
})
