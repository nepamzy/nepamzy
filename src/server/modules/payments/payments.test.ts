import { describe, expect, it } from 'vitest'
import { webhookToCall, verifyToCall } from './events'
import { signBody, verifySignature } from './signature'

const KEY = 'sk_test_unit_test_key_000'
const body = JSON.stringify({
  event: 'charge.success',
  data: {
    id: 99,
    reference: 'AFM-001000-abc',
    amount: 378000,
    currency: 'NGN',
    status: 'success',
    customer: { email: 'x@y.z' },
  },
})

describe('webhook signature (HMAC-SHA512 over the raw body)', () => {
  it('accepts the exact signature and nothing else', () => {
    const sig = signBody(body, KEY)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
    expect(verifySignature(body, sig, KEY)).toBe(true)
    expect(verifySignature(body, sig.toUpperCase(), KEY)).toBe(true)
  })
  it('rejects a changed body, a different key, and missing or malformed headers', () => {
    const sig = signBody(body, KEY)
    expect(verifySignature(body + ' ', sig, KEY)).toBe(false)
    expect(verifySignature(body, sig, 'sk_test_other_key_00000')).toBe(false)
    for (const bad of [null, '', 'abc', sig.slice(1), sig + '0', 'z'.repeat(128)]) {
      expect(verifySignature(body, bad, KEY)).toBe(false)
    }
  })
  it('is sensitive to whitespace differences in the raw body (so we must hash the raw bytes)', () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2)
    expect(verifySignature(pretty, signBody(body, KEY), KEY)).toBe(false)
  })
})

describe('webhookToCall', () => {
  it('maps charge.success to a stable event id and keeps only whitelisted fields', () => {
    const c = webhookToCall(JSON.parse(body))
    expect(c).not.toBeNull()
    expect(c).not.toBe('invalid')
    if (c && c !== 'invalid') {
      expect(c.eventId).toBe('ps:charge.success:99')
      expect(c.amountKobo).toBe(378000)
      expect(JSON.stringify(c.payload)).not.toMatch(/email/)
    }
  })
  it('ignores other events and rejects malformed payloads', () => {
    expect(
      webhookToCall({
        event: 'transfer.success',
        data: { reference: 'r1234567', amount: 1, currency: 'NGN' },
      }),
    ).toBeNull()
    expect(
      webhookToCall({
        event: 'charge.success',
        data: { reference: '', amount: 1, currency: 'NGN' },
      }),
    ).toBe('invalid')
    expect(
      webhookToCall({
        event: 'charge.success',
        data: { reference: 'r1234567', amount: '5', currency: 'NGN' },
      }),
    ).toBe('invalid')
    expect(webhookToCall('nope')).toBe('invalid')
  })
})

describe('verifyToCall', () => {
  it('only success and failed are acted on', () => {
    expect(
      verifyToCall('ref-12345', { status: 'abandoned', amount: 1, currency: 'NGN' }),
    ).toBeNull()
    expect(verifyToCall('ref-12345', { status: 'success', amount: 5, currency: 'NGN' })?.type).toBe(
      'charge.success',
    )
    expect(verifyToCall('ref-12345', { status: 'failed', amount: 5, currency: 'NGN' })?.type).toBe(
      'charge.failed',
    )
  })
})
