import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  pool,
  setSetting,
  svc,
  withTx,
} from './helpers'
import {
  approve,
  callFails,
  callJson,
  outcome,
  paidOrder,
  requestRefund,
  staff,
  startFake,
} from './refund-helpers'

afterAll(async () => {
  await pool.end()
})

/**
 * Money model under test (owner-approved 2026-10-15): the customer pays no platform fee; the vendor commission is 4.5% of the
 * eligible product subtotal (delivery excluded) = 3.0% AFIT Market allocation + 1.5% Paystack-cost BUDGET; integer kobo, half up.
 * paidOrder() has three lines: 100000 + 150000 + 50000 = 300000 kobo.
 */
const complete = async (c: PoolClient, order: string) => {
  await c.query(
    `select app_private.step_order($1, 'PICKUP_AWAITING_HANDOVER', 'COMPLETED', null, 'test_completed')`,
    [order],
  )
}
/** A paid order that has NOT completed yet (so no settlement line exists). */
const openOrder = (c: PoolClient) => paidOrder(c, { status: 'PICKUP_AWAITING_HANDOVER' })
const line = async (c: PoolClient, order: string) =>
  (await c.query(`select * from public.order_settlement_lines where order_id=$1`, [order])).rows[0]
const adjustments = async (c: PoolClient, order: string) =>
  (
    await c.query(
      `select * from public.order_settlement_adjustments where order_id=$1 order by id`,
      [order],
    )
  ).rows
async function refundSucceeded(
  c: PoolClient,
  o: { cust: string; order: string },
  items: { order_item_id: string; quantity: number }[] | null,
) {
  const fin = await staff(c, 'finance_admin')
  const fin2 = await staff(c, 'finance_admin')
  const r = await requestRefund(c, o.cust, o.order, items)
  await approve(c, fin, r.id)
  await startFake(c, fin2, r.id)
  await outcome(c, fin2, r.id, 'succeeded', `fake_re_${r.id.slice(0, 8)}`)
  return r.id
}

describe('the customer pays no platform fee', () => {
  it('a new order has platform_fee_kobo 0 and total = items + delivery - discount', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      const row = (
        await c.query(
          `select items_total_kobo, delivery_fee_kobo, platform_fee_kobo, discount_kobo, total_kobo from public.orders where id=$1`,
          [o.order],
        )
      ).rows[0]
      expect(row).toEqual({
        items_total_kobo: '300000',
        delivery_fee_kobo: '0',
        platform_fee_kobo: '0',
        discount_kobo: '0',
        total_kobo: '300000',
      })
    })
  })
})

