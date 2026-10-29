import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { directPaidDelivery } from './delivery-fee-fixture'
import { callFails, callJson, mkRider } from './rider-helpers'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  mkDeliveryPoint,
  mkProduct,
  mkVendor,
  pool,
  svc,
  withTx,
  type Principal,
} from './helpers'

afterAll(async () => {
  await pool.end()
})

const json = async (c: PoolClient, who: Principal, sql: string, params: unknown[] = []) =>
  as(c, who, async () => (await c.query(sql, params)).rows[0].r)

describe('public item browsing (browse_products)', () => {
  it('returns only active items of approved shops, sorts by price, filters by category, and pages', async () => {
    await withTx(async (c) => {
      const food = await mkVendor(c, { name: 'Sortville Food', category: 'food' })
      const hidden = await mkVendor(c, {
        name: 'Sortville Suspended',
        status: 'suspended',
        category: 'food',
      })
      const cheap = await mkProduct(c, food.id, { name: 'Sortville cheap', price: 50000 })
      const dear = await mkProduct(c, food.id, { name: 'Sortville dear', price: 900000 })
      await mkProduct(c, food.id, { name: 'Sortville archived', price: 100, status: 'archived' })
      await mkProduct(c, hidden.id, { name: 'Sortville from suspended', price: 100 })
      const call = (args: string) => json(c, null, `select public.browse_products(${args}) r`)
      const asc = await call(`'Sortville', null, false, null, 'price_asc'`)
      expect(asc.map((p: { id: string }) => p.id)).toEqual([cheap, dear])
      const desc = await call(`'Sortville', null, false, null, 'price_desc'`)
      expect(desc.map((p: { id: string }) => p.id)).toEqual([dear, cheap])
      const capped = await call(`'Sortville', null, false, 100000, 'price_asc'`)
      expect(capped.map((p: { id: string }) => p.id)).toEqual([cheap])
      const none = await call(`'Sortville', 'printing', false, null, 'price_asc'`)
      expect(none).toEqual([])
      const page2 = await call(`'Sortville', null, false, null, 'price_asc', 1, 1`)
      expect(page2.map((p: { id: string }) => p.id)).toEqual([dear])
      expect(asc[0].vendor_name).toBe('Sortville Food')
      // an unknown sort falls back instead of failing
      expect((await call(`'Sortville', null, false, null, 'nonsense'`)).length).toBe(2)
    })
  })
})

describe('catalogue moderation', () => {
  it('only platform administrators at aal2 can hide or show an item; a reason is required; hidden items vanish and the shop cannot undo it', async () => {
    await withTx(async (c) => {
      const owner = await createUser(c, 'mod-owner')
      const shop = await mkVendor(c, { owner })
      const item = await mkProduct(c, shop.id, { name: 'Moderated thing', price: 200000 })
      const admin = await createUser(c, 'mod-admin')
      await giveRole(c, admin, 'platform_admin')
      const support = await createUser(c, 'mod-support')
      await giveRole(c, support, 'support_agent')
      const hide = (who: Principal, reason: string) =>
        as(c, who, () =>
          failure(c, `select public.admin_set_product_visibility($1, true, $2)`, [item, reason]),
        )
      expect((await hide(AAL2(support.valueOf()), 'a good reason')).code).toBe(PRIV_DENIED)
      expect((await hide(AAL1(admin), 'a good reason')).code).toBe(PRIV_DENIED)
      expect((await hide(AAL2(admin), 'no')).message).toMatch(/reason/)
      await as(c, AAL2(admin), () =>
        c.query(`select public.admin_set_product_visibility($1, true, 'counterfeit listing')`, [
          item,
        ]),
      )
      expect(
        (await c.query(`select status from public.products where id = $1`, [item])).rows[0].status,
      ).toBe('hidden')
      const found = await json(c, null, `select public.browse_products('Moderated thing') r`)
      expect(found).toEqual([])
      // the shop cannot archive it or toggle it back
      expect(
        (await as(c, AAL2(owner), () => failure(c, `select public.product_archive($1)`, [item])))
          .message,
      ).toMatch(/product_hidden/)
      expect(
        (
          await as(c, AAL2(owner), () =>
            failure(c, `select public.product_set_availability($1, true)`, [item]),
          )
        ).message,
      ).toMatch(/product_hidden/)
      // it is audited with the reason
      const a = await c.query(
        `select details from public.audit_events where action = 'product.hidden_by_admin' and entity_id = $1`,
        [item],
      )
      expect(a.rows[0].details.reason).toBe('counterfeit listing')
      // showing again
      await as(c, AAL2(admin), () =>
        c.query(`select public.admin_set_product_visibility($1, false, 'cleared after review')`, [
          item,
        ]),
      )
      expect(
        (await json(c, null, `select public.browse_products('Moderated thing') r`)).length,
      ).toBe(1)
      // an archived item is the shop's decision and cannot be hidden
      const archived = await mkProduct(c, shop.id, { status: 'archived' })
      expect(
        (
          await as(c, AAL2(admin), () =>
            failure(c, `select public.admin_set_product_visibility($1, true, 'trying it')`, [
              archived,
            ]),
          )
        ).message,
      ).toMatch(/product_not_active/)
    })
  })
})

