import 'server-only'
import { z } from 'zod'
import { paystackConfig } from '@/lib/env'

export class PaymentsUnavailable extends Error {}

const initResponse = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.url(),
    access_code: z.string().min(1),
    reference: z.string().min(1),
  }),
})
const verifyResponse = z.object({
  status: z.literal(true),
  data: z.object({
    status: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    reference: z.string(),
    id: z.union([z.number(), z.string()]).optional(),
  }),
})

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const cfg = paystackConfig()
  if (!cfg) throw new PaymentsUnavailable('Paystack is not configured for test mode')
  const res = await fetch(cfg.baseUrl + path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      ...(init.json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.json ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Paystack responded ${res.status}`)
  return res.json() as Promise<unknown>
}

/** amountKobo comes from the database order row, never from the browser. */
export async function initializeTransaction(a: {
  email: string
  amountKobo: number
  reference: string
  callbackUrl: string
  orderNumber: string
}) {
  const json = await call('/transaction/initialize', {
    method: 'POST',
    json: {
      email: a.email,
      amount: a.amountKobo,
      currency: 'NGN',
      reference: a.reference,
      callback_url: a.callbackUrl,
      metadata: { order_number: a.orderNumber },
    },
  })
  const r = initResponse.parse(json).data
  if (r.reference !== a.reference) throw new Error('Paystack returned a different reference')
  return r
}

export async function verifyTransaction(reference: string) {
  const json = await call(`/transaction/verify/${encodeURIComponent(reference)}`)
  const r = verifyResponse.parse(json).data
  if (r.reference !== reference) throw new Error('Paystack returned a different reference')
  return r
}