describe('settlement line: created once, when the order completes', () => {
  it('records base, rates, commission, AFIT allocation, Paystack-cost budget and payable; delivery is excluded', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      expect(await line(c, o.order)).toBeUndefined() // paid is not completed
      await complete(c, o.order)
      const l = await line(c, o.order)
      expect(l).toMatchObject({
        vendor_id: o.vendor,
        base_kobo: '300000',
        commission_bps: 450,
        afit_bps: 300,
        paystack_budget_bps: 150,
        commission_kobo: '13500',
        afit_allocation_kobo: '9000',
        paystack_allowance_kobo: '4500',
        delivery_fee_kobo: '0',
      })
      expect(BigInt(l.commission_kobo)).toBe(
        BigInt(l.afit_allocation_kobo) + BigInt(l.paystack_allowance_kobo),
      )
    })
  })

  it('a second completion record never creates a second line', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      await complete(c, o.order)
      await c.query(
        `insert into public.order_status_history (order_id, from_status, to_status, reason) values ($1,'COMPLETED','COMPLETED','replay')`,
        [o.order],
      )
      expect(
        Number(
          (
            await c.query(
              `select count(*) n from public.order_settlement_lines where order_id=$1`,
              [o.order],
            )
          ).rows[0].n,
        ),
      ).toBe(1)
    })
  })

  it('the rate used is stored with the line; a later rate change never recalculates it', async () => {
    await withTx(async (c) => {
      const a = await openOrder(c)
      await complete(c, a.order)
      const b = await openOrder(c) // creating an order resets the fixture rates, so change them afterwards
      await setSetting(c, 'vendor_commission_bps', 600)
      await setSetting(c, 'commission_afit_bps', 400)
      await complete(c, b.order)
      expect(await line(c, a.order)).toMatchObject({
        commission_bps: 450,
        commission_kobo: '13500',
      })
      expect(await line(c, b.order)).toMatchObject({
        commission_bps: 600,
        afit_bps: 400,
        paystack_budget_bps: 200,
        commission_kobo: '18000',
        afit_allocation_kobo: '12000',
        paystack_allowance_kobo: '6000',
      })
    })
  })

  it('rounds half up in whole kobo and keeps afit + paystack = commission', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      await c
        .query(`update public.orders set items_total_kobo = 333, total_kobo = 333 where id=$1`, [
          o.order,
        ])
        .catch(() => undefined)
      const r = (
        await c.query(`select app_private.round_bps(333,450) c, app_private.round_bps(333,300) a`)
      ).rows[0]
      expect([r.c, r.a]).toEqual(['15', '10']) // 14.985 -> 15 ; 9.99 -> 10
      expect(Number(r.c) - Number(r.a)).toBe(5)
    })
  })

  it('lines and adjustments are immutable and unreachable to ordinary roles', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      await complete(c, o.order)
      for (const sql of [
        `update public.order_settlement_lines set base_kobo = 1`,
        `delete from public.order_settlement_lines`,
      ]) {
        const e = await svc(c, () => failure(c, sql))
        expect(e.message, sql).toMatch(/append-only|not allowed|denied/i)
      }
      const e = await as(c, AAL2(o.owner), () =>
        failure(c, `select * from public.order_settlement_lines`),
      )
      expect(e.code).toBe(PRIV_DENIED)
    })
  })
})

describe('refunds reverse commission proportionally and exactly once', () => {
  it('a partial refund reverses the commission on the refunded product value only', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      await complete(c, o.order)
      const mid = o.items.find((i) => i.unit_price_kobo === 150000)!
      await refundSucceeded(c, o, [{ order_item_id: mid.id, quantity: 1 }])
      const adj = await adjustments(c, o.order)
      expect(adj).toHaveLength(1)
      expect(adj[0]).toMatchObject({
        base_reversed_kobo: '150000',
        commission_reversed_kobo: '6750',
        afit_reversed_kobo: '4500',
        paystack_reversed_kobo: '2250',
        reason: 'refund_succeeded',
      })
    })
  })

  it('refunding everything in two steps reverses exactly the whole commission (no rounding drift)', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      await complete(c, o.order)
      const [a, b, d] = o.items
      await refundSucceeded(c, o, [{ order_item_id: a!.id, quantity: 1 }]) // 50000
      await refundSucceeded(c, o, [
        { order_item_id: b!.id, quantity: 1 },
        { order_item_id: d!.id, quantity: 1 },
      ])
      const adj = await adjustments(c, o.order)
      const sum = (k: string) => adj.reduce((s, r) => s + BigInt(r[k]), 0n)
      expect(sum('base_reversed_kobo')).toBe(300000n)
      expect(sum('commission_reversed_kobo')).toBe(13500n)
      expect(sum('afit_reversed_kobo')).toBe(9000n)
      expect(sum('paystack_reversed_kobo')).toBe(4500n)
    })
  })

  it('re-running the settlement for the same refund (a retry) adds nothing', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      await complete(c, o.order)
      const id = await refundSucceeded(c, o, null)
      await c.query(`select app_private.settle_refund($1)`, [id])
      await c.query(`select app_private.settle_refund($1)`, [id])
      expect(await adjustments(c, o.order)).toHaveLength(1)
    })
  })

  it('a refund that succeeded before the line existed is applied when the line is created (defensive path)', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, { status: 'DELIVERED' }) // refundable, but no completion record yet, so no line
      const last = o.items.find((i) => i.unit_price_kobo === 50000)!
      await refundSucceeded(c, o, [{ order_item_id: last.id, quantity: 1 }])
      expect(await line(c, o.order)).toBeUndefined()
      await c.query(
        `insert into public.order_status_history (order_id, from_status, to_status, reason) values ($1, 'DELIVERED', 'COMPLETED', 'test')`,
        [o.order],
      )
      expect((await line(c, o.order)).base_kobo).toBe('300000')
      const adj = await adjustments(c, o.order)
      expect(adj).toHaveLength(1)
      expect(adj[0]).toMatchObject({
        base_reversed_kobo: '50000',
        commission_reversed_kobo: '2250',
      })
    })
  })
})

