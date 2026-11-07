import { describe, expect, it } from 'vitest'
import { safePushText } from './push-text'

describe('safePushText: nothing private in a phone pop-up', () => {
  it('removes phone numbers, e-mail addresses, codes and account numbers', () => {
    const t = safePushText(
      'Order 08031234567 ready',
      'Call +234 803 123 4567 or ada@example.com. Handover code: 4821. OTP is AB12. Pay 0123456789 at GTBank. Bring PIN 5555.',
    )
    const all = `${t.title} ${t.body}`
    expect(all).not.toMatch(/\d{4}/)
    expect(all).not.toMatch(/@/)
    expect(all).not.toMatch(/4821|AB12|5555|0803|0123/)
  })
  it('removes street-style addresses', () => {
    const t = safePushText(
      'Rider on the way',
      'Rider is near Block 5 Hostel Road and will arrive soon.',
    )
    expect(t.body).not.toMatch(/Block 5|Hostel/i)
  })
  it('keeps normal short wording and caps the length', () => {
    expect(safePushText('Order accepted', 'The shop accepted your order.')).toEqual({
      title: 'Order accepted',
      body: 'The shop accepted your order.',
    })
    const long = safePushText('x'.repeat(300), 'y'.repeat(900))
    expect(long.title.length).toBeLessThanOrEqual(60)
    expect(long.body.length).toBeLessThanOrEqual(120)
  })
  it('never returns an empty pop-up', () => {
    const t = safePushText('', '08031234567')
    expect(t.title).toBe('AFIT Market')
    expect(t.body.length).toBeGreaterThan(5)
  })
})