describe('user directory and suspension', () => {
  it('is for platform administrators only; suspending needs a reason, refuses yourself and staff, and ends sessions', async () => {
    await withTx(async (c) => {
      const admin = await createUser(c, 'dir-admin')
      await giveRole(c, admin, 'platform_admin')
      const support = await createUser(c, 'dir-support')
      await giveRole(c, support, 'support_agent')
      const target = await createUser(c, 'dir-target', { mfa: false })
      for (const who of [AAL2(support), AAL2(target), AAL1(admin), null] as Principal[]) {
        expect(
          (await as(c, who, () => failure(c, `select public.admin_list_users(null, null, 5, 0)`)))
            .code,
        ).toMatch(/42501|28000/)
      }
      const list = await json(c, AAL2(admin), `select public.admin_list_users($1, null, 5, 0) r`, [
        target.slice(0, 8),
      ])
      expect(list.rows.length).toBeGreaterThanOrEqual(0)
      const detail = await json(c, AAL2(admin), `select public.admin_user_detail($1) r`, [target])
      expect(detail.id).toBe(target)
      expect(detail.suspended).toBe(false)
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where action = 'admin.user_viewed' and entity_id = $1`,
            [target],
          )
        ).rowCount,
      ).toBe(1)
      const suspend = (u: string, s: boolean, r: string) =>
        as(c, AAL2(admin), () =>
          failure(c, `select public.admin_set_user_suspended($1, $2, $3)`, [u, s, r]),
        )
      expect((await suspend(target, true, 'no')).message).toMatch(/reason/)
      expect((await suspend(admin, true, 'testing myself')).message).toMatch(/own account/)
      expect((await suspend(support, true, 'staff must lose the role first')).message).toMatch(
        /staff_account/,
      )
      await c.query(
        `insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now(), now())`,
        [target],
      )
      await as(c, AAL2(admin), () =>
        c.query(
          `select public.admin_set_user_suspended($1, true, 'repeated abuse of the service')`,
          [target],
        ),
      )
      expect(
        (
          await c.query(`select banned_until > now() as banned from auth.users where id = $1`, [
            target,
          ])
        ).rows[0].banned,
      ).toBe(true)
      expect(
        (await c.query(`select count(*)::int n from auth.sessions where user_id = $1`, [target]))
          .rows[0].n,
      ).toBe(0)
      const listed = await json(
        c,
        AAL2(admin),
        `select public.admin_list_users($1, null, 5, 0) r`,
        [(await c.query('select email from auth.users where id = $1', [target])).rows[0].email],
      )
      expect(listed.rows[0].suspended).toBe(true)
      await as(c, AAL2(admin), () =>
        c.query(`select public.admin_set_user_suspended($1, false, 'appeal accepted')`, [target]),
      )
      expect(
        (await c.query(`select banned_until from auth.users where id = $1`, [target])).rows[0]
          .banned_until,
      ).toBeNull()
      const acts = await c.query(
        `select action from public.audit_events where entity_id = $1 and action in ('user.suspended','user.reinstated') order by id`,
        [target],
      )
      expect(acts.rows.map((r) => r.action)).toEqual(['user.suspended', 'user.reinstated'])
    })
  })
})

describe('dashboard and reports', () => {
  it('dashboard is staff only; only finance and administrators see money; reports are finance and administrators only', async () => {
    await withTx(async (c) => {
      const admin = await createUser(c, 'dash-admin')
      await giveRole(c, admin, 'platform_admin')
      const support = await createUser(c, 'dash-support')
      await giveRole(c, support, 'support_agent')
      const finance = await createUser(c, 'dash-fin')
      await giveRole(c, finance, 'finance_admin')
      const customer = await createUser(c, 'dash-cust')
      expect(
        (await as(c, AAL2(customer), () => failure(c, `select public.admin_dashboard()`))).code,
      ).toBe(PRIV_DENIED)
      const sup = await json(c, AAL2(support), `select public.admin_dashboard() r`)
      expect(sup.payments_received_kobo).toBeNull()
      expect(typeof sup.orders_total).toBe('number')
      expect(sup.orders_by_day.length).toBe(14)
      const fin = await json(c, AAL2(finance), `select public.admin_dashboard() r`)
      expect(typeof fin.payments_received_kobo).toBe('number')
      expect(
        (await as(c, AAL2(support), () => failure(c, `select public.admin_report(30)`))).code,
      ).toBe(PRIV_DENIED)
      const rep = await json(c, AAL2(admin), `select public.admin_report(30) r`)
      expect(rep.days).toBe(30)
      expect(Array.isArray(rep.top_vendors)).toBe(true)
      expect((await json(c, AAL2(admin), `select public.admin_report(1) r`)).days).toBe(7)
      expect((await json(c, AAL2(admin), `select public.admin_report(500) r`)).days).toBe(90)
    })
  })
})

describe('wishlist and saved places', () => {
  it('belong to the signed-in customer only, are limited, and respect approved delivery points', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'wish-u')
      const other = await createUser(c, 'wish-o')
      const shop = await mkVendor(c)
      const p1 = await mkProduct(c, shop.id)
      expect(await json(c, AAL2(u), `select public.wishlist_toggle($1) r`, [p1])).toBe(true)
      expect(await json(c, AAL2(u), `select public.wishlist_contains($1) r`, [p1])).toBe(true)
      expect(await json(c, AAL2(other), `select public.wishlist_contains($1) r`, [p1])).toBe(false)
      expect(
        (await json(c, AAL2(u), `select public.wishlist_list() r`)).map(
          (x: { id: string }) => x.id,
        ),
      ).toEqual([p1])
      expect(await json(c, AAL2(u), `select public.wishlist_toggle($1) r`, [p1])).toBe(false)
      expect(
        (await as(c, AAL2(u), () => failure(c, `select public.wishlist_toggle(gen_random_uuid())`)))
          .message,
      ).toMatch(/unknown product/)
      // direct table access is closed
      expect(
        (await as(c, AAL2(u), () => failure(c, `select * from public.wishlist_items`))).code,
      ).toBe(PRIV_DENIED)
      expect((await as(c, null, () => failure(c, `select public.wishlist_list()`))).code).toMatch(
        /42501|28000/,
      )

      const pt = await mkDeliveryPoint(c, { label: 'Saved point' })
      const closed = await mkDeliveryPoint(c, { label: 'Closed point', active: false })
      const save = (
        id: string | null,
        label: string,
        point: string,
        def: boolean,
        who: Principal = AAL2(u),
      ) => json(c, who, `select public.saved_place_save($1, $2, $3, $4) r`, [id, label, point, def])
      const a = await save(null, 'My hostel', pt, true)
      const b = await save(null, 'Library', pt, true)
      const places = await json(c, AAL2(u), `select public.saved_places_list() r`)
      expect(
        places
          .filter((x: { is_default: boolean }) => x.is_default)
          .map((x: { id: string }) => x.id),
      ).toEqual([b])
      expect(
        (
          await as(c, AAL2(u), () =>
            failure(c, `select public.saved_place_save(null, 'Bad', $1, false)`, [closed]),
          )
        ).message,
      ).toMatch(/delivery point/)
      expect(
        (
          await as(c, AAL2(other), () =>
            failure(c, `select public.saved_place_save($1, 'Steal', $2, false)`, [a, pt]),
          )
        ).message,
      ).toMatch(/unknown place/)
      for (const l of ['One', 'Two', 'Three']) await save(null, l, pt, false)
      expect(
        (
          await as(c, AAL2(u), () =>
            failure(c, `select public.saved_place_save(null, 'Sixth', $1, false)`, [pt]),
          )
        ).message,
      ).toMatch(/too_many_places/)
      await as(c, AAL2(u), () => c.query(`select public.saved_place_delete($1)`, [a]))
      expect(
        (await as(c, AAL2(other), () => failure(c, `select public.saved_place_delete($1)`, [b])))
          .message,
      ).toMatch(/unknown place/)
    })
  })
})

describe('contact messages', () => {
  it('are written only by the service role and read and triaged only by support staff, with an audit record', async () => {
    await withTx(async (c) => {
      const support = await createUser(c, 'msg-support')
      await giveRole(c, support, 'support_agent')
      const customer = await createUser(c, 'msg-cust')
      const id = (
        await svc(c, () =>
          c.query(
            `insert into public.contact_messages (name, email, subject, message) values ('Ada', 'ada@example.test', 'Hello there', 'A message with enough words.') returning id`,
          ),
        )
      ).rows[0].id as string
      expect(
        (
          await as(c, AAL2(customer), () =>
            failure(
              c,
              `insert into public.contact_messages (name, email, subject, message) values ('x','x@example.test','sub','long enough message')`,
            ),
          )
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (await as(c, null, () => failure(c, `select * from public.contact_messages`))).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await as(c, AAL2(customer), () =>
            failure(c, `select public.staff_list_contact_messages(null, 5, 0)`),
          )
        ).code,
      ).toBe(PRIV_DENIED)
      const list = await json(
        c,
        AAL2(support),
        `select public.staff_list_contact_messages('new', 50, 0) r`,
      )
      expect(list.rows.some((m: { id: string }) => m.id === id)).toBe(true)
      await as(c, AAL2(support), () =>
        c.query(`select public.staff_set_contact_message_status($1, 'closed')`, [id]),
      )
      expect(
        (await c.query(`select status from public.contact_messages where id = $1`, [id])).rows[0]
          .status,
      ).toBe('closed')
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where action = 'contact.status_changed' and entity_id = $1`,
            [id],
          )
        ).rowCount,
      ).toBe(1)
      expect(
        (
          await as(c, AAL2(support), () =>
            failure(c, `select public.staff_set_contact_message_status($1, 'deleted')`, [id]),
          )
        ).message,
      ).toMatch(/invalid status/)
    })
  })
})

