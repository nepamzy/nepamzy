import { describe, expect, it } from 'vitest'
import {
  confirmEmail,
  emojiFor,
  notificationEmail,
  passwordChangedEmail,
  renderEmail,
  resetCodeEmail,
  signInAlertEmail,
  welcomeEmail,
} from './email-templates'
import { describeDevice } from './dispatch'
import { sendMailDetailed } from './mail'

const SITE = 'https://afit-market.vercel.app'

describe('branded e-mails', () => {
  it('every template has a subject with an emoji, a plain-text part, the brand and an escaped body', () => {
    const all = [
      confirmEmail(`${SITE}/auth/confirm?token_hash=abc&type=signup`, SITE),
      welcomeEmail(SITE),
      resetCodeEmail('123456', SITE),
      signInAlertEmail({ when: '29 Oct 2026, 9:00 pm', device: 'Chrome on Windows' }, SITE),
      passwordChangedEmail(SITE),
      notificationEmail(
        { kind: 'order', title: 'Payment received', body: 'We got it.', link: '/orders/abc' },
        SITE,
      ),
    ]
    for (const m of all) {
      expect(m.subject).toMatch(/\p{Extended_Pictographic}/u)
      expect(m.html).toContain('AFIT')
      expect(m.html).toContain('<!doctype html>')
      expect(m.text.length).toBeGreaterThan(40)
      expect(m.html).not.toMatch(/undefined|\[object/)
    }
  })

  it('shows the reset code large and in the subject, and the link target in text and html', () => {
    const m = resetCodeEmail('482913', SITE)
    expect(m.subject).toContain('482913')
    expect(m.html).toContain('482913')
    expect(m.text).toContain('482913')
    expect(m.html).toContain(`${SITE}/reset-password`)
  })

  it('puts the confirmation link in the button and the text, with the one-time token intact', () => {
    const link = `${SITE}/auth/confirm?token_hash=a1b2&type=signup`
    const m = confirmEmail(link, SITE)
    expect(m.html).toContain(link.replace(/&/g, '&amp;'))
    expect(m.text).toContain(link)
  })

  it('escapes anything dynamic so a title cannot inject markup', () => {
    const m = renderEmail({
      subject: 's',
      preheader: 'p',
      heading: '<script>alert(1)</script>',
      paragraphs: ['"quoted" & <b>bold</b>'],
      details: [['<i>k</i>', '<u>v</u>']],
      siteUrl: SITE,
    })
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<b>bold</b>')
    expect(m.html).toContain('&lt;script&gt;')
  })

  it('only links to plain in-app paths', () => {
    const bad = notificationEmail(
      { kind: 'order', title: 't', body: 'b', link: 'https://evil.example/x' },
      SITE,
    )
    expect(bad.html).not.toContain('evil.example')
    const ok = notificationEmail({ kind: 'order', title: 't', body: 'b', link: '/orders/1' }, SITE)
    expect(ok.html).toContain(`${SITE}/orders/1`)
  })

  it('picks a fitting emoji for payments, deliveries, approvals and problems', () => {
    expect(emojiFor({ kind: 'order', title: 'Payment received' })).toBe('💳')
    expect(emojiFor({ kind: 'order', title: 'Order delivered' })).toBe('🎉')
    expect(emojiFor({ kind: 'order', title: 'Your rider is on the way' })).toBe('🚚')
    expect(emojiFor({ kind: 'admin', title: "You're approved!" })).toBe('✅')
    expect(emojiFor({ kind: 'case', title: 'Problem reported' })).toBe('⚠️')
    expect(emojiFor({ kind: 'review', title: 'Something' })).toBe('⭐')
  })
})

describe('describeDevice', () => {
  it('names the browser and system without versions or addresses', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows')
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android')
    expect(describeDevice(null)).toBe('a web browser on an unknown device')
  })
})

describe('sendMailDetailed', () => {
  const config = {
    apiKey: 'x'.repeat(30),
    from: 'a@example.com',
    fromName: 'A',
    replyTo: 'a@example.com',
  }
  const mail = { subject: 's', html: '<p>h</p>', text: 't' }
  it('reports the provider status and its own short reason, never the key', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 'unauthorized', message: 'Unrecognised IP address' }), {
        status: 401,
      })) as unknown as typeof fetch
    const out = await sendMailDetailed('b@example.com', mail, { config, fetchImpl })
    expect(out).toEqual({
      result: 'failed',
      status: 401,
      reason: 'unauthorized: Unrecognised IP address',
    })
    expect(JSON.stringify(out)).not.toContain('xxxxxxxx')
  })
  it('is disabled without a configuration and sent on success', async () => {
    expect((await sendMailDetailed('b@example.com', mail, { config: null })).result).toBe(
      'disabled',
    )
    const ok = (async () => new Response('{}', { status: 201 })) as unknown as typeof fetch
    expect((await sendMailDetailed('b@example.com', mail, { config, fetchImpl: ok })).result).toBe(
      'sent',
    )
  })
})
