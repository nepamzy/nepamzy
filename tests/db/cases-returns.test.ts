import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PNG,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  pool,
  withTx,
} from './helpers'
import { completeDelivery, isoTx, journeyToArrival, proofBegin, rider } from './rider-helpers'
import {
  approve,
  callFails,
  callJson,
  orderStatusOf,
  paidOrder,
  requestRefund,
  staff,
} from './refund-helpers'

afterAll(async () => {
  await pool.end()
})

const returnReq = (
  c: PoolClient,
  cust: string,
  order: string,
  items: { order_item_id: string; quantity: number }[],
  key = `rk-${Math.random().toString(36).slice(2)}-${Date.now()}`,
) =>
  callJson(
    c,
    AAL2(cust),
    `select public.customer_request_return($1,$2::jsonb,'It arrived damaged',$3) r`,
    [order, JSON.stringify(items), key],
  ) as Promise<{ id: string; status: string; replayed: boolean }>
const openCase = (
  c: PoolClient,
  cust: string,
  order: string,
  type = 'missing_item',
  key?: string,
) =>
  callJson(
    c,
    AAL2(cust),
    `select public.open_support_case($1,$2,'One item was missing from the bag',$3) r`,
    [order, type, key ?? `ck-${Math.random().toString(36).slice(2)}-${Date.now()}`],
  ) as Promise<{ id: string; case_no: string; replayed: boolean }>
const stock = async (c: PoolClient, product: string) =>
  Number(
    (await c.query(`select stock_quantity n from public.products where id=$1`, [product])).rows[0]
      .n,
  )

