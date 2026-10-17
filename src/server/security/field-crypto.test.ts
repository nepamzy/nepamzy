import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  FieldCryptoError,
  decryptField,
  encryptField,
  encryptionConfigured,
  needsRotation,
  parseKeys,
} from './field-crypto'

const K1 = Buffer.alloc(32, 1).toString('base64')
const K2 = Buffer.alloc(32, 2).toString('base64')
const save = { ...process.env }
beforeEach(() => {
  process.env.BANK_DATA_KEYS = `k1:${K1}`
  process.env.BANK_DATA_KEY_ID = 'k1'
})
afterEach(() => {
  process.env = { ...save }
})

describe('field encryption (AES-256-GCM)', () => {
  it('round-trips and never contains the plaintext; each encryption uses a fresh IV', () => {
    const a = encryptField('0123456789')
    const b = encryptField('0123456789')
    expect(a).toMatch(/^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
    expect(a).not.toContain('0123456789')
    expect(a).not.toBe(b)
    expect(decryptField(a)).toBe('0123456789')
  })
  it('detects tampering with the ciphertext, the IV or the key id', () => {
    const [v, id, iv, ct] = encryptField('0123456789').split('.')
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)
    for (const bad of [`${v}.${id}.${iv}.${flip(ct!)}`, `${v}.${id}.${flip(iv!)}.${ct}`])
      expect(() => decryptField(bad)).toThrowError(FieldCryptoError)
    expect(() => decryptField(`${v}.k9.${iv}.${ct}`)).toThrowError(/unknown_key/)
    expect(() => decryptField('not-a-cipher')).toThrowError(/bad_format/)
  })
  it('fails closed without configuration and never leaks material in errors', () => {
    delete process.env.BANK_DATA_KEYS
    expect(encryptionConfigured()).toBe(false)
    expect(() => encryptField('0123456789')).toThrowError(/not_configured/)
    process.env.BANK_DATA_KEYS = 'k1:short'
    try {
      encryptField('0123456789')
    } catch (e) {
      expect(String(e)).not.toContain('short')
    }
    process.env.BANK_DATA_KEYS = `k1:${K1}`
    process.env.BANK_DATA_KEY_ID = 'missing'
    expect(encryptionConfigured()).toBe(false)
  })
  it('supports rotation: old ciphers stay readable, new ones use the current key', () => {
    const old = encryptField('0123456789')
    process.env.BANK_DATA_KEYS = `k1:${K1},k2:${K2}`
    process.env.BANK_DATA_KEY_ID = 'k2'
    expect(decryptField(old)).toBe('0123456789')
    expect(needsRotation(old)).toBe(true)
    const fresh = encryptField('0123456789')
    expect(fresh.startsWith('v1.k2.')).toBe(true)
    expect(needsRotation(fresh)).toBe(false)
    process.env.BANK_DATA_KEYS = `k2:${K2}` // old key removed too early: the old cipher can no longer be read
    expect(() => decryptField(old)).toThrowError(/unknown_key/)
  })
  it('rejects malformed key lists', () => {
    expect(() => parseKeys('k1:abc')).toThrowError(FieldCryptoError)
    expect(parseKeys(undefined).size).toBe(0)
  })
})
