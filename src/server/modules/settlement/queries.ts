import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type VendorSettlement = {
  rates: { commission_bps: number }
  finalised: {
    orders: number
    gross_sales_kobo: number
    commission_kobo: number
    refunded_sales_kobo: number
    commission_reversed_kobo: number
    payable_kobo: number
    delivery_fees_kobo: number
  }
  pending: {
    orders: number
    gross_sales_kobo: number
    estimated_commission_kobo: number
    note: string
  }
  payout: { status: string; note: string }
  recent: {
    order_id: string
    order_number: string
    completed_at: string
    gross_kobo: number
    commission_kobo: number
    commission_bps: number
    refunded_kobo: number
    commission_reversed_kobo: number
    payable_kobo: number
    delivery_fee_kobo: number
  }[]
}

export type AdminSettlement = {
  note: string
  totals: {
    orders: number
    gross_sales_kobo: number
    commission_kobo: number
    afit_allocation_kobo: number
    paystack_budget_kobo: number
    commission_reversed_kobo: number
  }
  vendors: {
    vendor_id: string
    vendor_name: string
    orders: number
    gross_sales_kobo: number
    commission_kobo: number
    payable_kobo: number
  }[]
}

/** The database decides who may read this (a member of that shop at aal2); a stranger gets nothing. */
export async function vendorSettlement(vendorId: string): Promise<VendorSettlement | null> {
  if (!z.uuid().safeParse(vendorId).success) return null
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('vendor_settlement_summary', { p_vendor: vendorId })
  return error ? null : (data as VendorSettlement)
}

export async function adminSettlement(): Promise<AdminSettlement | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('admin_settlement_overview')
  return error ? null : (data as AdminSettlement)
}
