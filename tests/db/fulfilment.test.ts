import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PNG,
  PRIV_DENIED,
  addToCart,
  as,
  createOrderAs,
  createUser,
  failure,
  fixPricing,
  mkDeliveryPoint,
  mkProduct,
  mkVendor,
  payOrder,
  pool,
  purge,
  withTx,
} from './helpers'

afterAll(async () => {
  await pool.end()
})

type Fulfilment = 'pickup' | 'delivery'
async function paidOrder(c: PoolClient, fulfilment: Fulfilment = 'pickup') {
  await fixPricing(c, { delivery: 50000, bps: 500 })
  const owner = await createUser(c, 'owner')
  const cust = await createUser(c, 'cust')
  const v = await mkVendor(c, { owner })
  const p = await mkProduct(c, v.id, { price: 250000, stock: 10 })
  const point = await mkDeliveryPoint(c)
  await addToCart(c, AAL2(cust), p, 2)
  const order = await createOrderAs(
    c,
    AAL2(cust),
    fulfilment,
    fulfilment === 'delivery' ? point : null,
  )
  await payOrder(c, AAL2(cust), order)
  return { owner, cust, v, p, order, point }
}
const act = (
  c: PoolClient,
  who: ReturnType<typeof AAL2> | null,
  order: string,
  action: string,
  reason: string | null = null,
) =>
  as(
    c,
    who,
    async () =>
      (await c.query(`select public.vendor_transition_order($1,$2,$3) s`, [order, action, reason]))
        .rows[0].s as string,
  )
const actFails = (
  c: PoolClient,
  who: ReturnType<typeof AAL2> | null,
  order: string,
  action: string,
  reason: string | null = null,
) =>
  as(c, who, () =>
    failure(c, `select public.vendor_transition_order($1,$2,$3)`, [order, action, reason]),
  )
const status = async (c: PoolClient, o: string) =>
  (await c.query(`select status from public.orders where id=$1`, [o])).rows[0].status as string
const getCode = (c: PoolClient, who: ReturnType<typeof AAL2>, order: string) =>
  as(
    c,
    who,
    async () =>
      (await c.query(`select public.get_pickup_code($1) r`, [order])).rows[0].r as {
        available: boolean
        code?: string
      },
  )
const complete = (
  c: PoolClient,
  who: ReturnType<typeof AAL2>,
  order: string,
  code: string,
  name = 'Ada Student',
  sig: Buffer = PNG(),
) =>
  as(
    c,
    who,
    async () =>
      (await c.query(`select public.complete_pickup($1,$2,$3,$4) r`, [order, code, name, sig]))
        .rows[0].r as { ok: boolean; reason?: string },
  )

async function toHandover(c: PoolClient, o: Awaited<ReturnType<typeof paidOrder>>) {
  await act(c, AAL2(o.owner), o.order, 'accept')
  await act(c, AAL2(o.owner), o.order, 'start_preparing')
  return act(c, AAL2(o.owner), o.order, 'mark_ready')
}

