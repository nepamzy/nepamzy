import type { PoolClient } from 'pg'
import { AAL2, addToCart, createOrderAs, createUser, payOrder, svc } from './helpers'
import { callJson, mkShop, vendorAct } from './rider-helpers'

export { callJson }

/** A shop, a customer and a PAID pickup order (status PAID, nothing else done yet). */
export async function paidPickup(c: PoolClient) {
  const shop = await mkShop(c)
  const cust = await createUser(c, 'cust')
  await addToCart(c, AAL2(cust), shop.product, 1)
  const order = await createOrderAs(c, AAL2(cust), 'pickup', null)
  await payOrder(c, AAL2(cust), order)
  return { ...shop, cust, order }
}

export const act = (c: PoolClient, owner: string, order: string, action: string) =>
  vendorAct(c, AAL2(owner), order, action)

export const notesOf = async (c: PoolClient, user: string) =>
  (
    await c.query(
      `select kind, title, body, link, event_key, read_at from public.notifications where user_id=$1 order by created_at, id`,
      [user],
    )
  ).rows as {
    kind: string
    title: string
    body: string
    link: string | null
    event_key: string
    read_at: string | null
  }[]

export const titlesOf = async (c: PoolClient, user: string) =>
  (await notesOf(c, user)).map((n) => n.title)

export const countRows = async (c: PoolClient, sql: string, params: unknown[] = []) =>
  Number((await c.query(sql, params)).rows[0].n)

/** Calls a service-role-only function the way the worker route does. */
export const asService = <T>(c: PoolClient, sql: string, params: unknown[] = []) =>
  svc(c, async () => (await c.query(sql, params)).rows[0].r as T)

/** Text that must never appear in a notification: money, codes, tokens, coordinates, signatures. */
export const FORBIDDEN_IN_NOTIFICATION =
  /₦|NGN|\bkobo\b|token|pickup code|signature|latitude|longitude|\blat\b|\blng\b|password|secret|\d{5,}/i