describe('who can read settlement data, and what they see', () => {
  it('a vendor sees only its own shop: finalised, pending estimate, refunds, payable; payouts are reported as not enabled', async () => {
    await withTx(async (c) => {
      const done = await openOrder(c)
      await complete(c, done.order)
      const mid = done.items.find((i) => i.unit_price_kobo === 150000)!
      await refundSucceeded(c, done, [{ order_item_id: mid.id, quantity: 1 }])
      const s = (await callJson(
        c,
        AAL2(done.owner),
        `select public.vendor_settlement_summary($1) r`,
        [done.vendor],
      )) as {
        finalised: Record<string, number>
        pending: Record<string, number>
        payout: { status: string }
        recent: { payable_kobo: number }[]
      }
      expect(s.finalised).toMatchObject({
        orders: 1,
        gross_sales_kobo: 300000,
        commission_kobo: 13500,
        refunded_sales_kobo: 150000,
        commission_reversed_kobo: 6750,
        payable_kobo: 143250,
      })
      expect(s.pending).toMatchObject({ orders: 0, gross_sales_kobo: 0 })
      expect(s.payout.status).toBe('not_enabled')
      expect(s.recent[0]!.payable_kobo).toBe(143250)
    })
  })

  it('another vendor, a customer, staff without the vendor, aal1 and anonymous are refused', async () => {
    await withTx(async (c) => {
      const a = await openOrder(c)
      const b = await openOrder(c)
      for (const who of [AAL2(b.owner), AAL2(a.cust), AAL1(a.owner), null]) {
        expect(
          (await callFails(c, who, `select public.vendor_settlement_summary($1) r`, [a.vendor]))
            .code,
        ).toBe(PRIV_DENIED)
      }
      const support = await staff(c, 'support_agent')
      expect(
        (
          await callFails(c, AAL2(support), `select public.vendor_settlement_summary($1) r`, [
            a.vendor,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
    })
  })

  it('finance and platform admins see totals; support, vendors and customers do not', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      await complete(c, o.order)
      const fin = await staff(c, 'finance_admin')
      const adm = await staff(c, 'platform_admin')
      const support = await staff(c, 'support_agent')
      for (const who of [fin, adm]) {
        const r = (await callJson(c, AAL2(who), `select public.admin_settlement_overview() r`)) as {
          totals: { commission_kobo: number }
          note: string
        }
        expect(r.totals.commission_kobo).toBeGreaterThanOrEqual(13500)
        expect(r.note).toMatch(/nothing has been paid/i)
      }
      for (const who of [AAL2(support), AAL2(o.owner), AAL2(o.cust), AAL1(fin), null]) {
        expect((await callFails(c, who, `select public.admin_settlement_overview() r`)).code).toBe(
          PRIV_DENIED,
        )
      }
    })
  })

  it('the pending figure is an estimate for paid orders that are not completed, and a stranger gets nothing', async () => {
    await withTx(async (c) => {
      const o = await openOrder(c)
      const s = (await callJson(c, AAL2(o.owner), `select public.vendor_settlement_summary($1) r`, [
        o.vendor,
      ])) as {
        pending: { orders: number; gross_sales_kobo: number; estimated_commission_kobo: number }
      }
      expect(s.pending).toMatchObject({
        orders: 1,
        gross_sales_kobo: 300000,
        estimated_commission_kobo: 13500,
      })
      const stranger = await createUser(c, 'stranger')
      expect(
        (
          await callFails(c, AAL2(stranger), `select public.vendor_settlement_summary($1) r`, [
            o.vendor,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
    })
  })
})
