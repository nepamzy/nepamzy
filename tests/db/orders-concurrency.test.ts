import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  AAL2,
  addToCart,
  createUser,
  fixPricing,
  mkDeliveryPoint,
  mkProduct,
  mkVendor,
  pool,
  purge,
  setSetting,
} from './helpers'

// Real parallel connections, committed data (cleaned up afterwards). These prove the atomicity of
// stock, idempotency, cancellation and payment under contention - the properties a single-connection
// test cannot show.
afterAll(async () => {
  await pool.end()
})

type Fx = { users: string[]; vendor: string; product: string; owner: string; point: string }

async function setup(buyers: number, stock: number, qty = 1): Promise<Fx> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await fixPricing(c)
    const owner = await createUser(c, 'cowner')
    const v = await mkVendor(c, { owner })
    const product = await mkProduct(c, v.id, { price: 100000, stock })
    const point = await mkDeliveryPoint(c)
    const users: string[] = []
    for (let i = 0; i < buyers; i++) {
      const u = await createUser(c, 'cbuyer')
      users.push(u)
      await addToCart(c, AAL2(u), product, qty)
    }
    await c.query('commit')
    return { users, vendor: v.id, product, owner, point }
  } finally {
    c.release()
  }
}

async function teardown(fx: Fx) {
  const c = await pool.connect()
  try {
    await purge(c, { users: [...fx.users, fx.owner], vendors: [fx.vendor], points: [fx.point] })
  } finally {
    c.release()
  }
}

/** Run one statement as an aal2 user in its own transaction on its own connection. */
async function runAs<T>(userId: string, sql: string, params: unknown[]): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal2' }), userId],
    )
    await c.query('set local role authenticated')
    const r = await c.query(sql, params)
    await c.query('commit')
    return r.rows[0].r as T
  } catch (e) {
    await c.query('rollback').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }
}
const stockOf = async (p: string) =>
  (await pool.query(`select stock_quantity s from public.products where id=$1`, [p])).rows[0]
    .s as number
const ordersOf = async (users: string[]) =>
  (
    await pool.query(
      `select count(*)::int n from public.orders where customer_id = any($1::uuid[])`,
      [users],
    )
  ).rows[0].n as number

describe('stock under contention', () => {
  it('two customers racing for the last unit: exactly one order, the other is told it is out of stock', async () => {
    const fx = await setup(2, 1)
    try {
      const results = await Promise.allSettled(
        fx.users.map((u) =>
          runAs<string>(u, `select public.create_order('pickup', null, $1) as r`, [
            `race-${randomUUID()}`,
          ]),
        ),
      )
      const ok = results.filter((r) => r.status === 'fulfilled')
      const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(ok).toHaveLength(1)
      expect(bad).toHaveLength(1)
      expect((bad[0]!.reason as Error).message).toBe('checkout_blocked')
      expect((bad[0]!.reason as { detail: string }).detail).toContain('out_of_stock')
      expect(await stockOf(fx.product)).toBe(0)
      expect(await ordersOf(fx.users)).toBe(1)
    } finally {
      await teardown(fx)
    }
  })

  it('10 customers, 3 units: exactly 3 orders succeed, stock never goes negative', async () => {
    const fx = await setup(10, 3)
    try {
      const results = await Promise.allSettled(
        fx.users.map((u) =>
          runAs<string>(u, `select public.create_order('pickup', null, $1) as r`, [
            `race-${randomUUID()}`,
          ]),
        ),
      )
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
      for (const r of results)
        if (r.status === 'rejected') expect((r.reason as Error).message).toBe('checkout_blocked')
      expect(await stockOf(fx.product)).toBe(0)
      expect(await ordersOf(fx.users)).toBe(3)
    } finally {
      await teardown(fx)
    }
  })

  it('one customer buying 2 of the 3 remaining units while others race: totals stay consistent', async () => {
    const fx = await setup(3, 3, 2) // each wants 2, only 3 exist => one order succeeds (2), the rest are blocked
    try {
      const results = await Promise.allSettled(
        fx.users.map((u) =>
          runAs<string>(u, `select public.create_order('pickup', null, $1) as r`, [
            `race-${randomUUID()}`,
          ]),
        ),
      )
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await stockOf(fx.product)).toBe(1)
    } finally {
      await teardown(fx)
    }
  })
})

