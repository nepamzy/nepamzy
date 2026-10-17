import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { CheckoutProblem } from '@/lib/db-errors'

export type QuoteLine = {
  item_id: string
  product_id: string
  name: string
  quantity: number
  base_price_kobo: number
  unit_price_kobo: number
  line_total_kobo: number
  options: { id: string; group: string; name: string; price_delta_kobo: number }[]
}
export type Quote = {
  empty: boolean
  fulfilment: 'pickup' | 'delivery'
  vendor_id?: string
  vendor_name?: string
  delivery_point_label?: string | null
  lines: QuoteLine[]
  problems: CheckoutProblem[]
  items_total_kobo: number
  delivery_fee_kobo: number
  platform_fee_kobo: number
  discount_kobo: number
  total_kobo: number
  delivery_fee_collection?: 'paystack' | 'direct_to_rider'
  delivery_fee_to_rider_kobo?: number
}
export type DeliveryPoint = { id: string; label: string; instructions: string | null }

export async function getQuote(
  fulfilment: 'pickup' | 'delivery',
  point: string | null,
): Promise<Quote | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('cart_quote', {
    p_fulfilment: fulfilment,
    p_delivery_point: point,
  })
  return error ? null : (data as Quote)
}
export async function listDeliveryPoints(): Promise<DeliveryPoint[]> {
  const sb = await createSupabaseServerClient()
  const { data } = await sb.rpc('list_delivery_points')
  return (data as DeliveryPoint[] | null) ?? []
}
