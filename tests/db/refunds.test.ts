import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { AAL1, AAL2, PRIV_DENIED, as, createUser, failure, giveRole, pool, withTx } from './helpers'
import { rider } from './rider-helpers'
import {
  approve,
  callFails,
  callJson,
  orderStatusOf,
  outcome,
  paidOrder,
  refundRow,
  requestRefund,
  staff,
  startFake,
} from './refund-helpers'

afterAll(async () => {
  await pool.end()
})

const events = async (c: PoolClient, refund: string) =>
  (
    await c.query(
      `select action, to_status from public.refund_events where refund_id=$1 order by id`,
      [refund],
    )
  ).rows.map((r) => `${r.action}:${r.to_status}`)

describe('refund requests: who, when and how much', () => {
  it('a customer requests a full refund of their own completed order; amount comes from the ledger, not the browser', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const r = await requestRefund(c, o.cust, o.order, null)
      expect(r).toMatchObject({ status: 'requested', amount_kobo: o.received, replayed: false })
      const row = await refundRow(c, r.id)
      expect(row.source).toBe('customer')
      expect(row.provider_mode).toBe('none')
      expect(row.requested_by).toBe(o.cust)
      expect(await events(c, r.id)).toEqual(['requested:requested'])
      // nothing moved: no ledger refund, order untouched
      expect(
        (
          await c.query(
            `select count(*)::int n from public.ledger_entries where order_id=$1 and entry_type='refund_paid'`,
            [o.order],
          )
        ).rows[0].n,
      ).toBe(0)
      expect(await orderStatusOf(c, o.order)).toBe('COMPLETED')
      // a second full request finds nothing left to refund
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.customer_request_refund($1,null,'again please',$2)`,
            [o.order, 'another-key-1'],
          )
        ).message,
      ).toMatch(/nothing_to_refund/)
    })
  })

  it('item-level refunds are computed server-side from the immutable lines (example: the missing 1,500 item)', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const mid = o.items.find((i) => i.unit_price_kobo === 150000)!
      const r = await requestRefund(c, o.cust, o.order, [{ order_item_id: mid.id, quantity: 1 }])
      expect(r.amount_kobo).toBe(150000)
      const items = (
        await c.query(`select quantity, amount_kobo from public.refund_items where refund_id=$1`, [
          r.id,
        ])
      ).rows
      expect(items).toEqual([{ quantity: 1, amount_kobo: '150000' }]) // bigint comes back as text
    })
  })

  it('discounts are shared proportionally and the service-fee share follows the owner setting (integer kobo, floor)', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, { discountKobo: 10000 })
      const mid = o.items.find((i) => i.unit_price_kobo === 150000)!
      const amt = async () =>
        Number((await c.query(`select app_private.refund_item_amount($1,1) a`, [mid.id])).rows[0].a)
      // items_total 300000, discount 10000 -> this line carries floor(150000*10000/300000) = 5000 of it
      expect(await amt()).toBe(145000)
      await c.query(
        `update public.platform_settings set value='"proportional_service_fee"'::jsonb where key='refund_fee_policy'`,
      )
      // service fee 15000 shared by net value: floor(15000 * 145000 / 290000) = 7500
      expect(await amt()).toBe(152500)
      expect(Number.isInteger(await amt())).toBe(true)
    })
  })

  it('quantities and cumulative amounts cannot exceed what was bought or received', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const [a, b, d] = o.items
      const first = await requestRefund(c, o.cust, o.order, [{ order_item_id: a!.id, quantity: 1 }])
      // the same line again: bought once
      const e1 = await callFails(
        c,
        AAL2(o.cust),
        `select public.customer_request_refund($1,$2::jsonb,'same item again please',$3)`,
        [o.order, JSON.stringify([{ order_item_id: a!.id, quantity: 1 }]), 'key-dup-line-1'],
      )
      expect(e1.message).toMatch(/refund_quantity_exceeds_purchased/)
      // an item of ANOTHER order
      const other = await paidOrder(c)
      const e2 = await callFails(
        c,
        AAL2(o.cust),
        `select public.customer_request_refund($1,$2::jsonb,'foreign item please',$3)`,
        [
          o.order,
          JSON.stringify([{ order_item_id: other.items[0]!.id, quantity: 1 }]),
          'key-foreign-1',
        ],
      )
      expect(e2.message).toMatch(/refund_invalid_item/)
      for (const bad of [0, -1, 2, 'x']) {
        const e = await callFails(
          c,
          AAL2(o.cust),
          `select public.customer_request_refund($1,$2::jsonb,'bad quantity please',$3)`,
          [
            o.order,
            JSON.stringify([{ order_item_id: b!.id, quantity: bad }]),
            `key-q-${String(bad)}-abc`,
          ],
        )
        expect(e.message, String(bad)).toMatch(
          /refund_invalid_item|refund_quantity_exceeds_purchased/,
        )
      }
      // the remainder is exactly received minus the first request
      const rest = await requestRefund(c, o.cust, o.order, null)
      expect(rest.amount_kobo).toBe(o.received - first.amount_kobo)
      expect(d).toBeDefined()
    })
  })

  it('a rejected or failed refund frees its share; an approved or succeeded one keeps it', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const r = await requestRefund(c, o.cust, o.order, null)
      await callJson(
        c,
        AAL2(fin),
        `select public.refund_decide($1,'reject','Not eligible under policy') r`,
        [r.id],
      )
      const again = await requestRefund(c, o.cust, o.order, null)
      expect(again.amount_kobo).toBe(o.received)
      await approve(c, fin, again.id)
      const fin2 = await staff(c, 'finance_admin')
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.customer_request_refund($1,null,'one more please',$2)`,
            [o.order, 'key-after-approve-1'],
          )
        ).message,
      ).toMatch(/nothing_to_refund/)
      await startFake(c, fin2, again.id)
      await outcome(c, fin2, again.id, 'failed', null)
      const third = await requestRefund(c, o.cust, o.order, null)
      expect(third.amount_kobo).toBe(o.received)
    })
  })

  it('duplicate submissions with the same key return the same refund; the same key for another order is refused', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const k = 'dup-key-123456'
      const a = await requestRefund(c, o.cust, o.order, null, 'because it was cold', k)
      const b = await requestRefund(c, o.cust, o.order, null, 'because it was cold', k)
      expect(b).toMatchObject({ id: a.id, replayed: true })
      expect(
        (await c.query(`select count(*)::int n from public.refunds where order_id=$1`, [o.order]))
          .rows[0].n,
      ).toBe(1)
      const o2 = await paidOrder(c)
      await c.query(`update public.orders set customer_id=$1 where id=$2`, [o.cust, o2.order])
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.customer_request_refund($1,null,'because it was cold',$2)`,
            [o2.order, k],
          )
        ).message,
      ).toMatch(/idempotency_conflict|duplicate/)
    })
  })

  it('only the owner, only for paid orders in a finished state, only with a reason; everyone else is refused', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const stranger = await createUser(c, 'stranger')
      const r = await staff(c, 'support_agent')
      const sql = `select public.customer_request_refund($1,null,'a proper reason',$2)`
      for (const [label, who] of [
        ['stranger', AAL2(stranger)],
        ['shop owner', AAL2(o.owner)],
        ['support', AAL2(r)],
        ['customer at aal1', AAL1(o.cust)],
        ['anonymous', null],
      ] as const) {
        const e = await as(c, who, () => failure(c, sql, [o.order, `k-${label}-123456`]))
        expect(['42501', '28000'], label).toContain(e.code)
      }
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.customer_request_refund($1,null,'no',$2)`,
            [o.order, 'k-short-reason-1'],
          )
        ).message,
      ).toMatch(/reason/)
      for (const status of ['PAID', 'EN_ROUTE', 'PREPARING', 'ACCEPTED']) {
        await c.query(`update public.orders set status=$2 where id=$1`, [o.order, status])
        expect(
          (await callFails(c, AAL2(o.cust), sql, [o.order, `k-${status}-123456`])).message,
          status,
        ).toMatch(/order_not_refundable/)
      }
    })
  })

  it('a vendor-rejected (CANCELLED) paid order can be refunded only through the same request -> approval -> execution path', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, { status: 'CANCELLED' })
      const r = await requestRefund(c, o.cust, o.order, null, 'The shop rejected my order')
      expect(r.status).toBe('requested')
      expect(await orderStatusOf(c, o.order)).toBe('CANCELLED') // a request never changes a cancelled order
      expect((await refundRow(c, r.id)).provider_mode).toBe('none')
    })
  })
})

