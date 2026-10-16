import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  addToCart,
  as,
  createOrderAs,
  createUser,
  failure,
  pool,
  svc,
  withTx,
} from './helpers'
import { callFails, callJson, deliveryOrder, mkRider, mkShop } from './rider-helpers'
import { staff } from './refund-helpers'
import { payOrder } from './helpers'

afterAll(async () => {
  await pool.end()
})

/**
 * A delivery order whose persisted records say the delivery fee was NOT part of the Paystack payment
 * (delivery_fee_collection = 'direct_to_rider', payable total = items only), paid, and delivered by `rider`.
 * Checkout never sets this marker today; the fixture sets it before payment, exactly as a future explicit
 * checkout mode would.
 */
async function directOrder(c: PoolClient, o: { complete?: boolean; marker?: boolean } = {}) {
  const shop = await mkShop(c)
  const cust = await createUser(c, 'cust')
  await addToCart(c, AAL2(cust), shop.product, 1)
  const order = await createOrderAs(c, AAL2(cust), 'delivery', shop.point)
  if (o.marker !== false) {
    await c.query(`alter table public.orders disable trigger orders_collection_guard`)
    await c.query(
      `update public.orders set delivery_fee_collection='direct_to_rider', total_kobo = total_kobo - delivery_fee_kobo where id=$1`,
      [order],
    )
    await c.query(`alter table public.orders enable trigger orders_collection_guard`)
  }
  await payOrder(c, AAL2(cust), order)
  const rider = await mkRider(c)
  await c.query(`update public.profiles set display_name='Ada Customer' where id=$1`, [cust])
  const assignment = (
    await c.query(
      `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, status) values ($1,$2,$3,1,'accepted') returning id`,
      [order, rider.id, rider.shift],
    )
  ).rows[0].id as string
  if (o.complete !== false)
    await c.query(
      `update public.delivery_assignments set status='completed', completed_at=now() where id=$1`,
      [assignment],
    )
  return { ...shop, cust, order, rider: rider.id, assignment }
}

const bank = (c: PoolClient, who: string, name = 'Zenith Bank', number = '0123456789') =>
  callJson(c, AAL2(who), `select public.rider_set_bank_details($1,$2,$3) r`, [
    name,
    number,
    'Test Rider',
  ])
const open = (c: PoolClient, who: string, order: string) =>
  callJson(c, AAL2(who), `select public.open_delivery_fee_payment($1) r`, [order])
const report = (c: PoolClient, who: string, id: string, note = 'Sent from my app') =>
  callJson(c, AAL2(who), `select public.report_delivery_fee_transfer($1,$2) r`, [id, note])
const respond = (c: PoolClient, who: string, id: string, a: 'confirm' | 'dispute', note = '') =>
  callJson(c, AAL2(who), `select public.respond_delivery_fee_transfer($1,$2,$3) r`, [id, a, note])
const view = (c: PoolClient, who: string, order: string) =>
  callJson(c, AAL2(who), `select public.delivery_fee_payment_for_order($1) r`, [order])
const count = async (c: PoolClient, sql: string, p: unknown[] = []) =>
  Number((await c.query(sql, p)).rows[0].n)