describe('vendor order state machine', () => {
  it('walks PAID -> ACCEPTED -> PREPARING -> PICKUP_AWAITING_HANDOVER with history for every step', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      expect(await act(c, AAL2(o.owner), o.order, 'accept')).toBe('ACCEPTED')
      expect(await act(c, AAL2(o.owner), o.order, 'start_preparing')).toBe('PREPARING')
      expect(await act(c, AAL2(o.owner), o.order, 'mark_ready')).toBe('PICKUP_AWAITING_HANDOVER')
      const h = await c.query(
        `select to_status from public.order_status_history where order_id=$1 order by id`,
        [o.order],
      )
      expect(h.rows.map((r) => r.to_status)).toEqual([
        'PENDING_PAYMENT',
        'PAID',
        'ACCEPTED',
        'PREPARING',
        'READY',
        'PICKUP_AWAITING_HANDOVER',
      ])
    })
  })

  it('delivery orders go to AWAITING_RIDER and get no pickup code', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, 'delivery')
      expect(await toHandover(c, o)).toBe('AWAITING_RIDER')
      expect(
        (await c.query(`select 1 from public.pickup_codes where order_id=$1`, [o.order])).rowCount,
      ).toBe(0)
    })
  })

  it('rejects illegal or repeated transitions and unknown actions', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      for (const a of ['start_preparing', 'mark_ready'])
        expect((await actFails(c, AAL2(o.owner), o.order, a)).message).toMatch(/invalid_transition/)
      await act(c, AAL2(o.owner), o.order, 'accept')
      expect((await actFails(c, AAL2(o.owner), o.order, 'accept')).message).toMatch(
        /invalid_transition/,
      )
      expect((await actFails(c, AAL2(o.owner), o.order, 'reject', 'too late')).message).toMatch(
        /invalid_transition/,
      )
      expect((await actFails(c, AAL2(o.owner), o.order, 'teleport')).message).toMatch(
        /invalid_action/,
      )
    })
  })

  it('an unpaid order cannot be accepted', async () => {
    await withTx(async (c) => {
      await fixPricing(c)
      const owner = await createUser(c, 'owner')
      const cust = await createUser(c, 'cust')
      const v = await mkVendor(c, { owner })
      const p = await mkProduct(c, v.id, { price: 100000, stock: 5 })
      await addToCart(c, AAL2(cust), p, 1)
      const order = await createOrderAs(c, AAL2(cust), 'pickup')
      expect((await actFails(c, AAL2(owner), order, 'accept')).message).toMatch(
        /invalid_transition/,
      )
    })
  })

  it('only staff of the ordering shop, at aal2, with an active shop, may act', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const other = await createUser(c, 'otherowner')
      await mkVendor(c, { owner: other })
      for (const who of [AAL2(other), AAL2(o.cust), AAL1(o.owner), null]) {
        const e = await actFails(c, who, o.order, 'accept')
        expect(e.code).toBe(PRIV_DENIED)
      }
      await c.query(`update public.vendors set status='suspended' where id=$1`, [o.v.id])
      expect((await actFails(c, AAL2(o.owner), o.order, 'accept')).code).toBe(PRIV_DENIED)
      expect(await status(c, o.order)).toBe('PAID')
    })
  })

  it('rejecting a paid order needs a reason, releases stock and raises a refund flag', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      expect((await actFails(c, AAL2(o.owner), o.order, 'reject', '')).message).toMatch(
        /reason_required/,
      )
      expect(await act(c, AAL2(o.owner), o.order, 'reject', 'Out of ingredients')).toBe('CANCELLED')
      expect(
        (await c.query(`select stock_quantity s from public.products where id=$1`, [o.p])).rows[0]
          .s,
      ).toBe(10)
      expect(
        (
          await c.query(
            `select 1 from public.reconciliation_flags where order_id=$1 and reason='vendor_rejected_paid_order'`,
            [o.order],
          )
        ).rowCount,
      ).toBe(1)
    })
  })
})

