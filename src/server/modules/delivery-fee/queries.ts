import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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
  account_number: string
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
      account_number: string
      account_masked: string
      updated_at: string
    }

export type ReceiptCheck =
  | { valid: false }
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
  return error ? null : (data as DfpOrderView)
}

export async function myDeliveryFeePayments(): Promise<DfpPayment[]> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('my_delivery_fee_payments')
  return error ? [] : (data as DfpPayment[])
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

/** Public: proves a receipt record exists. Never returns names or bank details. */
export async function verifyReceipt(token: string): Promise<ReceiptCheck> {
  if (!/^[0-9a-f]{48}$/.test(token)) return { valid: false }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('verify_delivery_fee_receipt', { p_token: token })
  return error || !data ? { valid: false } : (data as ReceiptCheck)
}