describe('returns: a separate record, with policy and quantity limits, and no side effects on money or stock', () => {
  it('request -> staff approval -> shop confirms receipt; the order follows; refunds, ledger and stock are untouched', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      const [a] = o.items
      const before = await stock(c, o.products[0]!)
      const r = await returnReq(c, o.cust, o.order, [{ order_item_id: a!.id, quantity: 1 }])
      expect(r.status).toBe('requested')
      expect(await orderStatusOf(c, o.order)).toBe('RETURN_REQUESTED')
      // the customer cannot decide; the shop cannot confirm before approval
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.staff_decide_return($1,'approve','my own return')`,
            [r.id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(
            c,
            AAL2(o.owner),
            `select public.vendor_confirm_return_received($1,'looks fine')`,
            [r.id],
          )
        ).message,
      ).toMatch(/return_invalid_transition/)
      await callJson(
        c,
        AAL2(sup),
        `select public.staff_decide_return($1,'approve','Damage photos seen by support') r`,
        [r.id],
      )
      expect(await orderStatusOf(c, o.order)).toBe('RETURN_IN_PROGRESS')
      const stranger = await createUser(c, 'otherowner')
      await giveRole(c, stranger, 'vendor_owner')
      expect(
        (
          await callFails(
            c,
            AAL2(stranger),
            `select public.vendor_confirm_return_received($1,'looks fine')`,
            [r.id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      await callJson(
        c,
        AAL2(o.owner),
        `select public.vendor_confirm_return_received($1,'Box opened, item damaged') r`,
        [r.id],
      )
      expect(await orderStatusOf(c, o.order)).toBe('RETURNED_TO_VENDOR')
      // a return is NOT proof of a refund, and nothing is restocked
      expect(
        (await c.query(`select count(*)::int n from public.refunds where order_id=$1`, [o.order]))
          .rows[0].n,
      ).toBe(0)
      expect(
        (
          await c.query(
            `select count(*)::int n from public.ledger_entries where order_id=$1 and entry_type='refund_paid'`,
            [o.order],
          )
        ).rows[0].n,
      ).toBe(0)
      expect(await stock(c, o.products[0]!)).toBe(before)
      // ...and a refund can still be requested afterwards, through its own workflow
      const refund = await requestRefund(c, o.cust, o.order, [
        { order_item_id: a!.id, quantity: 1 },
      ])
      expect(refund.status).toBe('requested')
      const view = await callJson(c, AAL2(o.cust), `select public.list_returns($1) r`, [o.order])
      expect(view[0]).toMatchObject({
        status: 'received_by_vendor',
        vendor_condition: 'Box opened, item damaged',
      })
    })
  })

  it('quantities, foreign items, duplicates and wrong states are refused', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const other = await paidOrder(c)
      const [a, b] = o.items
      const call = (items: unknown, key: string, who = o.cust) =>
        callFails(
          c,
          AAL2(who),
          `select public.customer_request_return($1,$2::jsonb,'It arrived damaged',$3)`,
          [o.order, JSON.stringify(items), key],
        )
      expect(
        (await call([{ order_item_id: a!.id, quantity: 2 }], 'rk-too-many-1')).message,
      ).toMatch(/return_quantity_exceeds_purchased/)
      expect(
        (await call([{ order_item_id: other.items[0]!.id, quantity: 1 }], 'rk-foreign-1')).message,
      ).toMatch(/return_invalid_item/)
      expect((await call([], 'rk-empty-123')).message).toMatch(/return_invalid_item/)
      expect((await call([{ order_item_id: a!.id, quantity: 0 }], 'rk-zero-123')).message).toMatch(
        /return_invalid_item/,
      )
      const stranger = await createUser(c, 'stranger')
      expect(
        (await call([{ order_item_id: a!.id, quantity: 1 }], 'rk-stranger-1', stranger)).code,
      ).toBe(PRIV_DENIED)
      await returnReq(c, o.cust, o.order, [{ order_item_id: a!.id, quantity: 1 }], 'rk-first-1234')
      const again = await returnReq(
        c,
        o.cust,
        o.order,
        [{ order_item_id: a!.id, quantity: 1 }],
        'rk-first-1234',
      )
      expect(again.replayed).toBe(true)
      expect(
        (await call([{ order_item_id: a!.id, quantity: 1 }], 'rk-second-123')).message,
      ).toMatch(/return_quantity_exceeds_purchased/)
      await c.query(`update public.orders set status='PAID' where id=$1`, [o.order])
      expect(
        (await call([{ order_item_id: b!.id, quantity: 1 }], 'rk-state-1234')).message,
      ).toMatch(/order_not_returnable/)
    })
  })

  it('the category policy is configurable: not_returnable blocks approval (rejection restores the order); case_by_case is a human decision', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      const admin = await staff(c, 'platform_admin')
      const slug = (
        await c.query(
          `select cat.slug from public.vendors v join public.categories cat on cat.id=v.category_id where v.id=$1`,
          [o.vendor],
        )
      ).rows[0]?.slug
      // validation of the setting itself
      for (const bad of [
        '"x"',
        '{"default":"maybe"}',
        '{"default":"returnable","categories":{"food":"sometimes"}}',
        '{"categories":{}}',
      ]) {
        const e = await callFails(
          c,
          AAL2(admin),
          `select public.set_platform_setting('return_policy',$1::jsonb)`,
          [bad],
        )
        expect(e.message, bad).toMatch(/invalid value/)
      }
      await callJson(
        c,
        AAL2(admin),
        `select public.set_platform_setting('return_policy',$1::jsonb) r`,
        [
          JSON.stringify({
            default: 'case_by_case',
            categories: slug ? { [slug]: 'not_returnable' } : {},
          }),
        ],
      )
      const [a] = o.items
      const r = await returnReq(c, o.cust, o.order, [{ order_item_id: a!.id, quantity: 1 }])
      if (slug) {
        expect(
          (
            await callFails(
              c,
              AAL2(sup),
              `select public.staff_decide_return($1,'approve','policy says no')`,
              [r.id],
            )
          ).message,
        ).toMatch(/return_not_permitted/)
        await callJson(
          c,
          AAL2(sup),
          `select public.staff_decide_return($1,'reject','Not returnable under policy') r`,
          [r.id],
        )
        expect(await orderStatusOf(c, o.order)).toBe('COMPLETED')
        // a rejected request no longer holds the quantity
        const r2 = await returnReq(c, o.cust, o.order, [{ order_item_id: a!.id, quantity: 1 }])
        expect(r2.status).toBe('requested')
      }
      await callJson(
        c,
        AAL2(admin),
        `select public.set_platform_setting('return_policy',$1::jsonb) r`,
        [JSON.stringify({ default: 'case_by_case', categories: {} })],
      )
    })
  })

  it('illegal return transitions are refused even for the table owner', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const r = await returnReq(c, o.cust, o.order, [
        { order_item_id: o.items[0]!.id, quantity: 1 },
      ])
      for (const to of ['received_by_vendor', 'closed']) {
        expect(
          (await failure(c, `update public.return_requests set status=$2 where id=$1`, [r.id, to]))
            .message,
        ).toMatch(/return_invalid_transition/)
      }
      expect(
        (
          await failure(c, `update public.return_requests set order_id=$2 where id=$1`, [
            r.id,
            (await paidOrder(c)).order,
          ])
        ).message,
      ).toMatch(/return_core_immutable/)
    })
  })
})

describe('support cases: scoped, audited, never automatic', () => {
  it('a customer opens a case on their own paid order; completed orders are flagged DISPUTED; duplicates and strangers are refused', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const k = await openCase(c, o.cust, o.order, 'missing_item', 'case-key-12345')
      expect(k.case_no).toMatch(/^CASE-\d+$/)
      expect(await orderStatusOf(c, o.order)).toBe('DISPUTED')
      expect((await openCase(c, o.cust, o.order, 'missing_item', 'case-key-12345')).replayed).toBe(
        true,
      )
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.open_support_case($1,'missing_item','Still missing the same item',$2)`,
            [o.order, 'case-key-other-1'],
          )
        ).message,
      ).toMatch(/case_already_open/)
      const second = await openCase(c, o.cust, o.order, 'quality')
      expect(second.id).not.toBe(k.id)
      const stranger = await createUser(c, 'stranger')
      for (const who of [AAL2(stranger), AAL2(o.owner), AAL1(o.cust), null]) {
        const e = await as(c, who, () =>
          failure(
            c,
            `select public.open_support_case($1,'other','Something is wrong with this',$2)`,
            [o.order, 'k-denied-12345'],
          ),
        )
        expect(['42501', '28000']).toContain(e.code)
      }
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.open_support_case($1,'other','short',$2)`,
            [o.order, 'k-short-desc-1'],
          )
        ).message,
      ).toMatch(/description_required/)
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.open_support_case($1,'bogus','Something is wrong with this',$2)`,
            [o.order, 'k-bad-type-12'],
          )
        ).message,
      ).toMatch(/invalid_reason/)
    })
  })

  it("each party sees only its own statements plus support's public ones; internal notes are staff-only", async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c) // an order with a shop, a customer and a rider
      const k = await openCase(c, x.cust, x.order, 'delivery_problem')
      expect(await orderStatusOf(c, x.order)).toBe('ARRIVAL_DETECTED') // in-flight orders are not re-labelled
      const sup = await staff(c, 'support_agent')
      const say = (who: ReturnType<typeof AAL2>, body: string, internal = false) =>
        callJson(c, who, `select public.case_add_statement($1,$2,$3) r`, [k.id, body, internal])
      await say(AAL2(x.cust), 'The customer says the rider never came')
      await say(AAL2(x.owner), 'The shop says the bag was sealed and handed over')
      await say(rider(x.r.id), 'The rider says the customer was unreachable')
      await say(AAL2(sup), 'Support public note: we are looking at this')
      await say(AAL2(sup), 'Support internal note: possible pattern', true)
      const bodies = async (who: ReturnType<typeof AAL2>) =>
        (
          (await callJson(c, who, `select public.get_case($1) r`, [k.id])).statements as {
            body: string
          }[]
        ).map((s) => s.body)
      expect(await bodies(AAL2(x.cust))).toEqual([
        'The customer says the rider never came',
        'Support public note: we are looking at this',
      ])
      expect(await bodies(AAL2(x.owner))).toEqual([
        'The shop says the bag was sealed and handed over',
        'Support public note: we are looking at this',
      ])
      expect(await bodies(rider(x.r.id))).toEqual([
        'The rider says the customer was unreachable',
        'Support public note: we are looking at this',
      ])
      expect((await bodies(AAL2(sup))).length).toBe(5)
      // only the customer sees their own description; shops and riders get the neutral summary
      const vendorView = await callJson(c, AAL2(x.owner), `select public.get_case($1) r`, [k.id])
      expect(vendorView.description).toBeNull()
      expect(vendorView.viewer).toBe('vendor')
      // outsiders, aal1 and customers' internal flag attempts are refused
      const stranger = await createUser(c, 'stranger')
      for (const who of [AAL2(stranger), AAL1(x.cust)]) {
        expect((await callFails(c, who, `select public.get_case($1)`, [k.id])).code).toBe(
          PRIV_DENIED,
        )
        expect(
          (
            await callFails(c, who, `select public.case_add_statement($1,'let me in please')`, [
              k.id,
            ])
          ).code,
        ).toBe(PRIV_DENIED)
      }
      expect(
        (
          await callFails(
            c,
            AAL2(x.cust),
            `select public.case_add_statement($1,'secret note please',true)`,
            [k.id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      // direct table reads follow the same boundaries
      const direct = (who: ReturnType<typeof AAL2>, t: string) =>
        as(c, who, async () => (await c.query(`select 1 from public.${t}`)).rowCount)
      expect(await direct(AAL2(x.cust), 'case_statements')).toBe(2)
      expect(await direct(AAL2(x.owner), 'case_statements')).toBe(0)
      expect(await direct(rider(x.r.id), 'support_cases')).toBe(0)
      expect(await direct(AAL2(x.cust), 'case_events')).toBe(0)
      // statements are append-only
      expect((await failure(c, `update public.case_statements set body='edited'`)).message).toMatch(
        /append-only/,
      )
    })
  })

  it('the evidence bundle is neutral: staff only, audited, no coordinates, no signature image, no secrets', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      await completeDelivery(c, AAL2(x.cust), x.order, token)
      const k = await openCase(c, x.cust, x.order, 'not_received')
      const sup = await staff(c, 'support_agent')
      const fin = await staff(c, 'finance_admin')
      for (const who of [AAL2(x.cust), AAL2(x.owner), rider(x.r.id), AAL2(fin), AAL1(sup)]) {
        expect((await callFails(c, who, `select public.staff_case_bundle($1)`, [k.id])).code).toBe(
          PRIV_DENIED,
        )
      }
      const b = await callJson(c, AAL2(sup), `select public.staff_case_bundle($1) r`, [k.id])
      expect(b.delivery_proof).toMatchObject({ kind: 'delivery', method: 'drawn' })
      expect(b.assignments[0]).toMatchObject({ status: 'completed' })
      expect(b.note).toMatch(/not used to decide/)
      const text = JSON.stringify(b)
      expect(text).not.toMatch(
        /signature_png|token_hash|code_hash|"lat"|"lng"|latitude|longitude|secret/i,
      )
      expect(
        (
          await c.query(
            `select count(*)::int n from public.audit_events where action='case.bundle_viewed' and entity_id=$1`,
            [x.order],
          )
        ).rows[0].n,
      ).toBe(1)
    })
  })

  it('decisions need a reason and a different person; a refund decision only CREATES a refund request that finance must approve', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const k = await openCase(c, o.cust, o.order, 'missing_item')
      const sup = await staff(c, 'support_agent')
      const fin = await staff(c, 'finance_admin')
      const mid = o.items.find((i) => i.unit_price_kobo === 150000)!
      for (const who of [AAL2(o.cust), AAL2(o.owner), AAL2(fin), AAL1(sup)]) {
        expect(
          (
            await callFails(
              c,
              who,
              `select public.case_decide($1,'no_action','this is a long enough reason')`,
              [k.id],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      }
      expect(
        (
          await callFails(c, AAL2(sup), `select public.case_decide($1,'full_refund','short')`, [
            k.id,
          ])
        ).message,
      ).toMatch(/reason/)
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.case_decide($1,'partial_refund','item was never in the bag')`,
            [k.id],
          )
        ).message,
      ).toMatch(/refund_invalid_item/)
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.case_decide($1,'bogus','item was never in the bag')`,
            [k.id],
          )
        ).message,
      ).toMatch(/invalid decision/)
      const d = await callJson(
        c,
        AAL2(sup),
        `select public.case_decide($1,'partial_refund','item was never in the bag',$2::jsonb) r`,
        [k.id, JSON.stringify([{ order_item_id: mid.id, quantity: 1 }])],
      )
      expect(d.refund).toMatchObject({ status: 'requested', amount_kobo: 150000, replayed: false })
      const refund = (
        await c.query(
          `select source, case_id, requested_by, provider_mode from public.refunds where id=$1`,
          [d.refund.id],
        )
      ).rows[0]
      expect(refund).toMatchObject({
        source: 'case',
        case_id: k.id,
        requested_by: sup,
        provider_mode: 'none',
      })
      // the support agent who created it cannot approve it; finance can; nothing has been paid
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.refund_decide($1,'approve','approving my own')`,
            [d.refund.id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      await approve(c, fin, d.refund.id)
      expect(
        (
          await c.query(
            `select count(*)::int n from public.ledger_entries where order_id=$1 and entry_type='refund_paid'`,
            [o.order],
          )
        ).rows[0].n,
      ).toBe(0)
      // deciding twice, or closing before deciding, is refused; closing restores the order
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.case_decide($1,'no_action','a second decision here')`,
            [k.id],
          )
        ).message,
      ).toMatch(/case_invalid_transition/)
      await callJson(c, AAL2(sup), `select public.case_close($1,'all done') r`, [k.id])
      expect(await orderStatusOf(c, o.order)).toBe('COMPLETED')
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.case_add_statement($1,'one more thing please')`,
            [k.id],
          )
        ).message,
      ).toMatch(/case_closed/)
      const c2 = await openCase(c, o.cust, o.order, 'quality')
      expect(
        (await callFails(c, AAL2(sup), `select public.case_close($1,'too early')`, [c2.id]))
          .message,
      ).toMatch(/case_invalid_transition/)
    })
  })

  it('a return decision creates an approved return (policy applies); replacement/reject/no_action record the decision only', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      const a = o.items[0]!
      const k = await openCase(c, o.cust, o.order, 'damaged')
      const d = await callJson(
        c,
        AAL2(sup),
        `select public.case_decide($1,'return','Customer must send the damaged item back',$2::jsonb) r`,
        [k.id, JSON.stringify([{ order_item_id: a.id, quantity: 1 }])],
      )
      expect(d.return.status).toBe('approved')
      expect(await orderStatusOf(c, o.order)).toBe('RETURN_IN_PROGRESS')
      const k2 = await openCase(c, o.cust, o.order, 'quality')
      const d2 = await callJson(
        c,
        AAL2(sup),
        `select public.case_decide($1,'reject','Evidence does not support the claim') r`,
        [k2.id],
      )
      expect(d2).toMatchObject({ decision: 'reject', refund: null, return: null })
      expect(
        (await c.query(`select count(*)::int n from public.refunds where order_id=$1`, [o.order]))
          .rows[0].n,
      ).toBe(0)
    })
  })

  it('a case never edits the original delivery proof', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      await completeDelivery(c, AAL2(x.cust), x.order, token, PNG())
      const snap = async () =>
        (await c.query(`select * from public.handover_evidence where order_id=$1`, [x.order]))
          .rows[0]
      const before = await snap()
      const k = await openCase(c, x.cust, x.order, 'not_received')
      const sup = await staff(c, 'support_agent')
      await callJson(
        c,
        AAL2(sup),
        `select public.case_decide($1,'reject','Delivery proof shows a signed receipt') r`,
        [k.id],
      )
      await callJson(c, AAL2(sup), `select public.case_close($1,'closed') r`, [k.id])
      expect(await snap()).toEqual(before)
    })
  })

  it('only case_decide can set a decision: nothing is decided automatically', async () => {
    const r = await pool.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','app_private') and p.prosrc ~* 'update public\\.support_cases[^;]*set[^;]*decision'`,
    )
    expect(r.rows.map((x) => x.proname)).toEqual(['case_decide'])
  })
})