describe('pickup code and handover', () => {
  it('the code is shown only to the ordering customer, only while awaiting handover; the DB stores a hash only', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      expect((await getCode(c, AAL2(o.cust), o.order)).available).toBe(false)
      await toHandover(c, o)
      const r = await getCode(c, AAL2(o.cust), o.order)
      expect(r.available).toBe(true)
      expect(r.code).toMatch(/^[0-9A-F]{8}$/)
      expect((await getCode(c, AAL2(o.cust), o.order)).code).toBe(r.code) // stable
      const stranger = await createUser(c, 'stranger')
      for (const who of [AAL2(stranger), AAL2(o.owner), AAL1(o.cust)]) {
        const e = await as(c, who, () => failure(c, `select public.get_pickup_code($1)`, [o.order]))
        expect(e.code).toBe(PRIV_DENIED)
      }
      const row = (
        await c.query(`select code_hash from public.pickup_codes where order_id=$1`, [o.order])
      ).rows[0]
      expect(row.code_hash).not.toContain(r.code!)
      // nobody can read the table directly
      for (const who of [AAL2(o.cust), AAL2(o.owner)]) {
        const e = await as(c, who, () => failure(c, `select * from public.pickup_codes`))
        expect(e.code).toBe(PRIV_DENIED)
      }
    })
  })

  it('completes with the right code, a name and a signature; evidence stored; cannot be replayed', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      expect(await complete(c, AAL2(o.owner), o.order, code!.toLowerCase() + ' ')).toEqual({
        ok: true,
      })
      expect(await status(c, o.order)).toBe('COMPLETED')
      const ev = (
        await c.query(
          `select recipient_name, signature_sha256, octet_length(signature_png) n from public.handover_evidence where order_id=$1`,
          [o.order],
        )
      ).rows[0]
      expect(ev.recipient_name).toBe('Ada Student')
      expect(ev.n).toBeGreaterThan(300)
      const again = await as(c, AAL2(o.owner), () =>
        failure(c, `select public.complete_pickup($1,$2,'Ada Student',$3)`, [o.order, code, PNG()]),
      )
      expect(again.message).toMatch(/invalid_transition/)
      expect((await getCode(c, AAL2(o.cust), o.order)).available).toBe(false)
    })
  })

  it('refuses without a valid signature or recipient, and wrong codes are counted and lock after five', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      const bad = (sig: Buffer | null, name = 'Ada Student') =>
        as(c, AAL2(o.owner), () =>
          failure(c, `select public.complete_pickup($1,$2,$3,$4)`, [o.order, code, name, sig]),
        )
      expect((await bad(null)).message).toMatch(/signature_required/)
      expect((await bad(Buffer.alloc(600, 1))).message).toMatch(/signature_required/) // not a PNG
      expect((await bad(PNG(50))).message).toMatch(/signature_required/) // blank / too small
      expect((await bad(PNG(), ' ')).message).toMatch(/recipient_required/)
      expect(await status(c, o.order)).toBe('PICKUP_AWAITING_HANDOVER')
      for (let i = 0; i < 5; i++)
        expect((await complete(c, AAL2(o.owner), o.order, 'WRONG123')).reason).toBe('wrong_code')
      expect((await complete(c, AAL2(o.owner), o.order, code!)).reason).toBe('code_locked')
      expect(await status(c, o.order)).toBe('PICKUP_AWAITING_HANDOVER')
    })
  })

  it('a code from another order never works; strangers and customers cannot complete a pickup', async () => {
    await withTx(async (c) => {
      const a = await paidOrder(c)
      const b = await paidOrder(c)
      await toHandover(c, a)
      await toHandover(c, b)
      const codeA = (await getCode(c, AAL2(a.cust), a.order)).code!
      expect((await complete(c, AAL2(b.owner), b.order, codeA)).reason).toBe('wrong_code')
      expect(await status(c, b.order)).toBe('PICKUP_AWAITING_HANDOVER')
      for (const who of [AAL2(b.owner), AAL2(a.cust), AAL1(a.owner)]) {
        const e = await as(c, who, () =>
          failure(c, `select public.complete_pickup($1,$2,'Ada Student',$3)`, [
            a.order,
            codeA,
            PNG(),
          ]),
        )
        expect(e.code).toBe(PRIV_DENIED)
      }
    })
  })

  it('handover evidence is visible to the customer and shop, not to strangers, and cannot change', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      await complete(c, AAL2(o.owner), o.order, code!)
      const seen = (who: ReturnType<typeof AAL2>) =>
        as(c, who, async () => (await c.query(`select 1 from public.handover_evidence`)).rowCount)
      expect(await seen(AAL2(o.cust))).toBe(1)
      expect(await seen(AAL2(o.owner))).toBe(1)
      expect(await seen(AAL2(await createUser(c, 'stranger')))).toBe(0)
      expect(
        (await failure(c, `update public.handover_evidence set recipient_name='x'`)).message,
      ).toMatch(/append-only|immutable|not allowed|denied/i)
    })
  })
})

describe('concurrency', () => {
  it('two simultaneous correct completions: exactly one succeeds; two simultaneous accepts: exactly one', async () => {
    const setup = await pool.connect()
    let ids: { users: string[]; vendors: string[]; points: string[] } = {
      users: [],
      vendors: [],
      points: [],
    }
    try {
      await setup.query('begin')
      const o = await paidOrder(setup)
      await setup.query('commit')
      ids = { users: [o.owner, o.cust], vendors: [o.v.id], points: [o.point] }
      const run = async (fn: (c: PoolClient) => Promise<unknown>) => {
        const c = await pool.connect()
        try {
          await c.query('begin')
          const r = await fn(c)
          await c.query('commit')
          return r
        } catch (e) {
          await c.query('rollback').catch(() => undefined)
          return e instanceof Error ? e.message : 'error'
        } finally {
          c.release()
        }
      }
      const accepts = await Promise.all(
        [1, 2, 3].map(() => run((c) => act(c, AAL2(o.owner), o.order, 'accept'))),
      )
      expect(accepts.filter((r) => r === 'ACCEPTED')).toHaveLength(1)
      await run((c) => act(c, AAL2(o.owner), o.order, 'start_preparing'))
      await run((c) => act(c, AAL2(o.owner), o.order, 'mark_ready'))
      const code = (await run((c) => getCode(c, AAL2(o.cust), o.order))) as { code: string }
      const done = (await Promise.all(
        [1, 2, 3].map(() => run((c) => complete(c, AAL2(o.owner), o.order, code.code))),
      )) as Array<{ ok?: boolean } | string>
      expect(done.filter((r) => typeof r === 'object' && r.ok)).toHaveLength(1)
      const n = await pool.query(
        `select count(*)::int n from public.handover_evidence where order_id=$1`,
        [o.order],
      )
      expect(n.rows[0].n).toBe(1)
    } finally {
      setup.release()
      const c = await pool.connect()
      try {
        await purge(c, ids)
      } finally {
        c.release()
      }
    }
  })
})
