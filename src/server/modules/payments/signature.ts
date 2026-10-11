import { createHmac, timingSafeEqual } from 'node:crypto'

/** Paystack signs the RAW request body with HMAC-SHA512 (hex) using the secret key: `x-paystack-signature`. */
export function signBody(rawBody: string, secretKey: string): string {
  return createHmac('sha512', secretKey).update(rawBody, 'utf8').digest('hex')
}

/** Constant-time check. Missing, malformed or wrong-length signatures are rejected. */
export function verifySignature(
  rawBody: string,
  header: string | null,
  secretKey: string,
): boolean {
  if (!header || !/^[0-9a-f]{128}$/i.test(header)) return false
  const expected = Buffer.from(signBody(rawBody, secretKey), 'hex')
  const given = Buffer.from(header.toLowerCase(), 'hex')
  return expected.length === given.length && timingSafeEqual(expected, given)
}