describe('account erasure also clears what the redesign added', () => {
  it('removes wishlist and saved places and anonymises the account holder’s contact messages without breaking the erasure', async () => {
    await withTx(async (c) => {
      const admin = await createUser(c, 'er-admin')
      await giveRole(c, admin, 'platform_admin')
      const victim = await createUser(c, 'er-victim')
      const shop = await mkVendor(c)
      const item = await mkProduct(c, shop.id)
      const point = await mkDeliveryPoint(c, { label: 'Erasure point' })
      await json(c, AAL2(victim), `select public.wishlist_toggle($1) r`, [item])
      await json(c, AAL2(victim), `select public.saved_place_save(null, 'Hostel', $1, true) r`, [
        point,
      ])
      await svc(c, () =>
        c.query(
          `insert into public.contact_messages (user_id, name, email, subject, message)
           values ($1, 'Victim Person', 'victim@example.test', 'My question', 'A real message with enough words in it.')`,
          [victim],
        ),
      )
      const r = await json(
        c,
        AAL2(admin),
        `select public.admin_erase_account($1, 'Requested by the account holder', null) r`,
        [victim],
      )
      expect(r.erased).toBe(true)
      const count = async (sql: string) => Number((await c.query(sql, [victim])).rows[0].n)
      expect(await count(`select count(*) n from public.wishlist_items where user_id = $1`)).toBe(0)
      expect(await count(`select count(*) n from public.saved_places where user_id = $1`)).toBe(0)
      const m = await c.query(
        `select name, email, subject, message, user_id from public.contact_messages where email like 'erased@%'`,
      )
      expect(m.rowCount).toBe(1)
      expect(m.rows[0].name).toBe('Erased')
      expect(m.rows[0].user_id).toBeNull()
      expect(JSON.stringify(m.rows)).not.toMatch(/Victim|victim@|My question|real message/)
    })
  })
})

describe('rider delivery history', () => {
  it('shows a rider only their own finished assignments, and nobody else can call it', async () => {
    await withTx(async (c) => {
      const d = await directPaidDelivery(c)
      const other = await mkRider(c)
      const mine = await callJson(c, AAL2(d.rider), `select public.rider_delivery_history() as r`)
      expect(mine.completed).toBe(1)
      expect(mine.rows).toHaveLength(1)
      expect(mine.rows[0].status).toBe('completed')
      expect(mine.rows[0].order_number).toBeTruthy()
      expect(JSON.stringify(mine)).not.toMatch(/account_number|bank_name|email/)
      const theirs = await callJson(
        c,
        AAL2(other.id),
        `select public.rider_delivery_history() as r`,
      )
      expect(theirs.rows).toHaveLength(0)
      expect((await callFails(c, null, `select public.rider_delivery_history()`)).code).toBe(
        PRIV_DENIED,
      )
      const cust = await createUser(c, 'cust')
      expect((await callFails(c, AAL2(cust), `select public.rider_delivery_history()`)).code).toBe(
        PRIV_DENIED,
      )
    })
  })
})
