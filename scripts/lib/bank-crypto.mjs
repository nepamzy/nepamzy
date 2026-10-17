// Same algorithm and format as src/server/security/field-crypto.ts (a unit test proves they interoperate).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const AAD = Buffer.from('afit-market:bank-account-number:v1')
const FORMAT = /^v1\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{20,200})$/

function keys() {
  const map = new Map()
  for (const part of (process.env.BANK_DATA_KEYS ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const i = part.indexOf(':')
    const key = Buffer.from(part.slice(i + 1), 'base64')
    if (i < 1 || key.length !== 32)
      throw new Error('BANK_DATA_KEYS is invalid (expected id:base64-of-32-bytes)')
    map.set(part.slice(0, i), key)
  }
  return map
}
export function currentKeyId() {
  const id = process.env.BANK_DATA_KEY_ID ?? ''
  if (!keys().has(id)) throw new Error('BANK_DATA_KEY_ID does not name a configured key')
  return id
}
export const keyIdOf = (cipher) => FORMAT.exec(cipher)?.[1] ?? null
export function encrypt(plain) {
  const id = currentKeyId()
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keys().get(id), iv)
  c.setAAD(AAD)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()])
  return `v1.${id}.${iv.toString('base64url')}.${ct.toString('base64url')}`
}
export function decrypt(cipher) {
  const m = FORMAT.exec(cipher)
  if (!m) throw new Error('unrecognised cipher format')
  const key = keys().get(m[1])
  if (!key) throw new Error('the key that encrypted this value is not configured')
  const raw = Buffer.from(m[3], 'base64url')
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(m[2], 'base64url'))
  d.setAAD(AAD)
  d.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8')
}