describe('approval is not execution: roles, separation of duties and the provider boundary', () => {
  it('support reviews but cannot approve (limit 0); finance approves; the requester cannot approve or run their own', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      const r = await requestRefund(c, o.cust, o.order, null)
      // the customer and the shop have no review or decision powers
      for (const who of [AAL2(o.cust), AAL2(o.owner), rider(o.cust), AAL1(sup)]) {
        const e1 = await as(c, who, () =>
          failure(c, `select public.refund_start_review($1,'x')`, [r.id]),
        )
        expect(e1.code).toBe(PRIV_DENIED)
        const e2 = await as(c, who, () =>
          failure(c, `select public.refund_decide($1,'approve','a reason here')`, [r.id]),
        )
        expect(e2.code).toBe(PRIV_DENIED)
      }
      await callJson(c, AAL2(sup), `select public.refund_start_review($1,'looking at it') r`, [
        r.id,
      ])
      expect((await refundRow(c, r.id)).status).toBe('under_review')
      // support may reject, but approving money movement is finance's call at limit 0
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.refund_decide($1,'approve','looks fine to me')`,
            [r.id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      // a configured limit below the amount still refuses; at or above it support may approve
      await c.query(`update public.platform_settings set value=$2::jsonb where key=$1`, [
        'refund_support_approval_limit_kobo',
        String(o.received - 1),
      ])
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.refund_decide($1,'approve','looks fine to me')`,
            [r.id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      await c.query(`update public.platform_settings set value=$2::jsonb where key=$1`, [
        'refund_support_approval_limit_kobo',
        String(o.received),
      ])
      await callJson(
        c,
        AAL2(sup),
        `select public.refund_decide($1,'approve','within the support limit') r`,
        [r.id],
      )
      const row = await refundRow(c, r.id)
      expect(row).toMatchObject({ status: 'approved', decided_by: sup, provider_mode: 'none' })
      expect(row.executed_at).toBeNull() // approval alone starts nothing
      expect(await events(c, r.id)).toEqual([
        'requested:requested',
        'review_started:under_review',
        'approve:approved',
      ])
    })
  })

  it('a finance user cannot decide or execute a refund they requested themselves', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const id = (await callJson(
        c,
        AAL2(fin),
        `select public.refund_request($1,5000,'goodwill gesture') r`,
        [o.order],
      )) as string
      expect(
        (
          await callFails(
            c,
            AAL2(fin),
            `select public.refund_decide($1,'approve','my own request')`,
            [id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (await callFails(c, AAL2(fin), `select public.refund_start_review($1,'x')`, [id])).code,
      ).toBe(PRIV_DENIED)
      const other = await staff(c, 'finance_admin')
      await approve(c, other, id)
      expect(
        (await callFails(c, AAL2(fin), `select public.refund_begin_execution($1,'fake')`, [id]))
          .code,
      ).toBe(PRIV_DENIED)
    })
  })

  it('execution needs an approved refund, finance at aal2, and only the FAKE mode exists', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const sup = await staff(c, 'support_agent')
      const r = await requestRefund(c, o.cust, o.order, null)
      expect(
        (await callFails(c, AAL2(fin), `select public.refund_begin_execution($1,'fake')`, [r.id]))
          .message,
      ).toMatch(/refund_invalid_transition/)
      await approve(c, fin, r.id)
      for (const who of [AAL2(sup), AAL2(o.cust), AAL1(fin)]) {
        expect(
          (
            await as(c, who, () =>
              failure(c, `select public.refund_begin_execution($1,'fake')`, [r.id]),
            )
          ).code,
        ).toBe(PRIV_DENIED)
      }
      for (const mode of ['paystack_live', 'paystack_test', 'none', 'real']) {
        const e = await callFails(c, AAL2(fin), `select public.refund_begin_execution($1,$2)`, [
          r.id,
          mode,
        ])
        expect(e.message, mode).toMatch(/provider_not_enabled/)
      }
      expect((await refundRow(c, r.id)).status).toBe('approved')
      const fin2 = await staff(c, 'finance_admin')
      await startFake(c, fin2, r.id)
      const row = await refundRow(c, r.id)
      expect(row).toMatchObject({ status: 'processing', provider_mode: 'fake', executed_by: fin2 })
      // it cannot be started twice
      expect(
        (await callFails(c, AAL2(fin2), `select public.refund_begin_execution($1,'fake')`, [r.id]))
          .message,
      ).toMatch(/refund_invalid_transition/)
    })
  })

  it('a fake success writes the ledger entry once, labels the refund as fake and updates the order; replays are harmless', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const fin2 = await staff(c, 'finance_admin')
      const r = await requestRefund(c, o.cust, o.order, null)
      await approve(c, fin, r.id)
      await startFake(c, fin2, r.id)
      expect(await outcome(c, fin2, r.id, 'succeeded', 'fake_re_abc')).toMatchObject({
        ok: true,
        status: 'succeeded',
      })
      expect(await outcome(c, fin2, r.id, 'succeeded', 'fake_re_abc')).toMatchObject({
        ok: true,
        replayed: true,
      })
      const led = (
        await c.query(
          `select amount_kobo, refund_id from public.ledger_entries where order_id=$1 and entry_type='refund_paid'`,
          [o.order],
        )
      ).rows
      expect(led).toEqual([{ amount_kobo: String(o.received), refund_id: r.id }])
      const row = await refundRow(c, r.id)
      expect(row).toMatchObject({
        status: 'succeeded',
        provider_mode: 'fake',
        provider_refund_ref: 'fake_re_abc',
      })
      expect(await orderStatusOf(c, o.order)).toBe('REFUNDED')
      // the customer sees it labelled as fake
      const view = await callJson(c, AAL2(o.cust), `select public.my_order_refunds($1) r`, [
        o.order,
      ])
      expect(view.refunds[0]).toMatchObject({ status: 'succeeded', provider_mode: 'fake' })
      expect(view.refundable_kobo).toBe(0)
    })
  })

  it('a partial fake success leaves the order PARTIALLY_REFUNDED; failure leaves it alone and frees the amount', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const fin2 = await staff(c, 'finance_admin')
      const mid = o.items.find((i) => i.unit_price_kobo === 150000)!
      const r = await requestRefund(c, o.cust, o.order, [{ order_item_id: mid.id, quantity: 1 }])
      await approve(c, fin, r.id)
      await startFake(c, fin2, r.id)
      await outcome(c, fin2, r.id, 'succeeded', 'fake_re_part')
      expect(await orderStatusOf(c, o.order)).toBe('PARTIALLY_REFUNDED')
      const r2 = await requestRefund(c, o.cust, o.order, null)
      expect(r2.amount_kobo).toBe(o.received - 150000)
      await approve(c, fin, r2.id)
      await startFake(c, fin2, r2.id)
      expect(await outcome(c, fin2, r2.id, 'failed', null)).toMatchObject({ status: 'failed' })
      expect(await orderStatusOf(c, o.order)).toBe('PARTIALLY_REFUNDED')
      expect((await requestRefund(c, o.cust, o.order, null)).amount_kobo).toBe(o.received - 150000)
    })
  })

  it('an unknown outcome needs reconciliation; a late conflicting report raises a flag and changes nothing', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const fin2 = await staff(c, 'finance_admin')
      const r = await requestRefund(c, o.cust, o.order, null)
      await approve(c, fin, r.id)
      await startFake(c, fin2, r.id)
      expect(await outcome(c, fin2, r.id, 'unknown', null)).toMatchObject({
        status: 'reconciliation_required',
      })
      // no ledger entry and the amount stays reserved while the result is uncertain
      expect(
        (
          await c.query(
            `select count(*)::int n from public.ledger_entries where order_id=$1 and entry_type='refund_paid'`,
            [o.order],
          )
        ).rows[0].n,
      ).toBe(0)
      expect(
        (
          await callFails(
            c,
            AAL2(o.cust),
            `select public.customer_request_refund($1,null,'once more please',$2)`,
            [o.order, 'k-while-unknown-1'],
          )
        ).message,
      ).toMatch(/nothing_to_refund/)
      expect(
        (
          await c.query(
            `select count(*)::int n from public.reconciliation_flags where order_id=$1 and reason='refund_outcome_unknown' and resolved_at is null`,
            [o.order],
          )
        ).rows[0].n,
      ).toBe(1)
      // resolution needs a reason, a provider reference for success, and finance
      expect(
        (
          await callFails(
            c,
            AAL2(fin2),
            `select public.refund_reconcile($1,'succeeded',null,'checked the dashboard')`,
            [r.id],
          )
        ).message,
      ).toMatch(/provider_reference_required/)
      const res = await callJson(
        c,
        AAL2(fin2),
        `select public.refund_reconcile($1,'succeeded','fake_re_late','checked the dashboard') r`,
        [r.id],
      )
      expect(res).toMatchObject({ ok: true, status: 'succeeded' })
      expect(
        (
          await c.query(
            `select count(*)::int n from public.reconciliation_flags where order_id=$1 and reason='refund_outcome_unknown' and resolved_at is null`,
            [o.order],
          )
        ).rows[0].n,
      ).toBe(0)
      // a contradictory late event does not rewrite history; it raises a flag
      const c2 = await outcome(c, fin2, r.id, 'failed', null)
      expect(c2).toMatchObject({ ok: false, conflict: true })
      expect((await refundRow(c, r.id)).status).toBe('succeeded')
      expect(
        (
          await c.query(
            `select count(*)::int n from public.reconciliation_flags where order_id=$1 and reason='refund_outcome_conflict'`,
            [o.order],
          )
        ).rows[0].n,
      ).toBe(1)
    })
  })

  it('the provider-event path is service-role only, and a provider reference can belong to one refund only', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const fin2 = await staff(c, 'finance_admin')
      const r = await requestRefund(c, o.cust, o.order, null)
      await approve(c, fin, r.id)
      await startFake(c, fin2, r.id)
      for (const who of [AAL2(fin2), AAL2(o.cust), null]) {
        const e = await as(c, who, () =>
          failure(c, `select public.refund_provider_outcome($1,'succeeded','x_ref_1','evt')`, [
            r.id,
          ]),
        )
        expect(['42501', '28000']).toContain(e.code)
      }
      await c.query('set local role service_role')
      await c.query(`select public.refund_provider_outcome($1,'succeeded','fake_re_dup','evt')`, [
        r.id,
      ])
      await c.query('reset role')
      const o2 = await paidOrder(c)
      const r2 = await requestRefund(c, o2.cust, o2.order, null)
      await approve(c, fin, r2.id)
      await startFake(c, fin2, r2.id)
      const e = await callFails(
        c,
        AAL2(fin2),
        `select public.refund_record_outcome($1,'succeeded','fake_re_dup','evt')`,
        [r2.id],
      )
      expect(e.message).toMatch(/refunds_provider_ref_uq|duplicate key/)
    })
  })
})

