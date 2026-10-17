import { createHash, createHmac } from 'node:crypto'

/** Pure functions (secret passed in) so tests can use a throwaway secret. */
export const derivePickupCode = (secret: string, orderId: string, nonce: string) =>
  createHmac('sha256', secret).update(`${orderId}:${nonce}`).digest('hex').slice(0, 8).toUpperCase()

export const hashPickupCode = (code: string) =>
  createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
