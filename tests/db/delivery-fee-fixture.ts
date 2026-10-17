import type { PoolClient } from 'pg'
import { AAL2, addToCart, createOrderAs, createUser, payOrder } from './helpers'
import { mkRider, mkShop } from './rider-helpers'

/** A paid, delivered order whose delivery fee was NOT collected by Paystack (marker set before payment, as a direct-mode checkout would). */
export async function directPaidDelivery(c: PoolClient) {
  const shop = await mkShop(c)
  const cust = await createUser(c, 'cust')
  await addToCart(c, AAL2(cust), shop.product, 1)
  const order = await createOrderAs(c, AAL2(cust), 'delivery', shop.point)
  await c.query(`alter table public.orders disable trigger orders_collection_guard`)
  await c.query(
    `update public.orders set delivery_fee_collection='direct_to_rider', total_kobo = total_kobo - delivery_fee_kobo where id=$1`,
    [order],
  )
  await c.query(`alter table public.orders enable trigger orders_collection_guard`)
  await payOrder(c, AAL2(cust), order)
  await c.query(`update public.orders set status='COMPLETED' where id=$1`, [order])
  const rider = await mkRider(c)
  await c.query(`update public.profiles set display_name='Ada Customer' where id=$1`, [cust])
  await c.query(
    `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, status, completed_at) values ($1,$2,$3,1,'completed', now())`,
    [order, rider.id, rider.shift],
  )
  return { ...shop, cust, order, rider: rider.id }
}