describe('the database itself backs the money rules (even when the functions are bypassed)', () => {
  it('cumulative refunds above the ledger are refused by the trigger, whoever inserts them', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const ins = (amt: number) =>
        failure(
          c,
          `insert into public.refunds (order_id, amount_kobo, reason, requested_by, source) values ($1,$2,'direct insert','${o.cust}','finance')`,
          [o.order, amt],
        )
      expect((await ins(o.received + 1)).message).toMatch(/refund_exceeds_received/)
      await c.query(
        `insert into public.refunds (order_id, amount_kobo, reason, requested_by, source) values ($1,$2,'direct insert',$3,'finance')`,
        [o.order, o.received - 10, o.cust],
      )
      expect((await ins(11)).message).toMatch(/refund_exceeds_received/)
      await c.query(
        `insert into public.refunds (order_id, amount_kobo, reason, requested_by, source) values ($1,10,'direct insert',$2,'finance')`,
        [o.order, o.cust],
      )
    })
  })

  it('illegal state jumps and edits to the amount or order are refused even for the table owner', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const r = await requestRefund(c, o.cust, o.order, null)
      for (const to of ['approved_x', 'succeeded', 'processing', 'failed']) {
        const e = await failure(c, `update public.refunds set status=$2 where id=$1`, [r.id, to])
        expect(e.message, to).toMatch(
          /refund_invalid_transition|refunds_status_check|refunds_success_has_ref|violates check/,
        )
      }
      expect(
        (await failure(c, `update public.refunds set amount_kobo=1 where id=$1`, [r.id])).message,
      ).toMatch(/refund_core_immutable/)
      expect(
        (
          await failure(c, `update public.refunds set order_id=$2 where id=$1`, [
            r.id,
            (await paidOrder(c)).order,
          ])
        ).message,
      ).toMatch(/refund_core_immutable/)
      expect(
        (await failure(c, `delete from public.refund_events where refund_id=$1`, [r.id])).message,
      ).toMatch(/append-only/)
    })
  })

  it('a terminal refund cannot be reopened', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const r = await requestRefund(c, o.cust, o.order, null)
      await callJson(
        c,
        AAL2(fin),
        `select public.refund_decide($1,'reject','Not eligible at all') r`,
        [r.id],
      )
      for (const to of ['requested', 'approved', 'under_review']) {
        expect(
          (await failure(c, `update public.refunds set status=$2 where id=$1`, [r.id, to])).message,
        ).toMatch(/refund_invalid_transition/)
      }
    })
  })
})

