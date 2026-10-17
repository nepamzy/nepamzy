import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Authenticated encryption (AES-256-GCM) for sensitive fields stored in the database (bank account numbers).
 *
 *   cipher string = v1.<keyId>.<iv: 12 random bytes, base64url>.<ciphertext || 16-byte tag, base64url>
 *
 * Keys come ONLY from server environment configuration, never from the database or the repository:
 *   BANK_DATA_KEYS    = "k1:<base64 of 32 random bytes>[,k2:<...>]"   (every key that may still be needed to decrypt)
 *   BANK_DATA_KEY_ID  = "k2"                                          (the key used for NEW encryption)
 * Rotation: add the new key to BANK_DATA_KEYS, point BANK_DATA_KEY_ID at it, run scripts/encrypt-bank-details.mjs --rotate,
 * and remove the old key only after the script reports nothing left on it.
 * Errors never contain the plaintext, the cipher string or key material.
 */
export class FieldCryptoError extends Error {
  constructor(
    public readonly code: 'not_configured' | 'bad_format' | 'unknown_key' | 'auth_failed',
  ) {
    super(`field encryption: ${code}`)
  }
}

const AAD = Buffer.from('afit-market:bank-account-number:v1')
const FORMAT = /^v1\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{20,200})$/

export function parseKeys(raw: string | undefined): Map<string, Buffer> {
  const keys = new Map<string, Buffer>()
  for (const part of (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const i = part.indexOf(':')
    const id = part.slice(0, i)
    const key = Buffer.from(part.slice(i + 1), 'base64')
    if (i < 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32)
      throw new FieldCryptoError('not_configured')
    keys.set(id, key)
  }
  return keys
}

function config() {
  const keys = parseKeys(process.env.BANK_DATA_KEYS)
  const current = process.env.BANK_DATA_KEY_ID ?? ''
  if (!keys.has(current)) throw new FieldCryptoError('not_configured')
  return { keys, current }
}

export const encryptionConfigured = () => {
  try {
    config()
    return true
  } catch {
    return false
  }
}

export function encryptField(plain: string): string {
  const { keys, current } = config()
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keys.get(current)!, iv)
  c.setAAD(AAD)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()])
  return `v1.${current}.${iv.toString('base64url')}.${ct.toString('base64url')}`
}

export function decryptField(cipher: string): string {
  const m = FORMAT.exec(cipher)
  if (!m) throw new FieldCryptoError('bad_format')
  const key = config().keys.get(m[1]!)
  if (!key) throw new FieldCryptoError('unknown_key')
  const raw = Buffer.from(m[3]!, 'base64url')
  if (raw.length < 17) throw new FieldCryptoError('bad_format')
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(m[2]!, 'base64url'))
    d.setAAD(AAD)
    d.setAuthTag(raw.subarray(raw.length - 16))
    return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8')
  } catch {
    throw new FieldCryptoError('auth_failed')
  }
}

/** True when the cipher was made with a key other than the current one (needs re-encryption on rotation). */
export const needsRotation = (cipher: string) => FORMAT.exec(cipher)?.[1] !== config().current
