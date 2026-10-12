import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { AAL2, addToCart, createOrderAs, createUser, pool, purge } from './helpers'
import { mkShop } from './rider-helpers'

/**
 * Expiry job under overlap: several runners started at the same moment must cancel every overdue order exactly once,
 * release its stock exactly once, and never fail. (The job is also safe to repeat: a second pass finds nothing.)
 */
afterAll(async () => {
  await pool.end()
})
const created = { users: [] as string[], vendors: [] as string[], points: [] as string[] }
afterEach(async () => {
  if (!created.users.length) return
  const c = await pool.connect()
  try {
    await purge(c, created)
  } finally {
    c.release()
  }
  created.users.length = created.vendors.length = created.points.length = 0
})

const runner = async () => {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role service_role')
    const n = Number((await c.query(`select public.expire_unpaid_orders() n`)).rows[0].n)
    await c.query('commit')
    return n
  } catch (e) {
    await c.query('rollback').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }
}

describe('order expiry job under overlapping runners', () => {
  it('6 overdue orders and 4 simultaneous runners: 6 cancellations in total, stock released once, a repeat finds nothing', async () => {
    const c = await pool.connect()
    let product = ''
    const orders: string[] = []
    try {
      await c.query('begin')
      const s = await mkShop(c)
      product = s.product
      const cust = await createUser(c, 'cust')
      created.users.push(s.owner, cust)
      created.vendors.push(s.vendor)
      created.points.push(s.point)
      for (let i = 0; i < 6; i++) {
        await addToCart(c, AAL2(cust), product, 2)
        orders.push(await createOrderAs(c, AAL2(cust), 'pickup', null))
      }
      await c.query(
        `update public.orders set expires_at = now() - interval '1 minute' where id = any($1::uuid[])`,
        [orders],
      )
      await c.query('commit')
    } finally {
      c.release()
    }
    const stock = async () =>
      Number(
        (await pool.query(`select stock_quantity s from public.products where id=$1`, [product]))
          .rows[0].s,
      )
    expect(await stock()).toBe(100 - 12)

    // other suites may have left overdue orders of their own; the runners must clear those too, each exactly once
    const overdue = Number(
      (
        await pool.query(
          `select count(*) n from public.orders where status='PENDING_PAYMENT' and expires_at <= now()`,
        )
      ).rows[0].n,
    )
    const results = await Promise.all([runner(), runner(), runner(), runner()])
    expect(results.reduce((a, b) => a + b, 0)).toBe(overdue)
    const rows = (
      await pool.query(`select status from public.orders where id = any($1::uuid[])`, [orders])
    ).rows
    expect(rows.map((r) => r.status)).toEqual(Array(6).fill('CANCELLED'))
    expect(await stock()).toBe(100) // released once per order, not 2x or 4x
    expect(await runner()).toBe(0)
    expect(await stock()).toBe(100)
    const hist = Number(
      (
        await pool.query(
          `select count(*) n from public.order_status_history where order_id = any($1::uuid[]) and to_status='CANCELLED'`,
          [orders],
        )
      ).rows[0].n,
    )
    expect(hist).toBe(6) // one cancellation record per order
  })
})
