import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  addToCart,
  applyEvent,
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
  pool,
  prepare,
  purge,
  svc,
  withTx,
} from './helpers'

afterAll(async () => {
  await pool.end()
})

async function unpaidOrder(c: PoolClient) {
  await fixPricing(c, { delivery: 50000, bps: 500 })
  const owner = await createUser(c, 'owner')
  const cust = await createUser(c, 'cust')
  const v = await mkVendor(c, { owner })
  const p = await mkProduct(c, v.id, { price: 250000, stock: 10 })
  await addToCart(c, AAL2(cust), p, 2)
  const order = await createOrderAs(c, AAL2(cust), 'pickup')
  return { owner, cust, v, p, order }
}
const status = async (c: PoolClient, o: string) =>
  (await c.query(`select status from public.orders where id=$1`, [o])).rows[0].status as string
const count = async (c: PoolClient, sql: string, args: unknown[] = []) =>
  Number((await c.query(sql, args)).rows[0].n)

describe('payment_prepare', () => {
  it('only the order owner at aal2 can prepare; the amount is the order total; repeat returns the same reference', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const stranger = await createUser(c, 'stranger')
      const a = await prepare(c, AAL2(cust), order)
      const total = (await c.query(`select total_kobo t from public.orders where id=$1`, [order]))
        .rows[0].t
      expect(Number(a.amount_kobo)).toBe(Number(total))
      expect(a.currency).toBe('NGN')
      expect((await prepare(c, AAL2(cust), order)).reference).toBe(a.reference)
      for (const who of [AAL2(stranger), AAL1(cust), null]) {
        const e = await as(c, who, () => failure(c, `select public.payment_prepare($1)`, [order]))
        expect(e.code).toBe(PRIV_DENIED)
      }
    })
  })

  it('refuses expired or already-paid orders', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      await c.query(
        `update public.orders set expires_at = now() - interval '1 minute' where id=$1`,
        [order],
      )
      const e = await as(c, AAL2(cust), () =>
        failure(c, `select public.payment_prepare($1)`, [order]),
      )
      expect(e.message).toMatch(/order_not_payable/)
    })
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      await payOrder(c, AAL2(cust), order)
      const e = await as(c, AAL2(cust), () =>
        failure(c, `select public.payment_prepare($1)`, [order]),
      )
      expect(e.message).toMatch(/order_not_payable/)
    })
  })
})

