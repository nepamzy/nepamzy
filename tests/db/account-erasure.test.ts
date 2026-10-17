import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  pool,
  svc,
  withTx,
} from './helpers'
import { staff } from './refund-helpers'
import { callFails, callJson, mkRider } from './rider-helpers'
import { paidOrder } from './refund-helpers'

afterAll(async () => {
  await pool.end()
})

const erase = (
  c: PoolClient,
  who: string,
  user: string,
  reason = 'Requested by the account holder',
  dr: string | null = null,
) =>
  callJson(c, AAL2(who), `select public.admin_erase_account($1,$2,$3) r`, [
    user,
    reason,
    dr,
  ]) as Promise<{
    erased: boolean
    already_erased?: boolean
    blockers?: string[]
    retained?: string[]
  }>
const cipher = `v1.t1.AAAAAAAAAAAAAAAA.${'q'.repeat(30)}`
const n = async (c: PoolClient, sql: string, p: unknown[] = []) =>
  Number((await c.query(sql, p)).rows[0].n)

describe('account erasure: authorisation', () => {
  it('only a platform administrator at aal2 may erase; nobody may erase themselves; unknown accounts are refused', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const finance = await staff(c, 'finance_admin')
      const victim = await createUser(c, 'victim')
      for (const who of [AAL2(finance), AAL2(victim), AAL1(admin), null])
        expect(
          (
            await callFails(
              c,
              who,
              `select public.admin_erase_account($1,'Requested by the account holder',null) r`,
              [victim],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.admin_erase_account($1,'Requested by the account holder',null) r`,
            [admin],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(c, AAL2(admin), `select public.admin_erase_account($1,'short',null) r`, [
            victim,
          ])
        ).code,
      ).toBe('22023')
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.admin_erase_account(gen_random_uuid(),'Requested by the account holder',null) r`,
          )
        ).code,
      ).toBe('P0002')
      expect(
        await n(c, `select count(*) n from public.account_erasures where user_id=$1`, [victim]),
      ).toBe(0)
    })
  })
})

describe('account erasure: customers', () => {
  it('is refused while an order is open, with the blocker named and nothing changed', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const o = await paidOrder(c, { status: 'PICKUP_AWAITING_HANDOVER' })
      await c.query(`update public.profiles set display_name='Ada' where id=$1`, [o.cust])
      const r = await erase(c, admin, o.cust)
      expect(r).toMatchObject({ erased: false, blockers: ['open_orders'] })
      expect(
        (await c.query(`select display_name from public.profiles where id=$1`, [o.cust])).rows[0]
          .display_name,
      ).toBe('Ada')
      expect(
        await n(
          c,
          `select count(*) n from public.audit_events where action='account.erasure_refused' and entity_id=$1`,
          [o.cust],
        ),
      ).toBe(1)
    })
  })

  it('anonymises a customer with only finished orders, keeps every financial record, blocks sign-in, and is idempotent', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const o = await paidOrder(c, { status: 'COMPLETED' })
      await c.query(`update public.profiles set display_name='Ada' where id=$1`, [o.cust])
      const before = {
        orders: await n(c, `select count(*) n from public.orders where customer_id=$1`, [o.cust]),
        ledger: await n(
          c,
          `select coalesce(sum(amount_kobo),0) n from public.ledger_entries where order_id=$1`,
          [o.order],
        ),
        settle: await n(
          c,
          `select count(*) n from public.order_settlement_lines where order_id=$1`,
          [o.order],
        ),
      }
      const dr = (
        await c.query(
          `insert into public.data_requests (user_id, kind, detail) values ($1,'deletion','please') returning id`,
          [o.cust],
        )
      ).rows[0].id as string
      const r = await erase(c, admin, o.cust, 'Requested by the account holder', dr)
      expect(r).toMatchObject({ erased: true, already_erased: false })
      expect(r.retained!.length).toBeGreaterThan(3)
      const u = (
        await c.query(
          `select email, encrypted_password, banned_until from auth.users where id=$1`,
          [o.cust],
        )
      ).rows[0]
      expect(u.email).toBe(`erased-${o.cust}@erased.invalid`)
      expect(u.encrypted_password).toBe('')
      expect(u.banned_until).not.toBeNull()
      expect(
        (await c.query(`select display_name from public.profiles where id=$1`, [o.cust])).rows[0]
          .display_name,
      ).toBeNull()
      expect(
        await n(
          c,
          `select count(*) n from public.role_assignments where user_id=$1 and status='active'`,
          [o.cust],
        ),
      ).toBe(0)
      expect(await n(c, `select count(*) n from public.carts where user_id=$1`, [o.cust])).toBe(0)
      // financial history is intact
      expect(
        await n(c, `select count(*) n from public.orders where customer_id=$1`, [o.cust]),
      ).toBe(before.orders)
      expect(
        await n(
          c,
          `select coalesce(sum(amount_kobo),0) n from public.ledger_entries where order_id=$1`,
          [o.order],
        ),
      ).toBe(before.ledger)
      expect(
        await n(c, `select count(*) n from public.order_settlement_lines where order_id=$1`, [
          o.order,
        ]),
      ).toBe(before.settle)
      expect(
        (await c.query(`select status from public.data_requests where id=$1`, [dr])).rows[0].status,
      ).toBe('completed')
      // second call: same answer, no second record
      expect(await erase(c, admin, o.cust)).toMatchObject({ erased: true, already_erased: true })
      expect(
        await n(c, `select count(*) n from public.account_erasures where user_id=$1`, [o.cust]),
      ).toBe(1)
      // the record is append-only
      expect(
        (await svc(c, () => failure(c, `delete from public.account_erasures`))).message,
      ).toMatch(/append-only|not allowed|denied/i)
    })
  })
})

