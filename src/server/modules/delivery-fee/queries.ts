import 'server-only'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FieldCryptoError, decryptField } from '@/server/security/field-crypto'
import { clientIp, rateLimit } from '@/server/modules/identity-and-access/security'

export type DfpReceipt = {
  id: string
  number: string
  status: 'issued' | 'void'
  basis: 'customer_and_rider_confirmation' | 'administrator_resolution'
  issued_at: string
  token: string | null
}

export type DfpPayment = {
  state: 'payment'
  viewer: 'customer' | 'rider' | 'staff'
  id: string
  order_id: string
  order_number: string
  amount_kobo: number
  currency: string
  status:
    | 'awaiting_transfer'
    | 'customer_reported'
    | 'rider_confirmed'
    | 'rider_disputed'
    | 'resolved_received'
    | 'resolved_not_received'
  rider_name: string
  customer_name: string
  bank_name: string
  account_name: string
  /** Masked for everyone. */
  account_masked: string | null
  /** Full number: set ONLY on the paying customer's own screen, decrypted on the server for that request. */
  account_number?: string
  account_unavailable?: boolean
  details_erased?: boolean
  opened_at: string
  customer_reported_at: string | null
  customer_note: string | null
  rider_responded_at: string | null
  rider_note: string | null
  resolved_at: string | null
  resolution_reason: string | null
  receipt: DfpReceipt | null
  history?: {
    action: string
    actor_role: string
    to_status: string | null
    at: string
    note: string | null
  }[]
}

export type DfpOrderView =
  | DfpPayment
  | {
      state:
        'not_applicable' | 'ambiguous' | 'not_ready' | 'ready_to_open' | 'rider_details_missing'
      viewer: 'customer' | 'rider' | 'staff'
      order_number: string
      reason?: string
      amount_kobo?: number
      rider_name?: string
    }

export type RiderBankDetails =
  | { set: false }
  | {
      set: true
      bank_name: string
      account_name: string
      account_masked: string
      encrypted: boolean
      updated_at: string
    }

export type ReceiptCheck =
  | { valid: false }
  | { valid: false; limited: true }
  | {
      valid: true
      receipt_number: string
      status: 'issued' | 'void'
      issued_at: string
      amount_kobo: number
      currency: string
      payment_method: string
      basis: string
      customer_reported: boolean
      rider_confirmed: boolean
    }

/** The database decides who may read this: the order's customer, its assigned rider, or staff (masked). */
export async function deliveryFeeForOrder(orderId: string): Promise<DfpOrderView | null> {
  if (!z.uuid().safeParse(orderId).success) return null
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('delivery_fee_payment_for_order', { p_order: orderId })
  if (error) return null
  const v = data as DfpOrderView & {
    account_cipher?: string | null
    account_number_legacy?: string | null
  }
  if (v.state !== 'payment') return v
  const { account_cipher, account_number_legacy, ...rest } = v
  const out: DfpPayment = rest as DfpPayment
  if (v.viewer === 'customer' && !v.details_erased) {
    try {
      if (account_cipher) out.account_number = decryptField(account_cipher)
      else if (account_number_legacy)
        out.account_number = account_number_legacy // not yet encrypted by the backfill
      else out.account_unavailable = true
    } catch (e) {
      logger.error('bank details could not be decrypted', {
        code: e instanceof FieldCryptoError ? e.code : 'unknown',
      })
      out.account_unavailable = true
    }
  }
  return out
}

export async function myDeliveryFeePayments(): Promise<DfpPayment[]> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('my_delivery_fee_payments')
  if (error) return []
  // The list never carries the cipher or any plain number; only the paying screen decrypts.
  return (data as Record<string, unknown>[]).map((row) => {
    const p = { ...row }
    delete p.account_cipher
    delete p.account_number_legacy
    return p as unknown as DfpPayment
  })
}

export async function myRiderBankDetails(): Promise<RiderBankDetails | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('my_rider_bank_details')
  return error ? null : (data as RiderBankDetails)
}

export async function adminDeliveryFeePayments(status?: string) {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('admin_list_delivery_fee_payments', {
    p_status: status ?? null,
  })
  if (error) return null
  return data as {
    payments: DfpPayment[]
    ambiguous_orders: { order_id: string; order_number: string }[]
  }
}

/** Window and ceiling for public receipt checks per client address (configurable; the limiter is shared by all app instances). */
export const RECEIPT_CHECK_WINDOW_SECONDS = 600
export const receiptCheckMax = () => {
  const n = Number(process.env.RECEIPT_VERIFY_MAX_PER_WINDOW)
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 30
}

/**
 * Public: proves a receipt record exists. Never returns names or bank details. Every call (valid, invalid or malformed)
 * counts against a per-address ceiling so tokens cannot be enumerated; the token itself is never logged.
 */
export async function verifyReceipt(token: string): Promise<ReceiptCheck> {
  const ip = await clientIp()
  if (!(await rateLimit(`receipt-check:${ip}`, RECEIPT_CHECK_WINDOW_SECONDS, receiptCheckMax())))
    return { valid: false, limited: true }
  if (!/^[0-9a-f]{48}$/.test(token)) return { valid: false }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('verify_delivery_fee_receipt', { p_token: token })
  return error || !data ? { valid: false } : (data as ReceiptCheck)
}
