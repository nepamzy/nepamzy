import { afterAll, describe, expect, it } from 'vitest'
import { as, createUser, failure, giveRole, pool, withTx } from './helpers'
import { paidOrder } from './refund-helpers'
import type { PoolClient } from 'pg'

afterAll(async () => {
  await pool.end()
})

/** Completes the order the way the app does: a COMPLETED row in the status history (which writes the settlement line and the payout). */
async function complete(c: PoolClient, order: string) {
  await c.query(
    `insert into public.order_status_history (order_id, from_status, to_status, reason) values ($1, 'PICKUP_AWAITING_HANDOVER', 'COMPLETED', 'test')`,
    [order],
  )
}
const payout = async (c: PoolClient, order: string) =>
  (await c.query(`select * from public.vendor_payouts where order_id = $1`, [order])).rows[0]
const claim = async (c: PoolClient) =>
  (await c.query(`select * from public.payout_claim_due(50)`)).rows
const makeDue = (c: PoolClient, order: string) =>
  c.query(
    `update public.vendor_payouts set eligible_at = now() - interval '1 minute' where order_id = $1`,
    [order],
  )

describe('automatic vendor payouts', () => {
  it('schedules one payout 24 hours after the order is completed, and never before it is due', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, { status: 'PICKUP_AWAITING_HANDOVER' })
      expect(await payout(c, o.order)).toBeUndefined()
      await complete(c, o.order)
      const p = await payout(c, o.order)
      expect(p.status).toBe('scheduled')
      const hours = (new Date(p.eligible_at).getTime() - Date.now()) / 3_600_000
      expect(hours).toBeGreaterThan(23.9)
      expect(hours).toBeLessThan(24.1)
      expect((await claim(c)).filter((r) => r.o_id === p.id)).toHaveLength(0)
    })
  })

  it('claims a due payout once, with the amount worked out from the books (sales - commission)', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, { status: 'PICKUP_AWAITING_HANDOVER' })
      await complete(c, o.order)
      await makeDue(c, o.order)
      const line = (
        await c.query(`select * from public.order_settlement_lines where order_id = $1`, [o.order])
      ).rows[0]
      const got = (await claim(c)).filter((r) => r.o_vendor === o.vendor)
      expect(got).toHaveLength(1)
      expect(Number(got[0].o_amount)).toBe(Number(line.base_kobo) - Number(line.commission_kobo))
      expect(got[0].o_reference).toMatch(/^afitpo-[0-9a-f]{32}-1$/)
      expect(got[0].o_resume).toBe(false)
      expect((await payout(c, o.order)).status).toBe('processing')
      // a second run does not claim it again while the first attempt is fresh
      expect((await claim(c)).filter((r) => r.o_vendor === o.vendor)).toHaveLength(0)
      // a run that stopped half way is picked up later with the SAME reference, flagged to be checked, never a new transfer
      await c.query(
        `update public.vendor_payouts set last_attempt_at = now() - interval '31 minutes' where order_id = $1`,
        [o.order],
      )
      const again = (await claim(c)).filter((r) => r.o_vendor === o.vendor)
      expect(again).toHaveLength(1)
      expect(again[0].o_resume).toBe(true)
      expect(again[0].o_reference).toBe(got[0].o_reference)
    })
  })

  it('holds the payout while a complaint is open and pays once it is closed', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, { status: 'PICKUP_AWAITING_HANDOVER' })
      await complete(c, o.order)
      await makeDue(c, o.order)
      await c.query(
        `insert into public.support_cases (order_id, reporter_id, case_type, description) values ($1, $2, 'quality', 'The food was cold when it arrived.')`,
        [o.order, o.cust],
      )
      expect((await claim(c)).filter((r) => r.o_vendor === o.vendor)).toHaveLength(0)
      expect((await payout(c, o.order)).status).toBe('held')
      await c.query(
        `update public.support_cases set status = 'closed', closed_at = now() where order_id = $1`,
        [o.order],
      )
      expect((await claim(c)).filter((r) => r.o_vendor === o.vendor)).toHaveLength(1)
    })
  })

  it('records what Paystack said: paid sticks, a failed one is retried later with a new reference, a reversal reopens it', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, { status: 'PICKUP_AWAITING_HANDOVER' })
      await complete(c, o.order)
      await makeDue(c, o.order)
      const first = (await claim(c)).find((r) => r.o_vendor === o.vendor)!
      expect(
        (
          await c.query(
            `select public.payout_mark($1, 'failed', null, 'insufficient_balance') as r`,
            [first.o_reference],
          )
        ).rows[0].r,
      ).toBe('failed')
      // not retried straight away, but after 6 hours
      expect((await claim(c)).filter((r) => r.o_vendor === o.vendor)).toHaveLength(0)
      await c.query(
        `update public.vendor_payouts set last_attempt_at = now() - interval '7 hours' where order_id = $1`,
        [o.order],
      )
      const second = (await claim(c)).find((r) => r.o_vendor === o.vendor)!
      expect(second.o_reference).toMatch(/-2$/)
      expect(second.o_reference).not.toBe(first.o_reference)
      await c.query(`select public.payout_mark($1, 'paid', 'TRF_abc123', null)`, [
        second.o_reference,
      ])
      const done = await payout(c, o.order)
      expect(done.status).toBe('paid')
      expect(done.paid_at).not.toBeNull()
      expect(done.transfer_code).toBe('TRF_abc123')
      // a late "failed" does not undo a paid payout ...
      expect(
        (
          await c.query(`select public.payout_mark($1, 'failed', null, 'late') as r`, [
            second.o_reference,
          ])
        ).rows[0].r,
      ).toBe('unchanged')
      // ... but a reversal from Paystack does
      expect(
        (
          await c.query(`select public.payout_mark($1, 'failed', null, 'reversed') as r`, [
            second.o_reference,
          ])
        ).rows[0].r,
      ).toBe('failed')
      expect(
        (await c.query(`select public.payout_mark('afitpo-unknown-1', 'paid', null, null) as r`))
          .rows[0].r,
      ).toBe('unknown')
    })
  })

  it('is closed to every API role; only staff can list or retry', async () => {
    await withTx(async (c) => {
      for (const role of ['authenticated', 'anon'])
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const r = await c.query(
            `select has_table_privilege($1, 'public.vendor_payouts', $2) as ok`,
            [role, priv],
          )
          expect(r.rows[0].ok, `${role} ${priv}`).toBe(false)
        }
      for (const fn of [
        'payout_claim_due(int)',
        'payout_mark(text, text, text, text)',
        'payout_set_recipient(uuid, text)',
      ])
        for (const role of ['authenticated', 'anon']) {
          const r = await c.query(
            `select has_function_privilege($1, 'public.${fn}', 'execute') as ok`,
            [role],
          )
          expect(r.rows[0].ok, `${role} ${fn}`).toBe(false)
        }
      const customer = await createUser(c, 'plaincust')
      const f = await as(c, { id: customer, aal: 'aal2' }, () =>
        failure(c, `select public.admin_list_payouts()`),
      )
      expect(f.code).toBe('42501')
      const fin = await createUser(c, 'fin')
      await giveRole(c, fin, 'finance_admin')
      const ok = await as(c, { id: fin, aal: 'aal2' }, () =>
        c.query(`select public.admin_list_payouts() as r`),
      )
      expect(ok.rows[0].r).toHaveProperty('rows')
      const hours = await c.query(`select public.payout_hold_hours() as h`)
      expect(hours.rows[0].h).toBe(24)
    })
  })
})