describe('supervised delivery exceptions (support only; never marks anything delivered)', () => {
  it('releases the parcel in hand, kills the confirmation session, frees the slot and opens a case', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      const sup = await staff(c, 'support_agent')
      const fin = await staff(c, 'finance_admin')
      for (const who of [AAL2(x.cust), AAL2(x.owner), rider(x.r.id), AAL2(fin), AAL1(sup)]) {
        expect(
          (
            await callFails(
              c,
              who,
              `select public.ops_handle_delivery_exception($1,'recipient never showed up')`,
              [x.order],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      }
      expect(
        (
          await callFails(c, AAL2(sup), `select public.ops_handle_delivery_exception($1,'short')`, [
            x.order,
          ])
        ).message,
      ).toMatch(/reason_required/)
      const r = await callJson(
        c,
        AAL2(sup),
        `select public.ops_handle_delivery_exception($1,'recipient never showed up at the point') r`,
        [x.order],
      )
      expect(r.case_no).toMatch(/^CASE-/)
      expect(await orderStatusOf(c, x.order)).toBe('DISPUTED')
      expect(
        (
          await c.query(`select status from public.delivery_assignments where id=$1`, [
            x.a.assignment_id,
          ])
        ).rows[0].status,
      ).toBe('released')
      expect(
        (
          await c.query(`select count(*)::int n from public.handover_evidence where order_id=$1`, [
            x.order,
          ])
        ).rows[0].n,
      ).toBe(0)
      expect(
        (
          await c.query(
            `select count(*)::int n from public.rider_location_current where rider_id=$1`,
            [x.r.id],
          )
        ).rows[0].n,
      ).toBe(0)
      // the customer's old confirmation can no longer complete anything
      const e = await callFails(
        c,
        AAL2(x.cust),
        `select public.complete_delivery($1,$2,'Ada Student',$3)`,
        [x.order, token, PNG()],
      )
      expect(e.message).toMatch(/invalid_transition/)
      // the case is under review and assigned to the support agent; a second call reuses it
      const again = await callFails(
        c,
        AAL2(sup),
        `select public.ops_handle_delivery_exception($1,'trying once more here')`,
        [x.order],
      )
      expect(again.message).toMatch(/invalid_transition/)
    })
  })

  it('finished or not-yet-travelling orders are refused', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.ops_handle_delivery_exception($1,'order is already finished')`,
            [o.order],
          )
        ).message,
      ).toMatch(/invalid_transition/)
    })
  })
})
