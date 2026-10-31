import { afterAll, describe, expect, it } from 'vitest'
import { AAL2, as, createUser, pool, PRIV_DENIED } from './helpers'
import { accept, callFails, callJson, deliveryOrder, isoTx, mkRider, rider } from './rider-helpers'

afterAll(async () => {
  await pool.end()
})

const share = (c: Parameters<typeof callJson>[0], who: string, order: string) =>
  callJson(c, AAL2(who), `select public.customer_post_location($1, 0.0103, 0.01, 12) r`, [order])

describe('live map in both directions', () => {
  it('the customer shares only on their own order, only while a rider is on it, and the rider sees it', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      // no rider yet: nothing is stored
      expect((await share(c, o.cust, o.order)).reason).toBe('no_active_delivery')
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      expect((await share(c, o.cust, o.order)).accepted).toBe(true)

      const map = await callJson(c, rider(r.id), `select public.rider_job_map($1) r`, [
        a.assignment_id,
      ])
      expect(map.active).toBe(true)
      expect(map.customer.lat).toBeCloseTo(0.0103)
      expect(map.customer.stale).toBe(false)

      // someone else's order is refused, and so is a second rider looking at this job
      const stranger = await createUser(c, 'stranger')
      expect(
        (
          await callFails(c, AAL2(stranger), `select public.customer_post_location($1, 0, 0, 5)`, [
            o.order,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
      const other = await mkRider(c)
      expect(
        (await callJson(c, rider(other.id), `select public.rider_job_map($1) r`, [a.assignment_id]))
          .active,
      ).toBe(false)

      // the customer can stop at any time
      await as(c, AAL2(o.cust), async () => {
        await c.query(`select public.customer_stop_location($1)`, [o.order])
      })
      const after = await callJson(c, rider(r.id), `select public.rider_job_map($1) r`, [
        a.assignment_id,
      ])
      expect(after.customer).toBeNull()
    })
  })

  it('the shared position disappears when the delivery ends', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      await share(c, o.cust, o.order)
      await c.query(`select app_private.release_assignment($1, 'rider_suspended', $2)`, [
        a.assignment_id,
        r.id,
      ])
      expect(
        (
          await c.query(`select 1 from public.customer_location_current where order_id = $1`, [
            o.order,
          ])
        ).rowCount,
      ).toBe(0)
      expect((await share(c, o.cust, o.order)).reason).toBe('no_active_delivery')
    })
  })

  it('a rough position (a few km) is accepted and the rider is told how rough it is', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      expect(
        (
          await callJson(
            c,
            AAL2(o.cust),
            `select public.customer_post_location($1, 0.01, 0.01, 2500) r`,
            [o.order],
          )
        ).accepted,
      ).toBe(true)
      const map = await callJson(c, rider(r.id), `select public.rider_job_map($1) r`, [
        a.assignment_id,
      ])
      expect(map.customer.accuracy_m).toBe(2500)
    })
  })

  it('inaccurate or impossible positions are refused, and the table has no direct access', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      await accept(c, r.id, o.order)
      expect(
        (
          await callJson(
            c,
            AAL2(o.cust),
            `select public.customer_post_location($1, 0, 0, 9000) r`,
            [o.order],
          )
        ).reason,
      ).toBe('inaccurate')
      expect(
        (
          await callJson(c, AAL2(o.cust), `select public.customer_post_location($1, 123, 0, 5) r`, [
            o.order,
          ])
        ).reason,
      ).toBe('invalid')
      const direct = await as(c, AAL2(o.cust), async () => {
        try {
          await c.query(`select * from public.customer_location_current`)
          return 'allowed'
        } catch {
          return 'denied'
        }
      })
      expect(direct).toBe('denied')
    })
  })
})
