import { describe, expect, it } from 'vitest'
import { derivePickupCode, hashPickupCode } from './pickup-code'

const S1 = 'a'.repeat(32)
const S2 = 'b'.repeat(32)
const O = '11111111-1111-1111-1111-111111111111'

describe('pickup code derivation', () => {
  it('is deterministic, 8 hex characters, and depends on secret, order and nonce', () => {
    const c = derivePickupCode(S1, O, 'n1')
    expect(c).toMatch(/^[0-9A-F]{8}$/)
    expect(derivePickupCode(S1, O, 'n1')).toBe(c)
    expect(derivePickupCode(S2, O, 'n1')).not.toBe(c)
    expect(derivePickupCode(S1, O, 'n2')).not.toBe(c)
    expect(derivePickupCode(S1, '22222222-2222-2222-2222-222222222222', 'n1')).not.toBe(c)
  })
  it('hashes case-insensitively and ignores surrounding whitespace', () => {
    expect(hashPickupCode(' abcdef12 ')).toBe(hashPickupCode('ABCDEF12'))
    expect(hashPickupCode('ABCDEF12')).toMatch(/^[0-9a-f]{64}$/)
  })
})
