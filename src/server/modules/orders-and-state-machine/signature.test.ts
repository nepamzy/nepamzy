import { describe, expect, it } from 'vitest'
import { MAX_SIGNATURE_BYTES, parseSignature } from './signature'

const png = (n: number, magic = true) =>
  Buffer.concat([
    magic ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : Buffer.alloc(8, 1),
    Buffer.alloc(Math.max(0, n - 8), 7),
  ])
const url = (b: Buffer, mime = 'image/png') => `data:${mime};base64,${b.toString('base64')}`

describe('parseSignature', () => {
  it('accepts a PNG data URL and returns a hex bytea literal', () => {
    const r = parseSignature(url(png(600)))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.png.length).toBe(600)
      expect(r.hex.startsWith('\\x89504e47')).toBe(true)
    }
  })
  it.each([
    ['', 'missing'],
    ['hello', 'malformed'],
    [url(png(600), 'image/jpeg'), 'malformed'],
    ['data:image/png;base64,@@@@', 'malformed'],
    [url(png(100)), 'too_small'],
    [url(png(600, false)), 'not_png'],
    [url(png(MAX_SIGNATURE_BYTES + 10)), 'too_large'],
  ])('refuses %#: %s', (input, reason) => {
    const r = parseSignature(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(reason)
  })
  it('refuses oversized input without decoding it', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(5_000_000)
    expect(parseSignature(huge)).toEqual({ ok: false, reason: 'too_large' })
  })
})
