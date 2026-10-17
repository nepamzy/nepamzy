import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { AAL1, AAL2, PRIV_DENIED, as, createUser, failure, pool, withTx } from './helpers'
import { staff } from './refund-helpers'
import {
  callFails,
  callJson,
  completeDelivery,
  isoTx,
  journeyToArrival,
  mkRider,
  orderStatus,
  proofBegin,
} from './rider-helpers'

afterAll(async () => {
  await pool.end()
})

/**
 * The delivery-fee collection mode is a PLATFORM SETTING read inside create_order. The browser supplies no flag; nobody but an
 * aal2 platform administrator (with a recorded reason) can switch it; existing orders keep the mode they were created with.
 */
const setMode = (
  c: PoolClient,
  who: string,
  mode: string,
  reason = 'Owner approved direct payment trial',
) =>
  callJson(
    c,
    AAL2(who),
    `select public.set_platform_setting('delivery_fee_collection_mode', $1::jsonb, $2) r`,
    [JSON.stringify(mode), reason],
  )
const flip = (c: PoolClient, mode: 'paystack' | 'direct_to_rider') =>
  c.query(
    `update public.platform_settings set value = $1::jsonb where key = 'delivery_fee_collection_mode'`,
    [JSON.stringify(mode)],
  )
const row = async (c: PoolClient, order: string) =>
  (
    await c.query(
      `select delivery_fee_collection m, delivery_fee_kobo::int fee, items_total_kobo::int items, total_kobo::int total from public.orders where id=$1`,
      [order],
    )
  ).rows[0] as { m: string; fee: number; items: number; total: number }
const received = async (c: PoolClient, order: string) =>
  Number(
    (
      await c.query(
        `select coalesce(sum(amount_kobo),0) n from public.ledger_entries where order_id=$1 and entry_type='payment_received'`,
        [order],
      )
    ).rows[0].n,
  )
const cipher = `v1.t1.AAAAAAAAAAAAAAAA.${'z'.repeat(30)}`
const view = (c: PoolClient, who: string, order: string) =>
  callJson(c, AAL2(who), `select public.delivery_fee_payment_for_order($1) r`, [order]) as Promise<
    Record<string, unknown>
  >