describe('payment_apply_event', () => {
  it('charge.success marks the order PAID once, writes the ledger and history; replays change nothing', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const t = await prepare(c, AAL2(cust), order)
      expect(await applyEvent(c, 'e1', 'charge.success', t.reference, t.amount_kobo)).toBe('paid')
      expect(await status(c, order)).toBe('PAID')
      expect(await applyEvent(c, 'e1', 'charge.success', t.reference, t.amount_kobo)).toBe(
        'duplicate_event',
      )
      expect(await applyEvent(c, 'e2', 'charge.success', t.reference, t.amount_kobo)).toBe(
        'already_succeeded',
      )
      expect(
        await count(c, `select count(*) n from public.ledger_entries where order_id=$1`, [order]),
      ).toBe(1)
      expect(
        await count(
          c,
          `select count(*) n from public.order_status_history where order_id=$1 and to_status='PAID'`,
          [order],
        ),
      ).toBe(1)
      expect(
        await count(c, `select count(*) n from public.payment_events where reference=$1`, [
          t.reference,
        ]),
      ).toBe(2)
    })
  })

  it('a wrong amount or currency never pays the order and raises a reconciliation flag', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const t = await prepare(c, AAL2(cust), order)
      expect(
        await applyEvent(c, 'm1', 'charge.success', t.reference, Number(t.amount_kobo) - 1),
      ).toBe('amount_mismatch')
      expect(await status(c, order)).toBe('PENDING_PAYMENT')
      expect(
        await count(c, `select count(*) n from public.ledger_entries where order_id=$1`, [order]),
      ).toBe(0)
      expect(
        await count(
          c,
          `select count(*) n from public.reconciliation_flags where order_id=$1 and reason='amount_mismatch'`,
          [order],
        ),
      ).toBe(1)
    })
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const t = await prepare(c, AAL2(cust), order)
      expect(await applyEvent(c, 'm2', 'charge.success', t.reference, t.amount_kobo, 'USD')).toBe(
        'amount_mismatch',
      )
      expect(await status(c, order)).toBe('PENDING_PAYMENT')
    })
  })

  it('unknown references are recorded and flagged, never applied', async () => {
    await withTx(async (c) => {
      expect(await applyEvent(c, 'u1', 'charge.success', 'AFM-NOPE-000000', 100)).toBe(
        'unknown_reference',
      )
      expect(
        await count(
          c,
          `select count(*) n from public.reconciliation_flags where reason='unknown_reference' and details->>'reference'='AFM-NOPE-000000'`,
        ),
      ).toBe(1)
    })
  })

  it('handles reordering: failure then success pays; success then failure is ignored', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const t = await prepare(c, AAL2(cust), order)
      expect(await applyEvent(c, 'f1', 'charge.failed', t.reference, t.amount_kobo)).toBe('failed')
      expect(await applyEvent(c, 's1', 'charge.success', t.reference, t.amount_kobo)).toBe('paid')
      expect(await applyEvent(c, 'f2', 'charge.failed', t.reference, t.amount_kobo)).toBe(
        'ignored_out_of_order',
      )
      expect(await status(c, order)).toBe('PAID')
    })
  })

  it('ignores event types it does not handle', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const t = await prepare(c, AAL2(cust), order)
      expect(await applyEvent(c, 'x1', 'transfer.success', t.reference, t.amount_kobo)).toBe(
        'ignored_event_type',
      )
      expect(await status(c, order)).toBe('PENDING_PAYMENT')
    })
  })

  it('a payment arriving after the order expired is recorded in the ledger, flagged, and does not resurrect the order', async () => {
    await withTx(async (c) => {
      const { cust, order, p } = await unpaidOrder(c)
      const t = await prepare(c, AAL2(cust), order)
      await c.query(
        `update public.orders set expires_at = now() - interval '1 minute' where id=$1`,
        [order],
      )
      await svc(c, () => c.query(`select public.expire_unpaid_orders()`))
      expect(await status(c, order)).toBe('CANCELLED')
      expect(await applyEvent(c, 'l1', 'charge.success', t.reference, t.amount_kobo)).toBe(
        'late_payment',
      )
      expect(await status(c, order)).toBe('CANCELLED')
      expect(
        await count(c, `select count(*) n from public.ledger_entries where order_id=$1`, [order]),
      ).toBe(1)
      expect(
        await count(
          c,
          `select count(*) n from public.reconciliation_flags where order_id=$1 and reason='late_payment'`,
          [order],
        ),
      ).toBe(1)
      expect(
        (await c.query(`select stock_quantity s from public.products where id=$1`, [p])).rows[0].s,
      ).toBe(10)
    })
  })

  it('a second successful payment for a paid order is flagged as a duplicate', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const t1 = await prepare(c, AAL2(cust), order)
      await applyEvent(c, 'd0', 'charge.failed', t1.reference, t1.amount_kobo)
      const t2 = await prepare(c, AAL2(cust), order)
      expect(t2.reference).not.toBe(t1.reference)
      expect(await applyEvent(c, 'd1', 'charge.success', t2.reference, t2.amount_kobo)).toBe('paid')
      expect(await applyEvent(c, 'd2', 'charge.success', t1.reference, t1.amount_kobo)).toBe(
        'duplicate_payment',
      )
      expect(
        await count(
          c,
          `select count(*) n from public.reconciliation_flags where order_id=$1 and reason='duplicate_payment'`,
          [order],
        ),
      ).toBe(1)
    })
  })

  it('is callable only by the service role', async () => {
    await withTx(async (c) => {
      const { cust } = await unpaidOrder(c)
      for (const who of [AAL2(cust), null]) {
        const e = await as(c, who, () =>
          failure(
            c,
            `select public.payment_apply_event('z','charge.success','r',1,'NGN','{}'::jsonb)`,
          ),
        )
        expect(e.code).toBe(PRIV_DENIED)
      }
      const e = await as(c, AAL2(cust), () =>
        failure(c, `select public.payment_set_access_code('r','x')`),
      )
      expect(e.code).toBe(PRIV_DENIED)
    })
  })
})

describe('payment data visibility and immutability', () => {
  it('customers see their own transactions only; events, ledger and flags are finance-only; history is immutable', async () => {
    await withTx(async (c) => {
      const a = await unpaidOrder(c)
      const b = await unpaidOrder(c)
      await payOrder(c, AAL2(a.cust), a.order)
      await prepare(c, AAL2(b.cust), b.order)
      const rows = (who: ReturnType<typeof AAL2>, t: string) =>
        as(c, who, async () => (await c.query(`select 1 from public.${t}`)).rowCount)
      expect(await rows(AAL2(a.cust), 'payment_transactions')).toBe(1)
      for (const t of ['payment_events', 'ledger_entries', 'reconciliation_flags']) {
        expect(await rows(AAL2(a.cust), t)).toBe(0)
      }
      const fin = await createUser(c, 'fin')
      await giveRole(c, fin, 'finance_admin')
      expect(await rows(AAL2(fin), 'ledger_entries')).toBeGreaterThan(0)
      expect(await rows(AAL1(fin), 'ledger_entries')).toBe(0)
      for (const sql of [
        `update public.ledger_entries set amount_kobo = 1`,
        `delete from public.payment_events`,
        `update public.payment_events set outcome='x'`,
      ]) {
        expect((await failure(c, sql)).message).toMatch(/append-only|immutable|not allowed|denied/i)
      }
      const w = await as(c, AAL2(a.cust), () =>
        failure(c, `update public.payment_transactions set status='succeeded'`),
      )
      expect(w.code).toBe(PRIV_DENIED)
    })
  })
})