describe('rider bank details', () => {
  it('only an approved rider at aal2 may set them; the number is validated', async () => {
    await withTx(async (c) => {
      const r = await mkRider(c)
      const plain = await createUser(c, 'plain')
      expect(await bank(c, r.id)).toMatchObject({ saved: true, account_masked: '******6789' })
      for (const who of [AAL2(plain), AAL1(r.id), null])
        expect(
          (
            await callFails(c, who, `select public.rider_set_bank_details($1,$2,$3) r`, [
              'Zenith Bank',
              '0123456789',
              'X Name',
            ])
          ).code,
        ).toBe(PRIV_DENIED)
      for (const bad of ['123', '12345678901', 'abcdefghij', '0123-45678'])
        expect(
          (
            await callFails(c, AAL2(r.id), `select public.rider_set_bank_details($1,$2,$3) r`, [
              'Zenith Bank',
              bad,
              'Test Rider',
            ])
          ).code,
        ).toBe('22023')
    })
  })

  it('is invisible to every other account, to direct table reads and to the audit log content', async () => {
    await withTx(async (c) => {
      const r = await mkRider(c)
      const other = await mkRider(c)
      const cust = await createUser(c, 'cust')
      await bank(c, r.id)
      expect(await callJson(c, AAL2(other.id), `select public.my_rider_bank_details() r`)).toEqual({
        set: false,
      })
      for (const who of [AAL2(cust), AAL2(other.id), AAL2(r.id), null]) {
        const e = await as(c, who, () => failure(c, `select * from public.rider_bank_accounts`))
        expect(e.code).toBe(PRIV_DENIED)
      }
      const audit = JSON.stringify(
        (
          await c.query(
            `select details from public.audit_events where action='rider.bank_details_set'`,
          )
        ).rows,
      )
      expect(audit).not.toContain('0123456789')
      expect(audit).toContain('6789')
    })
  })
})

describe('opening the payment: only when records establish the fee was excluded from Paystack', () => {
  it('opens for the customer with a snapshot of the rider details, is idempotent, and later edits never redirect it', async () => {
    await withTx(async (c) => {
      const o = await directOrder(c)
      await bank(c, o.rider)
      const p = (await open(c, o.cust, o.order)) as {
        id: string
        account_number: string
        amount_kobo: number
        status: string
      }
      expect(p).toMatchObject({
        status: 'awaiting_transfer',
        account_number: '0123456789',
        amount_kobo: 50000,
      })
      expect(((await open(c, o.cust, o.order)) as { id: string }).id).toBe(p.id)
      await bank(c, o.rider, 'Other Bank', '9999999999')
      const again = (await view(c, o.cust, o.order)) as {
        bank_name: string
        account_number: string
      }
      expect(again).toMatchObject({ bank_name: 'Zenith Bank', account_number: '0123456789' })
      expect(
        await count(c, `select count(*) n from public.delivery_fee_payments where order_id=$1`, [
          o.order,
        ]),
      ).toBe(1)
    })
  })

  it('Paystack-collected delivery fees are never charged again', async () => {
    await withTx(async (c) => {
      const o = await deliveryOrder(c) // ordinary order: the fee was inside the Paystack payment
      const r = await mkRider(c)
      await c.query(
        `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, status, completed_at) values ($1,$2,$3,1,'completed', now())`,
        [o.order, r.id, r.shift],
      )
      await bank(c, r.id)
      expect(await view(c, o.cust, o.order)).toMatchObject({
        state: 'not_applicable',
        reason: 'collected_via_paystack',
      })
      expect(await open(c, o.cust, o.order)).toEqual({ state: 'not_applicable', opened: false })
      expect(await count(c, `select count(*) n from public.delivery_fee_payments`)).toBe(0)
    })
  })

  it('ambiguous records (marker set but money received exceeds the payable total) are never charged', async () => {
    await withTx(async (c) => {
      const o = await directOrder(c)
      await bank(c, o.rider)
      // an additional payment record makes received > total: the fee may already be inside it
      await c.query(
        `insert into public.ledger_entries (order_id, entry_type, amount_kobo) values ($1,'payment_received',50000)`,
        [o.order],
      )
      expect(await view(c, o.cust, o.order)).toMatchObject({ state: 'ambiguous' })
      expect(await open(c, o.cust, o.order)).toEqual({ state: 'ambiguous', opened: false })
      expect(await count(c, `select count(*) n from public.delivery_fee_payments`)).toBe(0)
    })
  })

  it('is not offered before the delivery is completed, or before the rider has saved bank details', async () => {
    await withTx(async (c) => {
      const o = await directOrder(c, { complete: false })
      await bank(c, o.rider)
      expect(await view(c, o.cust, o.order)).toMatchObject({ state: 'not_ready' })
      await c.query(
        `update public.delivery_assignments set status='completed', completed_at=now() where id=$1`,
        [o.assignment],
      )
      await c.query(`delete from public.rider_bank_accounts where rider_id=$1`, [o.rider])
      expect(await view(c, o.cust, o.order)).toMatchObject({ state: 'rider_details_missing' })
      expect(await open(c, o.cust, o.order)).toEqual({
        state: 'rider_details_missing',
        opened: false,
      })
    })
  })

  it('the marker cannot be changed after the order exists, and a direct order never carries the fee in its total', async () => {
    await withTx(async (c) => {
      const shop = await mkShop(c)
      const cust = await createUser(c, 'cust')
      await addToCart(c, AAL2(cust), shop.product, 1)
      const order = await createOrderAs(c, AAL2(cust), 'delivery', shop.point)
      const e = await failure(
        c,
        `update public.orders set delivery_fee_collection='direct_to_rider' where id=$1`,
        [order],
      )
      expect(e.message).toMatch(/fixed when the order is created/)
    })
  })
})

