import 'server-only'
import { z } from 'zod'
import { pickupCodeSecret } from '@/lib/env'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { derivePickupCode, hashPickupCode } from './pickup-code'

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
  delivery_fee_collection: 'paystack' | 'direct_to_rider'
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
  'id, order_number, customer_id, vendor_id, vendor_name, fulfilment, delivery_point_label, pickup_location_snapshot, prep_minutes_snapshot, status, items_total_kobo, delivery_fee_kobo, delivery_fee_collection, platform_fee_kobo, discount_kobo, total_kobo, expires_at, created_at'

/** Orders that no longer need anyone's attention (everything else is "unfinished"). */
export const FINISHED_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'RETURNED_TO_VENDOR',
] as const

export type ListOrdersOpts = {
  vendorId?: string
  /** Newest first, at most this many (default 50). Ignored when `page` is given. */
  limit?: number
  /** 1-based page of `pageSize` rows (default 25). With `page`, `hasMore` is reported by listOrdersPage. */
  page?: number
  pageSize?: number
  /** Only these statuses / everything except these statuses. */
  finished?: boolean
  /** Only these exact statuses. */
  statuses?: string[]
  oldestFirst?: boolean
  /** Order-number search (letters, digits and dashes only). */
  q?: string
}

/** RLS decides what is visible: a customer gets their own orders; a vendor member its vendor's; staff all. */
export async function listOrdersPage(
  opts: ListOrdersOpts = {},
): Promise<{ orders: OrderRow[]; hasMore: boolean }> {
  const sb = await createSupabaseServerClient()
  const pageSize = opts.pageSize ?? 25
  const page = Math.max(1, Math.min(opts.page ?? 1, 1000))
  let q = sb
    .from('orders')
    .select(COLS)
    .order('created_at', { ascending: Boolean(opts.oldestFirst) })
  if (opts.vendorId) q = q.eq('vendor_id', opts.vendorId)
  const finished = `(${FINISHED_ORDER_STATUSES.join(',')})`
  if (opts.statuses) q = q.in('status', opts.statuses)
  if (opts.finished === true) q = q.in('status', [...FINISHED_ORDER_STATUSES])
  if (opts.finished === false) q = q.not('status', 'in', finished)
  const needle = (opts.q ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 30)
  if (needle) q = q.ilike('order_number', `%${needle}%`)
  const from = (page - 1) * pageSize
  const { data } = await q.range(from, from + pageSize) // one extra row tells whether another page exists
  const rows = (data as OrderRow[] | null) ?? []
  return { orders: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}

export async function listOrders(opts: ListOrdersOpts = {}): Promise<OrderRow[]> {
  if (opts.page) return (await listOrdersPage(opts)).orders
  const sb = await createSupabaseServerClient()
  let q = sb
    .from('orders')
    .select(COLS)
    .order('created_at', { ascending: Boolean(opts.oldestFirst) })
    .limit(opts.limit ?? 50)
  if (opts.vendorId) q = q.eq('vendor_id', opts.vendorId)
  if (opts.statuses) q = q.in('status', opts.statuses)
  if (opts.finished === true) q = q.in('status', [...FINISHED_ORDER_STATUSES])
  if (opts.finished === false) q = q.not('status', 'in', `(${FINISHED_ORDER_STATUSES.join(',')})`)
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

/**
 * The ordering customer's one-time pickup code. The database proves identity/aal2/status and hands back a nonce;
 * the code is derived here from the server-only secret. If the secret is missing we return nothing (fail closed).
 */
export async function getPickupCode(orderId: string) {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('get_pickup_code', { p_order: orderId })
  if (error || !data) return null
  const r = data as {
    available: boolean
    nonce?: string
    registered?: boolean
    expires_at?: string
  }
  if (!r.available || !r.nonce) return null
  try {
    const code = derivePickupCode(pickupCodeSecret(), orderId, r.nonce)
    if (!r.registered) await registerPickupCode(orderId, code)
    return { code, expiresAt: r.expires_at ?? null }
  } catch (e) {
    logger.error('pickup code unavailable', { err: String(e) })
    return null
  }
}

/** Stores the hash of the derived code (only if none is stored yet). Service role; the code itself is never stored. */
export async function registerPickupCode(orderId: string, code: string) {
  await createSupabaseServiceClient().rpc('pickup_code_register', {
    p_order: orderId,
    p_hash: hashPickupCode(code),
  })
}

/** Called right after a vendor marks a pickup order ready, so the hash exists before the customer opens the page. */
export async function registerPickupCodeForOrder(orderId: string) {
  const svc = createSupabaseServiceClient()
  const { data } = await svc
    .from('pickup_codes')
    .select('nonce, code_hash')
    .eq('order_id', orderId)
    .maybeSingle()
  if (!data || data.code_hash) return
  await registerPickupCode(
    orderId,
    derivePickupCode(pickupCodeSecret(), orderId, data.nonce as string),
  )
}

export async function getHandoverEvidence(orderId: string) {
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('handover_evidence')
    .select(
      'recipient_name, signature_png, completed_at, capture_method, typed_text, evidence_kind, arrival_detected_at',
    )
    .eq('order_id', orderId)
    .maybeSingle()
  return data as {
    recipient_name: string
    signature_png: string | null
    completed_at: string
    capture_method: 'drawn' | 'typed_acknowledgement'
    typed_text: string | null
    evidence_kind: 'pickup' | 'delivery'
    arrival_detected_at: string | null
  } | null
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