describe('who may change the collection mode', () => {
  it('defaults to paystack; only a platform administrator at aal2 with a reason may change it; only the two values are valid', async () => {
    await withTx(async (c) => {
      const v = (
        await c.query(
          `select value #>> '{}' v from public.platform_settings where key='delivery_fee_collection_mode'`,
        )
      ).rows[0].v
      expect(v).toBe('paystack')
      const admin = await staff(c, 'platform_admin')
      const finance = await staff(c, 'finance_admin')
      const cust = await createUser(c, 'cust')
      for (const who of [AAL2(finance), AAL2(cust), AAL1(admin), null])
        expect(
          (
            await callFails(
              c,
              who,
              `select public.set_platform_setting('delivery_fee_collection_mode','"direct_to_rider"','A long enough reason') r`,
            )
          ).code,
        ).toBe(PRIV_DENIED)
      for (const bad of ['"cash"', 'true', '1', 'null'])
        expect(
          (
            await callFails(
              c,
              AAL2(admin),
              `select public.set_platform_setting('delivery_fee_collection_mode',$1::jsonb,'A long enough reason') r`,
              [bad],
            )
          ).code,
        ).toBe('22023')
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.set_platform_setting('delivery_fee_collection_mode','"direct_to_rider"','short') r`,
          )
        ).code,
      ).toBe('22023')
      await setMode(c, admin, 'direct_to_rider')
      const audit = await c.query(
        `select details from public.audit_events where action='setting.changed' and entity_id='delivery_fee_collection_mode'`,
      )
      expect(audit.rows[0].details).toMatchObject({
        old: 'paystack',
        new: 'direct_to_rider',
        outcome: 'applied',
      })
    })
  })

  it('a customer cannot write the marker or the total themselves (orders are function-only)', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      for (const sql of [
        `update public.orders set delivery_fee_collection='direct_to_rider' where id=$1`,
        `update public.orders set total_kobo=1 where id=$1`,
      ])
        expect((await as(c, AAL2(x.cust), () => failure(c, sql, [x.order]))).code).toBe(PRIV_DENIED)
    })
  })
})

describe('what an order records', () => {
  it('paystack mode (default): the fee is inside the Paystack total, the marker says paystack, and no direct payment is ever offered', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const o = await row(c, x.order)
      expect(o).toMatchObject({ m: 'paystack', fee: 50000 })
      expect(o.total).toBe(o.items + o.fee)
      expect(await received(c, x.order)).toBe(o.total)
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      await completeDelivery(c, AAL2(x.cust), x.order, token)
      expect(await orderStatus(c, x.order)).toBe('COMPLETED')
      expect(await view(c, x.cust, x.order)).toMatchObject({
        state: 'not_applicable',
        reason: 'collected_via_paystack',
      })
      expect(
        await callJson(c, AAL2(x.cust), `select public.open_delivery_fee_payment($1) r`, [x.order]),
      ).toEqual({ state: 'not_applicable', opened: false })
    })
  })

  it('direct mode: the fee is excluded from the Paystack total, recorded as direct_to_rider, and the full lifecycle works once to a receipt', async () => {
    await isoTx(async (c) => {
      await flip(c, 'direct_to_rider')
      const x = await journeyToArrival(c)
      const o = await row(c, x.order)
      expect(o).toMatchObject({ m: 'direct_to_rider', fee: 50000 })
      expect(o.total).toBe(o.items) // the delivery fee is NOT in the amount Paystack collected
      expect(await received(c, x.order)).toBe(o.total)
      const audit = (
        await c.query(
          `select details from public.audit_events where action='order.created' and entity_id=$1`,
          [x.order],
        )
      ).rows[0].details
      expect(audit).toMatchObject({
        delivery_fee_collection: 'direct_to_rider',
        decided_by: 'platform_setting',
      })

      // not offered before the delivery is complete
      expect(await view(c, x.cust, x.order)).toMatchObject({ state: 'not_ready' })
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      expect(await completeDelivery(c, AAL2(x.cust), x.order, token)).toEqual({ ok: true })
      expect(await orderStatus(c, x.order)).toBe('COMPLETED')

      // the rider has not added bank details yet: nothing is charged or opened
      expect(await view(c, x.cust, x.order)).toMatchObject({ state: 'rider_details_missing' })
      await callJson(
        c,
        AAL2(x.r.id),
        `select public.rider_set_bank_details('Test Bank',$1,'6789','Test Rider') r`,
        [cipher],
      )
      expect(await view(c, x.cust, x.order)).toMatchObject({
        state: 'ready_to_open',
        amount_kobo: 50000,
      })
      const p = (await callJson(c, AAL2(x.cust), `select public.open_delivery_fee_payment($1) r`, [
        x.order,
      ])) as { id: string; status: string; amount_kobo: number }
      expect(p).toMatchObject({ status: 'awaiting_transfer', amount_kobo: 50000 })
      await callJson(c, AAL2(x.cust), `select public.report_delivery_fee_transfer($1,'sent') r`, [
        p.id,
      ])
      // a customer cannot confirm for the rider
      expect(
        (
          await callFails(
            c,
            AAL2(x.cust),
            `select public.respond_delivery_fee_transfer($1,'confirm','') r`,
            [p.id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      await callJson(
        c,
        AAL2(x.r.id),
        `select public.respond_delivery_fee_transfer($1,'confirm','') r`,
        [p.id],
      )
      await callJson(
        c,
        AAL2(x.r.id),
        `select public.respond_delivery_fee_transfer($1,'confirm','') r`,
        [p.id],
      ) // replay
      expect(
        (
          await c.query(
            `select count(*)::int n from public.delivery_fee_receipts where payment_id=$1`,
            [p.id],
          )
        ).rows[0].n,
      ).toBe(1)
      // the Paystack-side money never changed
      expect(await received(c, x.order)).toBe(o.total)
    })
  })

  it('switching the setting later never changes an existing order; a retried create_order keeps the original decision', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c) // created while the mode was paystack
      await flip(c, 'direct_to_rider')
      expect((await row(c, x.order)).m).toBe('paystack')
      const q = await c.query(
        `select count(*)::int n from public.orders where idempotency_key = (select idempotency_key from public.orders where id=$1)`,
        [x.order],
      )
      expect(q.rows[0].n).toBe(1)
    })
  })

  it('pickup orders and zero delivery fees are always paystack, whatever the mode', async () => {
    await isoTx(async (c) => {
      await flip(c, 'direct_to_rider')
      await c.query(
        `update public.platform_settings set value='0'::jsonb where key='delivery_fee_kobo'`,
      )
      const { deliveryOrder } = await import('./rider-helpers')
      const { fixPricing } = await import('./helpers')
      const shop = await (await import('./rider-helpers')).mkShop(c)
      await fixPricing(c, { delivery: 0 })
      const x = await deliveryOrder(c, { shop })
      expect((await row(c, x.order)).m).toBe('paystack')
    })
  })

  it('the quote shown at checkout matches what is stored (pay now vs pay the rider)', async () => {
    await isoTx(async (c) => {
      await flip(c, 'direct_to_rider')
      const { mkShop } = await import('./rider-helpers')
      const { addToCart } = await import('./helpers')
      const shop = await mkShop(c)
      const cust = await createUser(c, 'cust')
      await addToCart(c, AAL2(cust), shop.product, 1)
      const q = (await callJson(c, AAL2(cust), `select public.cart_quote('delivery',$1) r`, [
        shop.point,
      ])) as Record<string, number | string>
      expect(q).toMatchObject({
        delivery_fee_collection: 'direct_to_rider',
        delivery_fee_to_rider_kobo: 50000,
      })
      expect(Number(q.total_kobo)).toBe(Number(q.items_total_kobo))
      const pickup = (await callJson(
        c,
        AAL2(cust),
        `select public.cart_quote('pickup',null) r`,
      )) as Record<string, number | string>
      expect(pickup).toMatchObject({
        delivery_fee_collection: 'paystack',
        delivery_fee_to_rider_kobo: 0,
      })
    })
  })
})

describe('failure and inconsistency never create a second obligation', () => {
  it('an unpaid or cancelled direct order is never offered; a refunded one is not either', async () => {
    await isoTx(async (c) => {
      await flip(c, 'direct_to_rider')
      const { deliveryOrder, mkShop } = await import('./rider-helpers')
      const shop = await mkShop(c)
      const x = await deliveryOrder(c, { shop })
      const rider = await mkRider(c)
      await c.query(
        `insert into public.rider_bank_accounts (rider_id, bank_name, account_cipher, account_last4, account_name) values ($1,'Test Bank',$2,'6789','Test Name')`,
        [rider.id, cipher],
      )
      await c.query(
        `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, status, completed_at) values ($1,$2,$3,1,'completed', now())`,
        [x.order, rider.id, rider.shift],
      )
      // the order is contested or reversed (disputed, refunded, cancelled): no payment obligation is created
      for (const status of ['DISPUTED', 'REFUNDED', 'CANCELLED']) {
        await c.query(`update public.orders set status=$2 where id=$1`, [x.order, status])
        expect(await view(c, x.cust, x.order)).toMatchObject({ state: 'not_ready' })
        expect(
          await callJson(c, AAL2(x.cust), `select public.open_delivery_fee_payment($1) r`, [
            x.order,
          ]),
        ).toMatchObject({ opened: false })
      }
      expect(
        (
          await c.query(
            `select count(*)::int n from public.delivery_fee_payments where order_id=$1`,
            [x.order],
          )
        ).rows[0].n,
      ).toBe(0)
    })
  })
})
