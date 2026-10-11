import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type OrderRow = {
  id: string
  order_number: string
  customer_id: string
  vendor_id: string
  vendor_name: string
  fulfilment: 'pickup' | 'delivery'
  delivery_point_label: string | null
  pickup_location_snapshot: string | null
  prep_minutes_snapshot: number | null
  status: string
  items_total_kobo: number
  delivery_fee_kobo: number
  platform_fee_kobo: number
  discount_kobo: number
  total_kobo: number
  expires_at: string | null
  created_at: string
}
export type OrderItemRow = {
  id: string
  product_name: string
  quantity: number
  unit_price_kobo: number
  line_total_kobo: number
  options: { group: string; name: string; price_delta_kobo: number }[]
}
export type HistoryRow = {
  id: number
  from_status: string | null
  to_status: string
  reason: string | null
  created_at: string
}

const COLS =
  'id, order_number, customer_id, vendor_id, vendor_name, fulfilment, delivery_point_label, pickup_location_snapshot, prep_minutes_snapshot, status, items_total_kobo, delivery_fee_kobo, platform_fee_kobo, discount_kobo, total_kobo, expires_at, created_at'

/** RLS decides what is visible: a customer gets their own orders; a vendor member its vendor's; staff all. */
export async function listOrders(
  opts: { vendorId?: string; limit?: number } = {},
): Promise<OrderRow[]> {
  const sb = await createSupabaseServerClient()
  let q = sb
    .from('orders')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (opts.vendorId) q = q.eq('vendor_id', opts.vendorId)
  const { data } = await q
  return (data as OrderRow[] | null) ?? []
}

export async function getOrder(id: string) {
  if (!z.uuid().safeParse(id).success) return null
  const sb = await createSupabaseServerClient()
  const { data: order } = await sb.from('orders').select(COLS).eq('id', id).maybeSingle()
  if (!order) return null
  const [items, history, pay] = await Promise.all([
    sb
      .from('order_items')
      .select('id, product_name, quantity, unit_price_kobo, line_total_kobo, options')
      .eq('order_id', id)
      .order('product_name'),
    sb
      .from('order_status_history')
      .select('id, from_status, to_status, reason, created_at')
      .eq('order_id', id)
      .order('id'),
    sb
      .from('payment_attempts')
      .select('provider, status, amount_kobo, created_at')
      .eq('order_id', id),
  ])
  return {
    order: order as OrderRow,
    items: (items.data as OrderItemRow[] | null) ?? [],
    history: (history.data as HistoryRow[] | null) ?? [],
    payments:
      (pay.data as
        { provider: string; status: string; amount_kobo: number; created_at: string }[] | null) ??
      [],
  }
}

/** The ordering customer's one-time pickup code (database re-checks identity, aal2 and order status). */
export async function getPickupCode(orderId: string) {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('get_pickup_code', { p_order: orderId })
  if (error || !data) return null
  const r = data as { available: boolean; code?: string; expires_at?: string }
  return r.available && r.code ? { code: r.code, expiresAt: r.expires_at ?? null } : null
}

export async function getHandoverEvidence(orderId: string) {
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('handover_evidence')
    .select('recipient_name, signature_png, completed_at')
    .eq('order_id', orderId)
    .maybeSingle()
  return data as { recipient_name: string; signature_png: string; completed_at: string } | null
}

export async function listPaymentTransactions(orderId: string) {
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('payment_transactions')
    .select('status, amount_kobo, created_at')
    .eq('order_id', orderId)
    .order('created_at')
  return (data as { status: string; amount_kobo: number; created_at: string }[] | null) ?? []
}

/** Item lines for several orders at once (vendors need to know what to prepare). RLS applies. */
export async function listItemsForOrders(orderIds: string[]) {
  const map = new Map<string, OrderItemRow[]>()
  if (orderIds.length === 0) return map
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('order_items')
    .select('id, order_id, product_name, quantity, unit_price_kobo, line_total_kobo, options')
    .in('order_id', orderIds)
    .order('product_name')
  for (const r of (data as (OrderItemRow & { order_id: string })[] | null) ?? []) {
    map.set(r.order_id, [...(map.get(r.order_id) ?? []), r])
  }
  return map
}