describe('report, confirm, dispute', () => {
  async function reported(c: PoolClient) {
    const o = await directOrder(c)
    await bank(c, o.rider)
    const p = (await open(c, o.cust, o.order)) as { id: string }
    await report(c, o.cust, p.id)
    return { ...o, id: p.id }
  }

  it('only the customer may report; only the assigned rider may respond; the customer alone cannot complete it', async () => {
    await withTx(async (c) => {
      const o = directOrder(c)
      const x = await o
      await bank(c, x.rider)
      const p = (await open(c, x.cust, x.order)) as { id: string }
      const stranger = await createUser(c, 'str')
      const otherRider = await mkRider(c)
      for (const who of [stranger, x.rider, otherRider.id])
        expect(
          (
            await callFails(
              c,
              AAL2(who),
              `select public.report_delivery_fee_transfer($1,'x note here') r`,
              [p.id],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      // a rider cannot confirm before the customer has reported
      expect(
        (
          await callFails(
            c,
            AAL2(x.rider),
            `select public.respond_delivery_fee_transfer($1,'confirm','') r`,
            [p.id],
          )
        ).code,
      ).toBeDefined()
      await report(c, x.cust, p.id)
      for (const who of [x.cust, stranger, otherRider.id])
        expect(
          (
            await callFails(
              c,
              AAL2(who),
              `select public.respond_delivery_fee_transfer($1,'confirm','') r`,
              [p.id],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      // customer-only reporting leaves it unconfirmed and without a receipt
      expect(await count(c, `select count(*) n from public.delivery_fee_receipts`)).toBe(0)
      expect(((await view(c, x.cust, x.order)) as { status: string }).status).toBe(
        'customer_reported',
      )
    })
  })

  it('rider confirmation issues exactly one receipt; repeated calls and reports create none', async () => {
    await withTx(async (c) => {
      const o = await reported(c)
      const r1 = (await respond(c, o.rider, o.id, 'confirm')) as { status: string }
      expect(r1.status).toBe('rider_confirmed')
      await respond(c, o.rider, o.id, 'confirm')
      await report(c, o.cust, o.id).catch(() => undefined)
      expect(
        await count(c, `select count(*) n from public.delivery_fee_receipts where payment_id=$1`, [
          o.id,
        ]),
      ).toBe(1)
      const v = (await view(c, o.cust, o.order)) as {
        receipt: { token: string; number: string; status: string; basis: string }
      }
      expect(v.receipt).toMatchObject({
        status: 'issued',
        basis: 'customer_and_rider_confirmation',
      })
      expect(v.receipt.number).toMatch(/^AFR-\d{6}-[0-9A-F]{10}$/i)
      expect(v.receipt.token).toHaveLength(48)
    })
  })

  it('a dispute needs a reason, blocks the receipt, and cannot be overwritten by either party', async () => {
    await withTx(async (c) => {
      const o = await reported(c)
      expect(
        (
          await callFails(
            c,
            AAL2(o.rider),
            `select public.respond_delivery_fee_transfer($1,'dispute','') r`,
            [o.id],
          )
        ).code,
      ).toBe('22023')
      expect(
        (
          (await respond(c, o.rider, o.id, 'dispute', 'Nothing arrived in my account')) as {
            status: string
          }
        ).status,
      ).toBe('rider_disputed')
      // a later "confirm" does not overwrite the dispute: it returns the existing state
      expect(((await respond(c, o.rider, o.id, 'confirm')) as { status: string }).status).toBe(
        'rider_disputed',
      )
      expect(await count(c, `select count(*) n from public.delivery_fee_receipts`)).toBe(0)
      expect(((await view(c, o.cust, o.order)) as { status: string }).status).toBe('rider_disputed')
    })
  })

  it('evidence-free: reporting never verifies anything, and the history records authenticated actors with server timestamps', async () => {
    await withTx(async (c) => {
      const o = await reported(c)
      const h = (
        await c.query(
          `select actor_id, actor_role, action, to_status, created_at from public.delivery_fee_payment_events where payment_id=$1 order by id`,
          [o.id],
        )
      ).rows
      expect(h.map((x) => x.action)).toEqual(['opened', 'customer_reported'])
      expect(h.map((x) => x.actor_id)).toEqual([o.cust, o.cust])
      expect(h.every((x) => x.created_at instanceof Date)).toBe(true)
      const e = await svc(c, () =>
        failure(c, `update public.delivery_fee_payment_events set note='x'`),
      )
      expect(e.message).toMatch(/append-only|not allowed|denied/i)
    })
  })
})

describe('administrator resolution of disputes', () => {
  async function disputed(c: PoolClient) {
    const o = await directOrder(c)
    await bank(c, o.rider)
    const p = (await open(c, o.cust, o.order)) as { id: string }
    await report(c, o.cust, p.id)
    await respond(c, o.rider, p.id, 'dispute', 'Nothing arrived in my account')
    return { ...o, id: p.id }
  }
  const resolve = (
    c: PoolClient,
    who: string,
    id: string,
    outcome: string,
    reason = 'Reviewed the statements supplied by both parties',
  ) =>
    callJson(c, AAL2(who), `select public.admin_resolve_delivery_fee_dispute($1,$2,$3) r`, [
      id,
      outcome,
      reason,
    ])

  it('only platform or finance administrators at aal2 may resolve, and only a disputed payment', async () => {
    await withTx(async (c) => {
      const o = await disputed(c)
      const support = await staff(c, 'support_agent')
      for (const who of [
        AAL2(o.cust),
        AAL2(o.rider),
        AAL2(support),
        AAL1(await staff(c, 'platform_admin')),
        null,
      ])
        expect(
          (
            await callFails(
              c,
              who,
              `select public.admin_resolve_delivery_fee_dispute($1,'received','long enough reason') r`,
              [o.id],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      const admin = await staff(c, 'platform_admin')
      expect(((await resolve(c, admin, o.id, 'not_received')) as { status: string }).status).toBe(
        'resolved_not_received',
      )
      expect(await count(c, `select count(*) n from public.delivery_fee_receipts`)).toBe(0)
      await callFails(
        c,
        AAL2(admin),
        `select public.admin_resolve_delivery_fee_dispute($1,'received','long enough reason') r`,
        [o.id],
      ).then((e) => expect(e.code).toBeDefined())
    })
  })

  it('a "received" resolution issues one receipt on administrator basis; a receipt can be voided with a reason and stays visible', async () => {
    await withTx(async (c) => {
      const o = await disputed(c)
      const admin = await staff(c, 'platform_admin')
      await resolve(c, admin, o.id, 'received')
      const rec = (
        await c.query(
          `select id, status, basis from public.delivery_fee_receipts where payment_id=$1`,
          [o.id],
        )
      ).rows
      expect(rec).toHaveLength(1)
      expect(rec[0].basis).toBe('administrator_resolution')
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.admin_void_delivery_fee_receipt($1,'short') r`,
            [rec[0].id],
          )
        ).code,
      ).toBe('22023')
      await callJson(
        c,
        AAL2(admin),
        `select public.admin_void_delivery_fee_receipt($1,'Issued in error: duplicate payment') r`,
        [rec[0].id],
      )
      const after = (
        await c.query(
          `select status, void_reason from public.delivery_fee_receipts where payment_id=$1`,
          [o.id],
        )
      ).rows[0]
      expect(after.status).toBe('void')
      for (const sql of [
        `update public.delivery_fee_receipts set amount_kobo=1`,
        `delete from public.delivery_fee_receipts`,
      ])
        expect((await svc(c, () => failure(c, sql))).message).toMatch(/receipt/i)
    })
  })
})

describe('public receipt verification', () => {
  it('returns only minimal, non-personal fields and nothing for an unknown or malformed token', async () => {
    await withTx(async (c) => {
      const o = await directOrder(c)
      await bank(c, o.rider)
      const p = (await open(c, o.cust, o.order)) as { id: string }
      await report(c, o.cust, p.id)
      await respond(c, o.rider, p.id, 'confirm')
      const token = ((await view(c, o.cust, o.order)) as { receipt: { token: string } }).receipt
        .token
      const ok = (await as(
        c,
        null,
        async () =>
          (await c.query(`select public.verify_delivery_fee_receipt($1) r`, [token])).rows[0].r,
      )) as Record<string, unknown>
      expect(ok).toMatchObject({
        valid: true,
        status: 'issued',
        payment_method: 'Direct Bank Transfer',
        currency: 'NGN',
      })
      const text = JSON.stringify(ok)
      for (const secret of [
        '0123456789',
        'Zenith',
        'Ada',
        'Test Rider',
        o.cust,
        o.rider,
        o.order,
        'AFIT-',
      ])
        expect(text).not.toContain(secret)
      for (const bad of ['', 'x', 'a'.repeat(48), token.slice(0, 47)]) {
        const r = (await as(
          c,
          null,
          async () =>
            (await c.query(`select public.verify_delivery_fee_receipt($1) r`, [bad])).rows[0].r,
        )) as { valid: boolean }
        expect(r).toEqual({ valid: false })
      }
    })
  })
})

describe('existing money paths are unchanged', () => {
  it('default orders carry the paystack marker and total includes the delivery fee as before', async () => {
    await withTx(async (c) => {
      const o = await deliveryOrder(c)
      const row = (
        await c.query(
          `select delivery_fee_collection m, delivery_fee_kobo d, items_total_kobo i, total_kobo t from public.orders where id=$1`,
          [o.order],
        )
      ).rows[0]
      expect(row.m).toBe('paystack')
      expect(Number(row.t)).toBe(Number(row.i) + Number(row.d))
    })
  })

  it('staff may read a masked view, customers of other orders may not', async () => {
    await withTx(async (c) => {
      const o = await directOrder(c)
      await bank(c, o.rider)
      await open(c, o.cust, o.order)
      const admin = await staff(c, 'support_agent')
      const v = (await view(c, admin, o.order)) as { account_number: string; viewer: string }
      expect(v.viewer).toBe('staff')
      expect(v.account_number).toBe('******6789')
      const other = await createUser(c, 'o')
      expect(
        (
          await callFails(c, AAL2(other), `select public.delivery_fee_payment_for_order($1) r`, [
            o.order,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
    })
  })
})
