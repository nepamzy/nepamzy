import { z } from 'zod'

export type PaymentEventCall = {
  eventId: string
  type: 'charge.success' | 'charge.failed'
  reference: string
  amountKobo: number
  currency: string
  /** Whitelisted, minimal copy kept for the audit trail (no customer/card details). */
  payload: Record<string, unknown>
}

const envelope = z.object({
  event: z.string().max(100),
  data: z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      reference: z.string().min(1).max(100),
      amount: z.number().int().nonnegative(),
      currency: z.string().min(1).max(10),
      status: z.string().max(40).optional(),
      paid_at: z.string().max(60).nullish(),
      channel: z.string().max(40).nullish(),
    })
    .loose(),
})

/** Maps a verified webhook body to a database call. Returns null for events we deliberately ignore. */
export function webhookToCall(body: unknown): PaymentEventCall | 'invalid' | null {
  const p = envelope.safeParse(body)
  if (!p.success) return 'invalid'
  const { event, data } = p.data
  if (event !== 'charge.success' && event !== 'charge.failed') return null
  const stableId = data.id !== undefined ? String(data.id) : data.reference
  return {
    eventId: `ps:${event}:${stableId}`.slice(0, 200),
    type: event,
    reference: data.reference,
    amountKobo: data.amount,
    currency: data.currency,
    payload: {
      id: data.id ?? null,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      status: data.status ?? null,
      paid_at: data.paid_at ?? null,
      channel: data.channel ?? null,
    },
  }
}

/** Maps the provider's answer to a verify request (the redirect alone is never trusted). */
export function verifyToCall(
  reference: string,
  d: {
    status: string
    amount: number
    currency: string
    id?: number | string
  },
): PaymentEventCall | null {
  if (d.status !== 'success' && d.status !== 'failed') return null
  const type = d.status === 'success' ? 'charge.success' : 'charge.failed'
  return {
    eventId: `verify:${type}:${reference}`.slice(0, 200),
    type,
    reference,
    amountKobo: d.amount,
    currency: d.currency,
    payload: {
      source: 'verify',
      reference,
      amount: d.amount,
      currency: d.currency,
      status: d.status,
      id: d.id ?? null,
    },
  }
}
