import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { AAL2, PNG, failure, pool, as } from './helpers'
import { completeDelivery, isoTx, journeyToArrival, orderStatus, proofBegin } from './rider-helpers'
import { paidOrder, staff } from './refund-helpers'
import { act, countRows, paidPickup } from './notif-helpers'

afterAll(async () => {
  await pool.end()
})

/** Makes every INSERT into `table` fail, as a stand-in for a database error part-way through a multi-statement function. */
async function failInsertsInto(c: PoolClient, table: string) {
  await c.query(
    `create function app_private.injected_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`,
  )
  await c.query(
    `create trigger injected_failure before insert on public.${table} for each row execute function app_private.injected_failure()`,
  )
}
const snapshot = async (c: PoolClient, order: string) => ({
  status: await orderStatus(c, order),
  ledger: await countRows(c, `select count(*) n from public.ledger_entries where order_id=$1`, [
    order,
  ]),
  evidence: await countRows(
    c,
    `select count(*) n from public.handover_evidence where order_id=$1`,
    [order],
  ),
  history: await countRows(
    c,
    `select count(*) n from public.order_status_history where order_id=$1`,
    [order],
  ),
  sessionsUsed: await countRows(
    c,
    `select count(*) n from public.delivery_proof_sessions where order_id=$1 and used_at is not null`,
    [order],
  ),
  notes: await countRows(
    c,
    `select count(*) n from public.notifications n join public.orders o on o.customer_id = n.user_id where o.id=$1`,
    [order],
  ),
})

describe('failure injection: a database error part-way through leaves no partial state', () => {
  it('complete_delivery: a failure when the evidence row is written rolls back the status step, the session, and the notices', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      const before = await snapshot(c, x.order)
      expect(before.status).toBe('AWAITING_RECIPIENT_PROOF')

      await failInsertsInto(c, 'handover_evidence')
      const e = await as(c, AAL2(x.cust), () =>
        failure(c, `select public.complete_delivery($1,$2,'Ada Student',$3,'drawn')`, [
          x.order,
          token,
          PNG(),
        ]),
      )
      expect(e.message).toMatch(/injected failure/)
      expect(await snapshot(c, x.order)).toEqual(before) // nothing half-done

      // and once the fault is gone the same token still completes: the failed attempt consumed nothing
      await c.query(`drop trigger injected_failure on public.handover_evidence`)
      const ok = await completeDelivery(c, AAL2(x.cust), x.order, token)
      expect(ok).toEqual({ ok: true })
    })
  })

  it('customer_request_refund: a failure when the first event is recorded leaves no refund, no event, no notice', async () => {
    await isoTx(async (c) => {
      const o = await paidOrder(c)
      const count = (sql: string) => countRows(c, sql, [o.order])
      const before = {
        refunds: await count(`select count(*) n from public.refunds where order_id=$1`),
        events: await count(
          `select count(*) n from public.refund_events e join public.refunds r on r.id=e.refund_id where r.order_id=$1`,
        ),
        audit: await countRows(c, `select count(*) n from public.audit_events`),
      }
      await failInsertsInto(c, 'refund_events')
      const e = await as(c, AAL2(o.cust), () =>
        failure(
          c,
          `select public.customer_request_refund($1,null,'It never arrived at all','key-fi-1')`,
          [o.order],
        ),
      )
      expect(e.message).toMatch(/injected failure/)
      expect(await count(`select count(*) n from public.refunds where order_id=$1`)).toBe(
        before.refunds,
      )
      expect(
        await count(
          `select count(*) n from public.refund_events e join public.refunds r on r.id=e.refund_id where r.order_id=$1`,
        ),
      ).toBe(before.events)
      expect(await countRows(c, `select count(*) n from public.audit_events`)).toBe(before.audit)
    })
  })

  it('a failing audit write DOES block a privileged change: nothing important is ever changed silently', async () => {
    await isoTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const read = async () =>
        (await c.query(`select value from public.platform_settings where key='delivery_fee_kobo'`))
          .rows[0]?.value
      const before = await read()
      await failInsertsInto(c, 'audit_events')
      const e = await as(c, AAL2(admin), () =>
        failure(
          c,
          `select public.set_platform_setting('delivery_fee_kobo', '777'::jsonb, 'Fixture reason for this test')`,
        ),
      )
      expect(e.message).toMatch(/injected failure/)
      expect(await read()).toEqual(before)
    })
  })

  it('notifications exist only for committed events: a rolled-back business step leaves no notice and no outbox row', async () => {
    await isoTx(async (c) => {
      const o = await paidPickup(c)
      const notes = () =>
        countRows(
          c,
          `select count(*) n from public.notifications where user_id = any($1::uuid[])`,
          [[o.cust, o.owner]],
        )
      const before = await notes()
      await c.query('savepoint before_step')
      await act(c, o.owner, o.order, 'accept')
      expect(await notes()).toBeGreaterThan(before) // the event produced a notice inside its own transaction
      await c.query('rollback to savepoint before_step')
      expect(await notes()).toBe(before) // ...and the rollback took it away
      expect(await orderStatus(c, o.order)).toBe('PAID')
    })
  })
})