describe('who can read refunds', () => {
  it('customers see only their own; shops, riders and strangers none; events and internal notes are staff-only', async () => {
    await withTx(async (c) => {
      const a = await paidOrder(c)
      const b = await paidOrder(c)
      const ra = await requestRefund(c, a.cust, a.order, null)
      await requestRefund(c, b.cust, b.order, null)
      const count = (who: Parameters<typeof as>[1], table: string) =>
        as(c, who, async () => (await c.query(`select 1 from public.${table}`)).rowCount)
      expect(await count(AAL2(a.cust), 'refunds')).toBe(1)
      expect(await count(AAL2(b.cust), 'refunds')).toBe(1)
      expect(await count(AAL2(a.owner), 'refunds')).toBe(0)
      const rid = await createUser(c, 'rider')
      await giveRole(c, rid, 'rider')
      expect(await count(rider(rid), 'refunds')).toBe(0)
      expect(await count(AAL2(a.cust), 'refund_events')).toBe(0)
      const sup = await staff(c, 'support_agent')
      const fin = await staff(c, 'finance_admin')
      expect(await count(AAL2(sup), 'refund_events')).toBeGreaterThanOrEqual(2)
      expect(await count(AAL2(fin), 'refund_events')).toBeGreaterThanOrEqual(2)
      expect(await count(AAL1(fin), 'refunds')).toBe(0)
      // the customer's own view function agrees and does not leak staff-only fields
      const view = await callJson(c, AAL2(a.cust), `select public.my_order_refunds($1) r`, [
        a.order,
      ])
      expect(view.refunds).toHaveLength(1)
      expect(JSON.stringify(view)).not.toMatch(/requested_by|executed_by|decided_by/)
      expect(
        (await callFails(c, AAL2(b.cust), `select public.my_order_refunds($1)`, [a.order])).code,
      ).toBe(PRIV_DENIED)
      // staff queue
      const q = await callJson(c, AAL2(sup), `select public.staff_list_refunds('requested') r`)
      expect(q.some((x: { id: string }) => x.id === ra.id)).toBe(true)
      expect((await callFails(c, AAL2(a.cust), `select public.staff_list_refunds()`)).code).toBe(
        PRIV_DENIED,
      )
    })
  })
})