describe('idempotency under contention', () => {
  it('6 simultaneous submissions with the same key create one order and take stock once', async () => {
    const fx = await setup(1, 5, 2)
    const key = `idem-${randomUUID()}`
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          runAs<string>(fx.users[0]!, `select public.create_order('pickup', null, $1) as r`, [key]),
        ),
      )
      const ids = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value)
      expect(ids.length).toBeGreaterThanOrEqual(1)
      expect(new Set(ids).size).toBe(1)
      for (const r of results)
        if (r.status === 'rejected')
          expect(
            (r.reason as Error).message,
            'only a benign duplicate/empty-cart condition is acceptable',
          ).toMatch(/cart_empty|duplicate/)
      expect(await ordersOf(fx.users)).toBe(1)
      expect(await stockOf(fx.product)).toBe(3)
    } finally {
      await teardown(fx)
    }
  })
})

describe('cancellation and payment under contention', () => {
  let prevMock: unknown = false
  it('two simultaneous cancels release stock once', async () => {
    const fx = await setup(1, 5, 2)
    try {
      const id = await runAs<string>(
        fx.users[0]!,
        `select public.create_order('pickup', null, $1) as r`,
        [`k-${randomUUID()}`],
      )
      expect(await stockOf(fx.product)).toBe(3)
      const res = await Promise.allSettled(
        [1, 2].map(() =>
          runAs(fx.users[0]!, `select public.cancel_unpaid_order($1)::text as r`, [id]),
        ),
      )
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await stockOf(fx.product)).toBe(5)
    } finally {
      await teardown(fx)
    }
  })

  it('two simultaneous payments record one payment; pay racing cancel leaves one consistent outcome', async () => {
    const fx = await setup(2, 5)
    const c = await pool.connect()
    try {
      prevMock = (
        await c.query(
          `select value from public.platform_settings where key='mock_payments_enabled'`,
        )
      ).rows[0].value
      await setSetting(c, 'mock_payments_enabled', true)
      const [a, b] = fx.users as [string, string]
      const o1 = await runAs<string>(a, `select public.create_order('pickup', null, $1) as r`, [
        `k-${randomUUID()}`,
      ])
      await Promise.allSettled(
        [1, 2, 3].map(() => runAs(a, `select public.mock_pay_order($1)::text as r`, [o1])),
      )
      expect(
        (
          await pool.query(
            `select count(*)::int n from public.payment_attempts where order_id=$1`,
            [o1],
          )
        ).rows[0].n,
      ).toBe(1)
      expect(
        (await pool.query(`select status from public.orders where id=$1`, [o1])).rows[0].status,
      ).toBe('PAID')

      const o2 = await runAs<string>(b, `select public.create_order('pickup', null, $1) as r`, [
        `k-${randomUUID()}`,
      ])
      const before = await stockOf(fx.product)
      await Promise.allSettled([
        runAs(b, `select public.mock_pay_order($1)::text as r`, [o2]),
        runAs(b, `select public.cancel_unpaid_order($1)::text as r`, [o2]),
      ])
      const st = (await pool.query(`select status from public.orders where id=$1`, [o2])).rows[0]
        .status as string
      const pays = (
        await pool.query(`select count(*)::int n from public.payment_attempts where order_id=$1`, [
          o2,
        ])
      ).rows[0].n as number
      expect(['PAID', 'CANCELLED']).toContain(st)
      expect(pays).toBe(st === 'PAID' ? 1 : 0) // never both a payment and a cancellation
      expect(await stockOf(fx.product)).toBe(st === 'CANCELLED' ? before + 1 : before) // stock released only if cancelled
    } finally {
      await setSetting(c, 'mock_payments_enabled', prevMock) // restore, never assume
      c.release()
      await teardown(fx)
    }
  })
})