describe('finance tools and refund primitives', () => {
  it('reconciliation and refunds need finance/admin at aal2; refunds cannot exceed what was received', async () => {
    await withTx(async (c) => {
      const { cust, order } = await unpaidOrder(c)
      const t = await payOrder(c, AAL2(cust), order)
      const fin = await createUser(c, 'fin')
      await giveRole(c, fin, 'finance_admin')
      for (const who of [AAL2(cust), AAL1(fin)]) {
        expect(
          (await as(c, who, () => failure(c, `select public.list_reconciliation_flags()`))).code,
        ).toBe(PRIV_DENIED)
        expect(
          (
            await as(c, who, () =>
              failure(c, `select public.refund_request($1, 100, 'reason')`, [order]),
            )
          ).code,
        ).toBe(PRIV_DENIED)
      }
      const total = Number(t.amount_kobo)
      await as(c, AAL2(fin), () =>
        c.query(`select public.refund_request($1, $2, 'partial goodwill')`, [order, 1000]),
      )
      const e = await as(c, AAL2(fin), () =>
        failure(c, `select public.refund_request($1, $2, 'too much')`, [order, total]),
      )
      expect(e.message).toMatch(/refund_exceeds_received/)
      await as(c, AAL2(fin), () =>
        c.query(`select public.refund_request($1, $2, 'the rest')`, [order, total - 1000]),
      )
      expect(
        await count(c, `select count(*) n from public.refunds where order_id=$1`, [order]),
      ).toBe(2)
    })
  })

  it('flags can be resolved once, with a note', async () => {
    await withTx(async (c) => {
      await applyEvent(c, 'r1', 'charge.success', 'AFM-NOPE-111111', 5)
      const fin = await createUser(c, 'fin')
      await giveRole(c, fin, 'platform_admin')
      const flags = await as(
        c,
        AAL2(fin),
        async () => (await c.query(`select public.list_reconciliation_flags() f`)).rows[0].f,
      )
      const id = flags.find((f: { reason: string }) => f.reason === 'unknown_reference').id
      expect(
        (
          await as(c, AAL2(fin), () =>
            failure(c, `select public.resolve_reconciliation_flag($1, '')`, [id]),
          )
        ).message,
      ).toMatch(/note_required/)
      await as(c, AAL2(fin), () =>
        c.query(`select public.resolve_reconciliation_flag($1, 'checked with provider')`, [id]),
      )
      expect(
        (
          await as(c, AAL2(fin), () =>
            failure(c, `select public.resolve_reconciliation_flag($1, 'again')`, [id]),
          )
        ).message,
      ).toMatch(/flag_not_open/)
    })
  })
})

const PAR_SAME = `par-same-${randomUUID()}`
describe('concurrency', () => {
  it('the same event delivered in parallel pays once; different events for one reference pay once', async () => {
    const setup = await pool.connect()
    let users: string[] = []
    let vendors: string[] = []
    let points: string[] = []
    try {
      await setup.query('begin')
      await fixPricing(setup, { delivery: 50000, bps: 500 })
      const owner = await createUser(setup, 'owner')
      const cust = await createUser(setup, 'cust')
      const v = await mkVendor(setup, { owner })
      const p = await mkProduct(setup, v.id, { price: 250000, stock: 10 })
      const point = await mkDeliveryPoint(setup)
      await addToCart(setup, AAL2(cust), p, 1)
      const o1 = await createOrderAs(setup, AAL2(cust), 'pickup')
      const t1 = await prepare(setup, AAL2(cust), o1)
      await addToCart(setup, AAL2(cust), p, 1)
      const o2 = await createOrderAs(setup, AAL2(cust), 'pickup')
      const t2 = await prepare(setup, AAL2(cust), o2)
      await setup.query('commit')
      users = [owner, cust]
      vendors = [v.id]
      points = [point]

      const fire = async (id: string, ref: string, amt: number) => {
        const c = await pool.connect()
        try {
          await c.query('begin')
          const r = await applyEvent(c, id, 'charge.success', ref, amt)
          await c.query('commit')
          return r
        } finally {
          c.release()
        }
      }
      const same = await Promise.all(
        Array.from({ length: 6 }, () => fire(PAR_SAME, t1.reference, Number(t1.amount_kobo))),
      )
      expect(same.filter((r) => r === 'paid')).toHaveLength(1)
      expect(same.filter((r) => r === 'duplicate_event')).toHaveLength(5)
      const diff = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          fire(`par-diff-${i}-${randomUUID()}`, t2.reference, Number(t2.amount_kobo)),
        ),
      )
      expect(diff.filter((r) => r === 'paid')).toHaveLength(1)
      expect(diff.filter((r) => r === 'already_succeeded')).toHaveLength(5)
      const n = await pool.query(
        `select count(*)::int n from public.ledger_entries where order_id = any($1::uuid[])`,
        [[o1, o2]],
      )
      expect(n.rows[0].n).toBe(2)
    } finally {
      setup.release()
      const c = await pool.connect()
      try {
        await c
          .query(`delete from public.payment_events where provider_event_id like 'par-%'`)
          .catch(() => undefined)
        await purge(c, { users, vendors, points })
      } finally {
        c.release()
      }
    }
  })
})
