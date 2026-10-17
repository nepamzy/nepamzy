import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptField, encryptField } from '@/server/security/field-crypto'

// The backfill/rotation script ships its own copy of the algorithm; prove the two interoperate in both directions.
const script = (await import('../../scripts/lib/bank-crypto.mjs')) as {
  encrypt: (s: string) => string
  decrypt: (s: string) => string
  keyIdOf: (s: string) => string | null
}
const save = { ...process.env }
beforeEach(() => {
  process.env.BANK_DATA_KEYS = `a1:${Buffer.alloc(32, 7).toString('base64')}`
  process.env.BANK_DATA_KEY_ID = 'a1'
})
afterEach(() => {
  process.env = { ...save }
})

describe('backfill script and application use the same cipher format', () => {
  it('app -> script and script -> app', () => {
    expect(script.decrypt(encryptField('0123456789'))).toBe('0123456789')
    expect(decryptField(script.encrypt('9876543210'))).toBe('9876543210')
    expect(script.keyIdOf(script.encrypt('0123456789'))).toBe('a1')
  })
})
