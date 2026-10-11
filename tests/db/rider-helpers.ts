import type { PoolClient } from 'pg'
import {
  AAL2,
  addToCart,
  as,
  createOrderAs,
  createUser,
  failure,
  fixPricing,
  giveRole,
  mkDeliveryPoint,
  mkProduct,
  mkVendor,
  payOrder,
  type Principal,
} from './helpers'

/** SYNTHETIC coordinates (Gulf of Guinea, "Null Island" area) - deliberately not any real place. */
export const SYNTH = { lat: 0.0, lng: 0.0 }
export const POINT = { lat: 0.01, lng: 0.01, radius: 60 }

export async function currentTermsVersion(c: PoolClient) {
  return (
    await c.query(
      `select value #>> '{}' v from public.platform_settings where key='rider_terms_current_version'`,
    )
  ).rows[0].v as string
}

/** An approved rider. Optionally with terms acknowledged and an active shift. */
export async function mkRider(
  c: PoolClient,
  o: {
    terms?: boolean
    active?: boolean
    status?: 'approved' | 'suspended' | 'pending'
    role?: boolean
  } = {},
) {
  const id = await createUser(c, 'rider')
  if (o.role !== false) await giveRole(c, id, 'rider')
  await c.query(
    `insert into public.rider_profiles (user_id, full_name, contact_phone, status) values ($1,'Test Rider','08000000000',$2)`,
    [id, o.status ?? 'approved'],
  )
  if (o.terms ?? true)
    await c.query(
      `insert into public.rider_terms_acknowledgements (user_id, version) values ($1,$2)`,
      [id, await currentTermsVersion(c)],
    )
  let shift: string | null = null
  if (o.active ?? true)
    shift = (
      await c.query(`insert into public.rider_shifts (rider_id) values ($1) returning id`, [id])
    ).rows[0].id as string
  return { id, shift }
}

export const rider = (id: string): Principal => AAL2(id)

export const callJson = async (
  c: PoolClient,
  who: Principal,
  sql: string,
  params: unknown[] = [],
) => as(c, who, async () => (await c.query(sql, params)).rows[0].r)

export const callFails = (c: PoolClient, who: Principal, sql: string, params: unknown[] = []) =>
  as(c, who, () => failure(c, sql, params))

export const vendorAct = (
  c: PoolClient,
  who: Principal,
  order: string,
  action: string,
  reason: string | null = null,
) =>
  as(
    c,
    who,
    async () =>
      (await c.query(`select public.vendor_transition_order($1,$2,$3) r`, [order, action, reason]))
        .rows[0].r as string,
  )

/** A shop, a customer and a paid DELIVERY order; with `ready` it is taken to AWAITING_RIDER through the real path. */
export async function deliveryOrder(
  c: PoolClient,
  o: { ready?: boolean; shop?: Awaited<ReturnType<typeof mkShop>> } = {},
) {
  const shop = o.shop ?? (await mkShop(c))
  const cust = await createUser(c, 'cust')
  await addToCart(c, AAL2(cust), shop.product, 1)
  const order = await createOrderAs(c, AAL2(cust), 'delivery', shop.point)
  await payOrder(c, AAL2(cust), order)
  if (o.ready ?? true) {
    await vendorAct(c, AAL2(shop.owner), order, 'accept')
    await vendorAct(c, AAL2(shop.owner), order, 'start_preparing')
    await vendorAct(c, AAL2(shop.owner), order, 'mark_ready')
  }
  return { ...shop, cust, order }
}

export async function mkShop(c: PoolClient) {
  await fixPricing(c, { delivery: 50000, bps: 500 })
  const owner = await createUser(c, 'owner')
  const v = await mkVendor(c, { owner })
  const product = await mkProduct(c, v.id, { price: 150000, stock: 100 })
  const point = await mkDeliveryPoint(c, { lat: POINT.lat, lng: POINT.lng, radius: POINT.radius })
  return { owner, vendor: v.id, product, point }
}

export const accept = (c: PoolClient, rid: string, order: string) =>
  callJson(c, rider(rid), `select public.rider_accept_order($1) r`, [order]) as Promise<{
    assignment_id: string
    slot: number
    already_assigned: boolean
  }>

export const orderStatus = async (c: PoolClient, order: string) =>
  (await c.query(`select status from public.orders where id=$1`, [order])).rows[0].status as string

/**
 * Leftover rows from earlier browser runs would break tests that count rows globally. Inside the test's own
 * transaction (rolled back afterwards) clear rider-related data and park in-flight orders.
 */
export async function isolateRiderData(c: PoolClient) {
  await c.query(`set local session_replication_role = replica`)
  for (const t of [
    'assignment_tokens',
    'rider_issues',
    'rider_location_current',
    'rider_location_history',
    'delivery_assignments',
  ])
    await c.query(`delete from public.${t}`)
  await c.query(
    `update public.orders set status='CANCELLED' where status in ('AWAITING_RIDER','RIDER_ASSIGNED','PICKED_UP_BY_RIDER','EN_ROUTE','ARRIVAL_DETECTED')`,
  )
  await c.query(`set local session_replication_role = origin`)
}
export async function isoTx<T>(fn: (c: PoolClient) => Promise<T>) {
  const { withTx } = await import('./helpers')
  return withTx(async (c) => {
    await isolateRiderData(c)
    return fn(c)
  })
}