describe('account erasure: riders, receipts and bank details', () => {
  it('removes bank details and personal data, scrubs the payment snapshot, keeps the receipt verifiable with anonymised names', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const { directPaidDelivery } = await import('./delivery-fee-fixture')
      const x = await directPaidDelivery(c)
      await callJson(
        c,
        AAL2(x.rider),
        `select public.rider_set_bank_details('Zenith Bank',$1,'6789','Test Rider') r`,
        [cipher],
      )
      const p = (await callJson(c, AAL2(x.cust), `select public.open_delivery_fee_payment($1) r`, [
        x.order,
      ])) as { id: string }
      await callJson(
        c,
        AAL2(x.cust),
        `select public.report_delivery_fee_transfer($1,'sent at 3pm') r`,
        [p.id],
      )
      // unresolved payment blocks both parties
      expect(await erase(c, admin, x.rider)).toMatchObject({
        erased: false,
        blockers: expect.arrayContaining(['open_delivery_fee_payments']),
      })
      const resp = await callJson(
        c,
        AAL2(x.rider),
        `select public.respond_delivery_fee_transfer($1,'confirm','') r`,
        [p.id],
      )
      const token = (
        (await callJson(c, AAL2(x.cust), `select public.delivery_fee_payment_for_order($1) r`, [
          x.order,
        ])) as { receipt: { token: string } }
      ).receipt.token
      void resp
      expect(await erase(c, admin, x.rider)).toMatchObject({ erased: true })

      expect(
        await n(c, `select count(*) n from public.rider_bank_accounts where rider_id=$1`, [
          x.rider,
        ]),
      ).toBe(0)
      const snap = (
        await c.query(
          `select bank_name, account_name, account_number, account_cipher, account_last4, details_erased from public.delivery_fee_payments where id=$1`,
          [p.id],
        )
      ).rows[0]
      expect(snap).toEqual({
        bank_name: '(erased)',
        account_name: '(erased)',
        account_number: null,
        account_cipher: null,
        account_last4: null,
        details_erased: true,
      })
      expect(
        (
          await c.query(
            `select full_name, contact_phone, status from public.rider_profiles where user_id=$1`,
            [x.rider],
          )
        ).rows[0],
      ).toEqual({ full_name: 'Former rider', contact_phone: '0000000000', status: 'suspended' })
      const rc = (
        await c.query(
          `select rider_name, customer_name, amount_kobo, status from public.delivery_fee_receipts where payment_id=$1`,
          [p.id],
        )
      ).rows[0]
      expect(rc.rider_name).toBe('Former rider')
      expect(rc.customer_name).not.toBe('Former rider')
      // the public check still works and still shows nothing personal
      const v = (await as(
        c,
        null,
        async () =>
          (await c.query(`select public.verify_delivery_fee_receipt($1) r`, [token])).rows[0].r,
      )) as { valid: boolean; status: string }
      expect(v).toMatchObject({ valid: true, status: 'issued' })
      // a receipt still cannot be edited in any other way
      expect(
        (await svc(c, () => failure(c, `update public.delivery_fee_receipts set amount_kobo=1`)))
          .message,
      ).toMatch(/receipt/i)
      expect(
        (
          await svc(c, () =>
            failure(c, `update public.delivery_fee_receipts set rider_name='Somebody'`),
          )
        ).message,
      ).toMatch(/receipt/i)
      // staff views of the erased payment show no details
      const staffView = (await callJson(
        c,
        AAL2(admin),
        `select public.delivery_fee_payment_for_order($1) r`,
        [x.order],
      )) as Record<string, unknown>
      expect(staffView).toMatchObject({ details_erased: true })
      expect(JSON.stringify(staffView)).not.toContain('Zenith')
    })
  })

  it('refuses to erase a rider with an active delivery, a staff member, or the owner of an active shop', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const riderA = await mkRider(c)
      const o = await paidOrder(c, { status: 'COMPLETED' })
      await c.query(
        `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, status) values ($1,$2,$3,1,'accepted')`,
        [o.order, riderA.id, riderA.shift],
      )
      expect(await erase(c, admin, riderA.id)).toMatchObject({
        erased: false,
        blockers: ['active_deliveries'],
      })
      const other = await staff(c, 'support_agent')
      expect(await erase(c, admin, other)).toMatchObject({
        erased: false,
        blockers: ['staff_account'],
      })
      expect(await erase(c, admin, o.owner)).toMatchObject({
        erased: false,
        blockers: ['owns_active_shop'],
      })
      void giveRole
    })
  })
})
