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

const banksResponse = z.object({
  status: z.literal(true),
  data: z.array(
    z.object({ name: z.string().min(1), code: z.string().min(1), active: z.boolean().optional() }),
  ),
})
const resolveResponse = z.object({
  status: z.literal(true),
  data: z.object({ account_name: z.string().min(1), account_number: z.string().min(1) }),
})

export type Bank = { name: string; code: string }

/** Nigerian banks Paystack can look up. Sorted by name. */
export async function listBanks(): Promise<Bank[]> {
  const json = await call('/bank?country=nigeria&currency=NGN&perPage=100')
  return banksResponse
    .parse(json)
    .data.filter((b) => b.active !== false)
    .map((b) => ({ name: b.name, code: b.code }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The name the bank has on file for this account, or null when Paystack cannot find it. */
export async function resolveAccountName(number: string, bankCode: string): Promise<string | null> {
  const cfg = paystackConfig()
  if (!cfg) throw new PaymentsUnavailable('Paystack is not configured for test mode')
  const res = await fetch(
    `${cfg.baseUrl}/bank/resolve?account_number=${encodeURIComponent(number)}&bank_code=${encodeURIComponent(bankCode)}`,
    {
      headers: { Authorization: `Bearer ${cfg.secretKey}` },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    },
  )
  if (res.status === 422 || res.status === 404) return null
  if (!res.ok) throw new Error(`Paystack responded ${res.status}`)
  return resolveResponse.parse(await res.json()).data.account_name.toUpperCase()
}

// ---------------------------------------------------------------- transfers (paying shops)
export type TransferState = 'paid' | 'pending' | 'failed' | 'otp'
export type TransferOutcome =
  { state: TransferState; code: string | null; message: string | null } | { state: 'duplicate' }

const transferEnvelope = z.object({
  status: z.boolean(),
  message: z.string().optional(),
  data: z
    .object({
      status: z.string().optional(),
      transfer_code: z.string().optional(),
      recipient_code: z.string().optional(),
      reference: z.string().optional(),
    })
    .partial()
    .optional(),
})

/** Paystack's words for a transfer's progress, folded into the four things the payout book cares about. */
export function transferState(s: string | undefined): TransferState {
  switch ((s ?? '').toLowerCase()) {
    case 'success':
      return 'paid'
    case 'otp':
      return 'otp'
    case 'failed':
    case 'reversed':
    case 'rejected':
    case 'blocked':
    case 'abandoned':
      return 'failed'
    default:
      return 'pending' // pending, received, processing, queued ...
  }
}

async function raw(path: string, method: 'GET' | 'POST', json?: unknown) {
  const cfg = paystackConfig()
  if (!cfg) throw new PaymentsUnavailable('Paystack is not configured')
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })
  const body = transferEnvelope.safeParse(await res.json().catch(() => null))
  return { status: res.status, ok: res.ok, body: body.success ? body.data : null }
}

/** A saved Paystack "recipient" for a shop's bank account. Created once, then reused. */
export async function createTransferRecipient(a: {
  name: string
  accountNumber: string
  bankCode: string
}): Promise<string> {
  const r = await raw('/transferrecipient', 'POST', {
    type: 'nuban',
    name: a.name.slice(0, 100),
    account_number: a.accountNumber,
    bank_code: a.bankCode,
    currency: 'NGN',
  })
  const code = r.body?.data?.recipient_code
  if (!r.ok || !code) throw new Error(`Paystack could not save the recipient (${r.status})`)
  return code
}

/** Sends money from the Paystack balance to a recipient. The reference makes a repeat harmless: Paystack refuses a second use. */
export async function startTransfer(a: {
  amountKobo: number
  recipient: string
  reference: string
  reason: string
}): Promise<TransferOutcome> {
  const r = await raw('/transfer', 'POST', {
    source: 'balance',
    amount: a.amountKobo,
    recipient: a.recipient,
    reference: a.reference,
    reason: a.reason.slice(0, 100),
    currency: 'NGN',
  })
  if (r.ok && r.body?.status)
    return {
      state: transferState(r.body.data?.status),
      code: r.body.data?.transfer_code ?? null,
      message: null,
    }
  const msg = (r.body?.message ?? '').slice(0, 200)
  if (r.status === 400 && /reference/i.test(msg) && /(exist|duplicate|used)/i.test(msg))
    return { state: 'duplicate' }
  if (r.status === 429 || r.status >= 500) throw new Error(`Paystack responded ${r.status}`)
  return { state: 'failed', code: null, message: msg || `Paystack responded ${r.status}` }
}

/** What Paystack says about a transfer we started earlier, or null when it has no record of that reference. */
export async function verifyTransfer(reference: string): Promise<TransferOutcome | null> {
  const r = await raw(`/transfer/verify/${encodeURIComponent(reference)}`, 'GET')
  if (r.status === 404) return null
  if (!r.ok || !r.body?.status) throw new Error(`Paystack responded ${r.status}`)
  return {
    state: transferState(r.body.data?.status),
    code: r.body.data?.transfer_code ?? null,
    message: null,
  }
}

/** Test mode only: Paystack asks for a one-time code on a transfer; in test mode the code is always 123456. */
export async function finalizeTestTransfer(code: string): Promise<TransferOutcome> {
  const r = await raw('/transfer/finalize_transfer', 'POST', {
    transfer_code: code,
    otp: '123456',
  })
  if (r.ok && r.body?.status)
    return { state: transferState(r.body.data?.status), code, message: null }
  return { state: 'failed', code, message: (r.body?.message ?? 'otp not accepted').slice(0, 200) }
}
