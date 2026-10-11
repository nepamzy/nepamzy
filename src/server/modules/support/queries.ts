import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type ItemBalance = {
  id: string
  name: string
  bought: number
  unit_price_kobo: number
  refund_left: number
  return_left: number
}
export type MyRefund = {
  id: string
  amount_kobo: number
  status: string
  reason: string
  decision_reason: string | null
  provider_mode: 'none' | 'fake' | 'paystack_test' | 'paystack_live'
  created_at: string
}
export type StaffRefund = MyRefund & {
  order_id: string
  order_number: string
  source: string
  own_request: boolean
  items: { name: string; quantity: number; amount_kobo: number }[]
  events: { action: string; to: string | null; note: string | null; at: string }[]
}
export type ReturnRow = {
  id: string
  order_id: string
  order_number: string
  status: string
  reason: string
  decision_reason: string | null
  vendor_condition: string | null
  created_at: string
  return_rule: string
  items: { name: string; quantity: number }[]
}
export type CaseSummary = {
  id: string
  case_no: string
  order_number: string
  case_type: string
  status: string
  created_at: string
  role?: string
  decision?: string | null
  assigned_to_me?: boolean
}
export type CaseView = {
  id: string
  case_no: string
  viewer: 'customer' | 'vendor' | 'rider' | 'support'
  order_id: string
  order_number: string
  case_type: string
  status: string
  created_at: string
  description: string | null
  decision: string | null
  decision_reason: string | null
  statements: { party: string; body: string; visibility: string; at: string }[]
  timeline: { action: string; to: string | null; at: string }[]
  order_progress: { status: string; at: string }[]
}

const uuid = z.uuid()
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc(fn, args)
  if (error) return null
  return data as T
}

export const getItemBalances = (order: string) =>
  uuid.safeParse(order).success
    ? rpc<ItemBalance[]>('my_order_item_balances', { p_order: order })
    : null
export const getMyOrderRefunds = (order: string) =>
  uuid.safeParse(order).success
    ? rpc<{ refundable_kobo: number; refunds: MyRefund[] }>('my_order_refunds', { p_order: order })
    : null
export const listReturns = async (order?: string) =>
  (await rpc<ReturnRow[]>('list_returns', { p_order: order ?? null })) ?? []
export const listMyCases = async () => (await rpc<CaseSummary[]>('list_my_cases')) ?? []
export const getCase = (id: string) =>
  uuid.safeParse(id).success ? rpc<CaseView>('get_case', { p_case: id }) : null
export const staffListCases = async (status?: string) =>
  (await rpc<CaseSummary[]>('staff_list_cases', { p_status: status ?? null })) ?? []
export const staffCaseBundle = (id: string) =>
  uuid.safeParse(id).success
    ? rpc<Record<string, unknown>>('staff_case_bundle', { p_case: id })
    : null
export const staffListRefunds = async (status?: string) =>
  (await rpc<StaffRefund[]>('staff_list_refunds', { p_status: status ?? null })) ?? []
