import { afterAll, describe, expect, it } from 'vitest'
import { AAL1, AAL2, PRIV_DENIED, as, createUser, failure, giveRole, pool, withTx } from './helpers'
import { approve, callFails, callJson, orderStatusOf, paidOrder, staff } from './refund-helpers'
import { countRows } from './notif-helpers'

afterAll(async () => {
  await pool.end()
})

const review = (
  c: Parameters<typeof callJson>[0],
  cust: string,
  order: string,
  rating = 5,
  comment: string | null = 'Lovely food, quick service',
) =>
  callJson(c, AAL2(cust), `select public.create_review($1,$2,$3) r`, [
    order,
    rating,
    comment,
  ]) as Promise<{ id: string }>
const pub = async (c: Parameters<typeof callJson>[0], vendorId: string, limit = 10, offset = 0) => {
  const slug = (await c.query(`select slug from public.vendors where id=$1`, [vendorId])).rows[0]
    .slug as string
  return as(
    c,
    null,
    async () =>
      (await c.query(`select public.get_vendor_reviews($1,$2,$3) r`, [slug, limit, offset])).rows[0]
        .r,
  ) as Promise<{
    count: number
    average_tenths: number | null
    reviews: { id: string; rating: number; comment: string | null }[]
  } | null>
}

describe('who can review, and when', () => {
  it('only the customer of a FINISHED order; cancelled, unfinished, disputed and refunded orders are not eligible', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c) // COMPLETED
      const probe = await callJson(c, AAL2(o.cust), `select public.my_order_review($1) r`, [
        o.order,
      ])
      expect(probe).toEqual({ can_review: true })
      for (const status of ['PAID', 'PREPARING', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'EN_ROUTE']) {
        await c.query(`update public.orders set status=$2 where id=$1`, [o.order, status])
        expect(
          (await callFails(c, AAL2(o.cust), `select public.create_review($1,5,'Fine')`, [o.order]))
            .message,
          status,
        ).toMatch(/review_not_eligible/)
        expect(
          (await callJson(c, AAL2(o.cust), `select public.my_order_review($1) r`, [o.order]))
            .can_review,
          status,
        ).toBe(false)
      }
      await c.query(`update public.orders set status='PARTIALLY_REFUNDED' where id=$1`, [o.order])
      expect((await review(c, o.cust, o.order)).id).toBeTruthy() // a partly refunded order was still completed
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.audit_events where action='review.created' and entity_id=$1`,
          [o.order],
        ),
      ).toBe(1)
    })
  })

  it("strangers, the shop, support, aal1 and anonymous callers cannot review someone else's order; a shop member cannot review its own shop", async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const stranger = await createUser(c, 'stranger')
      const sup = await staff(c, 'support_agent')
      for (const who of [AAL2(stranger), AAL2(o.owner), AAL2(sup), AAL1(o.cust), null]) {
        const e = await as(c, who, () =>
          failure(c, `select public.create_review($1,5,'Nice')`, [o.order]),
        )
        expect(['42501', '28000']).toContain(e.code)
      }
      // the customer is also a member of the shop (self-review)
      await c.query(
        `insert into public.vendor_staff (vendor_id, user_id, staff_role) values ($1,$2,'staff')`,
        [o.vendor, o.cust],
      )
      expect(
        (await callFails(c, AAL2(o.cust), `select public.create_review($1,5,'Nice')`, [o.order]))
          .message,
      ).toMatch(/review_own_shop/)
      expect(await countRows(c, `select count(*)::int n from public.reviews`)).toBe(0)
    })
  })

  it('ratings and comments are validated; control characters are stripped; a blank comment is stored as none', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      for (const rating of [0, 6, -1]) {
        expect(
          (
            await callFails(c, AAL2(o.cust), `select public.create_review($1,$2,'Nice')`, [
              o.order,
              rating,
            ])
          ).message,
        ).toMatch(/review_invalid_rating/)
      }
      for (const comment of ['ab', 'x'.repeat(501)]) {
        expect(
          (
            await callFails(c, AAL2(o.cust), `select public.create_review($1,4,$2)`, [
              o.order,
              comment,
            ])
          ).message,
        ).toMatch(/review_invalid_comment/)
      }
      await review(c, o.cust, o.order, 4, '   \u0007Great\u001b value   ')
      const row = (
        await c.query(`select rating, comment from public.reviews where order_id=$1`, [o.order])
      ).rows[0]
      expect(row).toEqual({ rating: 4, comment: 'Great value' })
      const o2 = await paidOrder(c)
      await review(c, o2.cust, o2.order, 3, '   ')
      expect(
        (await c.query(`select comment from public.reviews where order_id=$1`, [o2.order])).rows[0]
          .comment,
      ).toBeNull()
    })
  })

  it('one review per order; the review itself is immutable and cannot be deleted by anyone', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await review(c, o.cust, o.order)
      expect(
        (
          await callFails(c, AAL2(o.cust), `select public.create_review($1,1,'Changed my mind')`, [
            o.order,
          ])
        ).message,
      ).toMatch(/review_exists/)
      expect(
        (await callJson(c, AAL2(o.cust), `select public.my_order_review($1) r`, [o.order])).reason,
      ).toBe('already_reviewed')
      expect((await failure(c, `update public.reviews set rating=1`)).message).toMatch(
        /review_immutable/,
      )
      expect((await failure(c, `update public.reviews set comment='edited'`)).message).toMatch(
        /review_immutable/,
      )
      expect((await failure(c, `delete from public.reviews`)).message).toMatch(/append-only/)
      for (const sql of [
        `update public.reviews set rating=1`,
        `delete from public.reviews`,
        `insert into public.reviews (order_id,vendor_id,customer_id,rating) values (gen_random_uuid(),gen_random_uuid(),'${o.cust}',5)`,
      ]) {
        expect((await as(c, AAL2(o.cust), () => failure(c, sql))).code).toBe(PRIV_DENIED)
      }
    })
  })

  it('a customer is limited to 10 reviews a day', async () => {
    await withTx(async (c) => {
      const first = await paidOrder(c)
      const cust = first.cust
      for (let i = 0; i < 10; i++) {
        const o = i === 0 ? first : await paidOrder(c)
        if (i > 0)
          await c.query(`update public.orders set customer_id=$1 where id=$2`, [cust, o.order])
        await review(c, cust, o.order, 5, null)
      }
      const o11 = await paidOrder(c)
      await c.query(`update public.orders set customer_id=$1 where id=$2`, [cust, o11.order])
      expect(
        (
          await callFails(c, AAL2(cust), `select public.create_review($1,5,'Another one')`, [
            o11.order,
          ])
        ).message,
      ).toMatch(/too_many_reviews/)
    })
  })
})

describe('what the public sees', () => {
  it('published reviews and an average computed from them; no customer, no order, no hidden reviews; bounded pages', async () => {
    await withTx(async (c) => {
      const a = await paidOrder(c)
      await review(c, a.cust, a.order, 5, 'Excellent')
      // same shop, more customers
      const ratings = [4, 4]
      const ids: string[] = []
      for (const r of ratings) {
        const cust = await createUser(c, 'cust')
        await c.query(
          `insert into public.orders (order_number, customer_id, vendor_id, vendor_name, fulfilment, status, items_total_kobo, delivery_fee_kobo, platform_fee_kobo, total_kobo, idempotency_key, pickup_location_snapshot)
                       values ($1,$2,$3,'x','pickup','COMPLETED',100000,0,0,100000,$4,'Counter')`,
          [
            `AFM-R${Math.random().toString(36).slice(2, 8)}`,
            cust,
            a.vendor,
            `idem-${Math.random().toString(36).slice(2)}-${r}`,
          ],
        )
        const order = (await c.query(`select id from public.orders where customer_id=$1`, [cust]))
          .rows[0].id as string
        ids.push((await review(c, cust, order, r, `Rated ${r}`)).id)
      }
      const view = (await pub(c, a.vendor))!
      expect(view.count).toBe(3)
      expect(view.average_tenths).toBe(43) // (5+4+4)/3 = 4.33 -> 4.3
      const text = JSON.stringify(view)
      expect(text).not.toMatch(/customer_id|order_id|user|email|vendor_id/i)
      expect(view.reviews).toHaveLength(3)
      // a hidden review leaves the public view and the average
      const sup = await staff(c, 'support_agent')
      const reporter = await createUser(c, 'reporter')
      await callJson(c, AAL2(reporter), `select public.report_review($1,'abusive','rude') r`, [
        ids[0],
      ])
      const rep = (
        await c.query(`select id from public.review_reports where review_id=$1`, [ids[0]])
      ).rows[0].id as string
      await callJson(
        c,
        AAL2(sup),
        `select public.moderate_review_report($1,'hide','Abusive language in the comment') r`,
        [rep],
      )
      const after = (await pub(c, a.vendor))!
      expect(after.count).toBe(2)
      expect(after.average_tenths).toBe(45)
      expect(after.reviews.some((r) => r.id === ids[0])).toBe(false)
      // pages are bounded and unknown vendors give nothing
      expect((await pub(c, a.vendor, 1000, 0))!.reviews.length).toBeLessThanOrEqual(50)
      expect((await pub(c, a.vendor, 1, 1))!.reviews).toHaveLength(1)
      expect((await pub(c, a.vendor, 5, 99))!.reviews).toHaveLength(0)
      const none = await as(
        c,
        null,
        async () => (await c.query(`select public.get_vendor_reviews('no-such-shop') r`)).rows[0].r,
      )
      expect(none).toBeNull()
    })
  })

  it('direct reads of the table: the author and staff only (shops and strangers use the public function)', async () => {
    await withTx(async (c) => {
      const a = await paidOrder(c)
      await review(c, a.cust, a.order)
      const other = await createUser(c, 'o')
      const sup = await staff(c, 'support_agent')
      const fin = await staff(c, 'finance_admin')
      const n = (who: Parameters<typeof as>[1]) =>
        as(c, who, async () => (await c.query(`select 1 from public.reviews`)).rowCount)
      expect(await n(AAL2(a.cust))).toBe(1)
      expect(await n(AAL2(sup))).toBe(1)
      expect(await n(AAL2(a.owner))).toBe(0)
      expect(await n(AAL2(other))).toBe(0)
      expect(await n(AAL2(fin))).toBe(0)
      expect(await n(AAL1(sup))).toBe(0)
    })
  })
})

describe('reports and moderation', () => {
  it('anyone signed in can report once; not their own review; reasons are checked; limited per day', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const rv = await review(c, o.cust, o.order)
      const a = await createUser(c, 'a')
      expect(
        (await callFails(c, AAL2(o.cust), `select public.report_review($1,'spam')`, [rv.id]))
          .message,
      ).toMatch(/review_own_report/)
      expect(
        (await callFails(c, AAL2(a), `select public.report_review($1,'bogus')`, [rv.id])).message,
      ).toMatch(/invalid_reason/)
      expect(
        (await callFails(c, AAL2(a), `select public.report_review(gen_random_uuid(),'spam')`))
          .message,
      ).toMatch(/review_not_found/)
      await callJson(
        c,
        AAL2(a),
        `select public.report_review($1,'spam','looks like an advert') r`,
        [rv.id],
      )
      expect(
        (await callFails(c, AAL2(a), `select public.report_review($1,'spam')`, [rv.id])).message,
      ).toMatch(/report_exists/)
      for (const who of [AAL1(a), null]) {
        const e = await as(c, who, () =>
          failure(c, `select public.report_review($1,'spam')`, [rv.id]),
        )
        expect(['42501', '28000']).toContain(e.code)
      }
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.audit_events where action='review.reported'`,
        ),
      ).toBeGreaterThanOrEqual(1)
      // the daily cap
      const b = await createUser(c, 'b')
      for (let i = 0; i < 10; i++) {
        const oo = await paidOrder(c)
        const r2 = await review(c, oo.cust, oo.order)
        if (i < 10) await callJson(c, AAL2(b), `select public.report_review($1,'other') r`, [r2.id])
      }
      const oo = await paidOrder(c)
      const r3 = await review(c, oo.cust, oo.order)
      expect(
        (await callFails(c, AAL2(b), `select public.report_review($1,'other')`, [r3.id])).message,
      ).toMatch(/too_many_reports/)
    })
  })

  it('moderation: support/admin only, with a reason; hiding keeps the row and never touches the order or the money', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const rv = await review(c, o.cust, o.order, 1, 'Awful, call me on 0800')
      const reporter = await createUser(c, 'rep')
      await callJson(
        c,
        AAL2(reporter),
        `select public.report_review($1,'personal_info','phone number') r`,
        [rv.id],
      )
      const rep = (
        await c.query(`select id from public.review_reports where review_id=$1`, [rv.id])
      ).rows[0].id as string
      const sup = await staff(c, 'support_agent')
      const admin = await staff(c, 'platform_admin')
      const fin = await staff(c, 'finance_admin')
      const before = {
        status: await orderStatusOf(c, o.order),
        ledger: await countRows(
          c,
          `select count(*)::int n from public.ledger_entries where order_id=$1`,
          [o.order],
        ),
      }
      for (const who of [AAL2(o.cust), AAL2(o.owner), AAL2(reporter), AAL2(fin), AAL1(sup), null]) {
        const e = await as(c, who, () =>
          failure(
            c,
            `select public.moderate_review_report($1,'hide','This contains a phone number')`,
            [rep],
          ),
        )
        expect(['42501', '28000']).toContain(e.code)
        const e2 = await as(c, who, () => failure(c, `select public.staff_list_review_reports()`))
        expect(['42501', '28000']).toContain(e2.code)
      }
      expect(
        (
          await callFails(c, AAL2(sup), `select public.moderate_review_report($1,'hide','short')`, [
            rep,
          ])
        ).message,
      ).toMatch(/reason/)
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.moderate_review_report($1,'delete','This is not an action')`,
            [rep],
          )
        ).message,
      ).toMatch(/invalid decision/)
      const list = await callJson(c, AAL2(sup), `select public.staff_list_review_reports('open') r`)
      expect(
        list.rows.some(
          (x: { id: string; comment: string }) => x.id === rep && /Awful/.test(x.comment),
        ),
      ).toBe(true)
      await callJson(
        c,
        AAL2(sup),
        `select public.moderate_review_report($1,'hide','Contains a phone number, hidden under the rules') r`,
        [rep],
      )
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.moderate_review_report($1,'dismiss','Second attempt at the same report')`,
            [rep],
          )
        ).message,
      ).toMatch(/report_already_resolved/)
      const row = (
        await c.query(`select status, hidden_by, hidden_reason from public.reviews where id=$1`, [
          rv.id,
        ])
      ).rows[0]
      expect(row).toMatchObject({ status: 'hidden', hidden_by: sup })
      expect({
        status: await orderStatusOf(c, o.order),
        ledger: await countRows(
          c,
          `select count(*)::int n from public.ledger_entries where order_id=$1`,
          [o.order],
        ),
      }).toEqual(before)
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.audit_events where action='review.hidden' and entity_id=$1`,
          [rv.id],
        ),
      ).toBe(1)
      // only a platform admin can restore, with a reason
      expect(
        (
          await as(c, AAL2(sup), () =>
            failure(c, `select public.unhide_review($1,'Restoring after a second look')`, [rv.id]),
          )
        ).code,
      ).toBe(PRIV_DENIED)
      await callJson(
        c,
        AAL2(admin),
        `select public.unhide_review($1,'Restored after the comment was edited out') r`,
        [rv.id],
      )
      expect(
        (await c.query(`select status from public.reviews where id=$1`, [rv.id])).rows[0].status,
      ).toBe('published')
    })
  })

  it('a moderator cannot rule on their own review or their own report; dismissing leaves the review published', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      await c.query(`update public.orders set customer_id=$1 where id=$2`, [sup, o.order])
      const rv = await review(c, sup, o.order)
      const other = await createUser(c, 'other')
      await callJson(c, AAL2(other), `select public.report_review($1,'spam') r`, [rv.id])
      const rep = (
        await c.query(`select id from public.review_reports where review_id=$1`, [rv.id])
      ).rows[0].id as string
      expect(
        (
          await callFails(
            c,
            AAL2(sup),
            `select public.moderate_review_report($1,'hide','My own review, hiding it')`,
            [rep],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      const sup2 = await staff(c, 'support_agent')
      await callJson(
        c,
        AAL2(sup2),
        `select public.moderate_review_report($1,'dismiss','Report does not apply to this review') r`,
        [rep],
      )
      expect(
        (await c.query(`select status from public.reviews where id=$1`, [rv.id])).rows[0].status,
      ).toBe('published')
      expect(
        (await c.query(`select status, resolved_by from public.review_reports where id=$1`, [rep]))
          .rows[0],
      ).toMatchObject({ status: 'dismissed', resolved_by: sup2 })
    })
  })

  it('report lists are bounded and filtered; invalid filters are refused', async () => {
    await withTx(async (c) => {
      const sup = await staff(c, 'support_agent')
      expect(
        (await callFails(c, AAL2(sup), `select public.staff_list_review_reports('everything')`))
          .message,
      ).toMatch(/invalid value/)
      const r = await callJson(
        c,
        AAL2(sup),
        `select public.staff_list_review_reports('open', 100000, -4) r`,
      )
      expect(r.rows.length).toBeLessThanOrEqual(100)
      expect(typeof r.total).toBe('number')
      expect(giveRole).toBeDefined()
      void approve
    })
  })
})
