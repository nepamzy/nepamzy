import { afterAll, describe, expect, it } from 'vitest'
import { AAL2, pool } from './helpers'
import {
  accept,
  callFails,
  callJson,
  deliveryOrder,
  isoTx,
  mkRider,
  orderStatus,
  proofBegin,
  rider,
} from './rider-helpers'

afterAll(async () => {
  await pool.end()
})

describe('rider taps "I have arrived"', () => {
  it('moves an en-route delivery to arrival, records how, lets only that rider do it, and cannot be repeated or skipped ahead', async () => {
    await isoTx(async (c) => {
      const y = await deliveryOrder(c)
      const r = await mkRider(c)
      const other = await mkRider(c)
      const a = await accept(c, r.id, y.order)

      // not yet on the way: the tap is refused
      expect(
        (await callFails(c, rider(r.id), `select public.rider_tap_arrived($1)`, [a.assignment_id]))
          .message,
      ).toMatch(/invalid_transition/)

      const t = (await callJson(c, rider(r.id), `select public.rider_issue_handover_token($1) r`, [
        a.assignment_id,
      ])) as { token: string }
      await callJson(c, AAL2(y.owner), `select public.vendor_confirm_rider_pickup($1,$2) r`, [
        y.order,
        t.token,
      ])
      await callJson(c, rider(r.id), `select public.rider_start_route($1) r`, [a.assignment_id])

      // another rider, and the customer, cannot mark it
      expect(
        (
          await callFails(c, rider(other.id), `select public.rider_tap_arrived($1)`, [
            a.assignment_id,
          ])
        ).message,
      ).toMatch(/forbidden/)
      expect(
        (await callFails(c, AAL2(y.cust), `select public.rider_tap_arrived($1)`, [a.assignment_id]))
          .message,
      ).toBeTruthy()
      // and the recipient still cannot start the proof
      expect(
        (await callFails(c, AAL2(y.cust), `select public.delivery_proof_begin($1)`, [y.order]))
          .message,
      ).toMatch(/invalid_transition/)

      // the rider taps: arrival is recorded as a tap, the order moves, the hand-over can begin
      const first = (await callJson(c, rider(r.id), `select public.rider_tap_arrived($1) r`, [
        a.assignment_id,
      ])) as { ok: boolean; already: boolean }
      expect(first).toMatchObject({ ok: true, already: false })
      expect(await orderStatus(c, y.order)).toBe('ARRIVAL_DETECTED')
      const row = (
        await c.query(
          `select arrival_source, arrival_detected_at from public.delivery_assignments where id=$1`,
          [a.assignment_id],
        )
      ).rows[0]
      expect(row.arrival_source).toBe('rider_tap')
      expect(row.arrival_detected_at).not.toBeNull()
      await proofBegin(c, AAL2(y.cust), y.order)

      // a second tap changes nothing
      const again = (await callJson(c, rider(r.id), `select public.rider_tap_arrived($1) r`, [
        a.assignment_id,
      ])) as { already: boolean }
      expect(again.already).toBe(true)
      expect(
        (
          await c.query(`select arrival_source from public.delivery_assignments where id=$1`, [
            a.assignment_id,
          ])
        ).rows[0].arrival_source,
      ).toBe('rider_tap')
    })
  })
})
