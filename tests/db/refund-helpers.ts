import type { PoolClient } from 'pg'
import {
  AAL2,
  addToCart,
  createOrderAs,
  createUser,
  fixPricing,
  giveRole,
  mkProduct,
  mkVendor,
  payOrder,
} from './helpers'
import { callFails, callJson } from './rider-helpers'

export { callFails, callJson }

/** A paid PICKUP order with three lines (1000, 1500 and 500 naira) forced to the given finished status. */
export async function paidOrder(c: PoolClient, o: { status?: string; discountKobo?: number } = {}) {
  await fixPricing(c, { delivery: 0 })
  const owner = await createUser(c, 'owner')
  const vendor = await mkVendor(c, { owner })
  const prices = [100000, 150000, 50000]
  const products: string[] = []
  for (const price of prices) products.push(await mkProduct(c, vendor.id, { price, stock: 50 }))
  const cust = await createUser(c, 'cust')
  for (const p of products) await addToCart(c, AAL2(cust), p, 1)
  const order = await createOrderAs(c, AAL2(cust), 'pickup', null)
  await payOrder(c, AAL2(cust), order)
  if (o.discountKobo)
    await c.query(
      `update public.orders set discount_kobo=$2, total_kobo = total_kobo - $2 where id=$1`,
      [order, o.discountKobo],
    )
  await c.query(`update public.orders set status=$2 where id=$1`, [order, o.status ?? 'COMPLETED'])
  const items = (
    await c.query(
      `select id, product_name, quantity, unit_price_kobo, line_total_kobo from public.order_items where order_id=$1 order by unit_price_kobo`,
      [order],
    )
  ).rows.map((r) => ({
    id: r.id as string,
    product_name: r.product_name as string,
    quantity: Number(r.quantity),
    unit_price_kobo: Number(r.unit_price_kobo),
  }))
  const received = Number(
    (
      await c.query(
        `select coalesce(sum(amount_kobo),0) n from public.ledger_entries where order_id=$1 and entry_type='payment_received'`,
        [order],
      )
    ).rows[0].n,
  )
  return { owner, vendor: vendor.id, cust, order, items, received, products }
}

export async function staff(
  c: PoolClient,
  role: 'support_agent' | 'finance_admin' | 'platform_admin',
) {
  const id = await createUser(c, role)
  await giveRole(c, id, role)
  return id
}

export const requestRefund = (
  c: PoolClient,
  cust: string,
  order: string,
  items: { order_item_id: string; quantity: number }[] | null,
  reason = 'The item was missing from my order',
  key = `key-${Math.random().toString(36).slice(2)}-${Date.now()}`,
) =>
  callJson(c, AAL2(cust), `select public.customer_request_refund($1,$2::jsonb,$3,$4) r`, [
    order,
    items ? JSON.stringify(items) : null,
    reason,
    key,
  ]) as Promise<{ id: string; status: string; amount_kobo: number; replayed: boolean }>

export const refundRow = async (c: PoolClient, id: string) =>
  (await c.query(`select * from public.refunds where id=$1`, [id])).rows[0]

export const orderStatusOf = async (c: PoolClient, id: string) =>
  (await c.query(`select status from public.orders where id=$1`, [id])).rows[0].status as string

/** requested -> approved (by finance) -> processing (fake) for tests that need to start from there. */
export async function approve(
  c: PoolClient,
  fin: string,
  refund: string,
  reason = 'Approved after review',
) {
  await callJson(c, AAL2(fin), `select public.refund_decide($1,'approve',$2) r`, [refund, reason])
}
export async function startFake(c: PoolClient, fin: string, refund: string) {
  await callJson(c, AAL2(fin), `select public.refund_begin_execution($1,'fake') r`, [refund])
}
export const outcome = (
  c: PoolClient,
  fin: string,
  refund: string,
  o: 'succeeded' | 'failed' | 'unknown',
  ref: string | null = 'fake_re_1',
) =>
  callJson(c, AAL2(fin), `select public.refund_record_outcome($1,$2,$3,'fake provider') r`, [
    refund,
    o,
    ref,
  ]) as Promise<{ ok: boolean; status?: string; replayed?: boolean; conflict?: boolean }>
