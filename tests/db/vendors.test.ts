import { afterAll, describe, expect, it } from 'vitest'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  mkProduct,
  mkVendor,
  pool,
  removeCustomerRole,
  withTx,
} from './helpers'
import type { PoolClient } from 'pg'

afterAll(async () => {
  await pool.end()
})

const category = async (c: PoolClient) =>
  (await c.query(`select id from public.categories where slug='food'`)).rows[0].id as string
const APPLY = `select public.submit_vendor_application('Mama Test Kitchen','08012345678',$1,'Home-style meals for the campus community','Sample pickup point (placeholder)',true) as id`

describe('vendor application lifecycle', () => {
  it('registered customer at aal2 can apply; aal1, non-customers, duplicates, missing terms and bad categories are refused', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      const cat = await category(c)
      const e1 = await as(c, AAL1(u), () => failure(c, APPLY, [cat]))
      expect(e1.message).toMatch(/aal2/)
      const e0 = await as(c, null, () => failure(c, APPLY, [cat]))
      expect(e0.code).toBe(PRIV_DENIED)
      const id = await as(c, AAL2(u), async () => (await c.query(APPLY, [cat])).rows[0].id)
      expect(id).toBeTruthy()
      const dup = await as(c, AAL2(u), () => failure(c, APPLY, [cat]))
      expect(dup.message).toMatch(/application_pending/)
      const terms = await createUser(c)
      const e2 = await as(c, AAL2(terms), () =>
        failure(
          c,
          `select public.submit_vendor_application('Name Here','08012345678',$1,'A description long enough','Pickup point',false)`,
          [cat],
        ),
      )
      expect(e2.message).toMatch(/terms_not_accepted/)
      const e3 = await as(c, AAL2(terms), () =>
        failure(
          c,
          `select public.submit_vendor_application('Name Here','08012345678',gen_random_uuid(),'A description long enough','Pickup point',true)`,
        ),
      )
      expect(e3.message).toMatch(/unknown_category/)
      const nocust = await createUser(c)
      await removeCustomerRole(c, nocust)
      const e4 = await as(c, AAL2(nocust), () => failure(c, APPLY, [cat]))
      expect(e4.message).toMatch(/forbidden/)
      const bad = await as(c, AAL2(terms), () =>
        failure(c, `select public.submit_vendor_application('X','abc',$1,'short','p',true)`, [cat]),
      )
      expect(bad.code).toBe('23514') // check constraint (name/phone/description lengths)
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where actor_id=$1 and action='vendor_application.submitted'`,
            [u],
          )
        ).rowCount,
      ).toBe(1)
    })
  })

  it('applicants see only their own application; admins see all; other customers see none', async () => {
    await withTx(async (c) => {
      const a = await createUser(c)
      const b = await createUser(c)
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const cat = await category(c)
      await as(c, AAL2(a), () => c.query(APPLY, [cat]))
      const totalApplications = (await c.query('select 1 from public.vendor_applications')).rowCount
      expect(
        await as(
          c,
          AAL2(a),
          async () => (await c.query('select 1 from public.vendor_applications')).rowCount,
        ),
      ).toBe(1)
      expect(
        await as(
          c,
          AAL2(b),
          async () => (await c.query('select 1 from public.vendor_applications')).rowCount,
        ),
      ).toBe(0)
      expect(
        await as(
          c,
          AAL2(admin),
          async () => (await c.query('select 1 from public.vendor_applications')).rowCount,
        ),
      ).toBe(totalApplications)
      expect(
        await as(
          c,
          AAL1(admin),
          async () => (await c.query('select 1 from public.vendor_applications')).rowCount,
        ),
      ).toBe(0)
      const w = await as(c, AAL2(a), () =>
        failure(c, `update public.vendor_applications set status='approved'`),
      )
      expect(w.code).toBe(PRIV_DENIED)
    })
  })

  it('only an aal2 platform admin can decide; approval creates vendor + owner + role + audit; self-approval and re-decision are refused', async () => {
    await withTx(async (c) => {
      const a = await createUser(c)
      const admin = await createUser(c)
      const other = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      await giveRole(c, other, 'support_agent')
      const cat = await category(c)
      const app = await as(c, AAL2(a), async () => (await c.query(APPLY, [cat])).rows[0].id)
      for (const [who, msg] of [
        [AAL2(a), /forbidden/],
        [AAL2(other), /forbidden/],
        [AAL1(admin), /aal2/],
      ] as const) {
        const e = await as(c, who, () =>
          failure(c, `select public.decide_vendor_application($1,'approve',null)`, [app]),
        )
        expect(e.message).toMatch(msg)
      }
      const anon = await as(c, null, () =>
        failure(c, `select public.decide_vendor_application($1,'approve',null)`, [app]),
      )
      expect(anon.code).toBe(PRIV_DENIED)
      const vendor = await as(
        c,
        AAL2(admin),
        async () =>
          (
            await c.query(
              `select public.decide_vendor_application($1,'approve','looks good') as v`,
              [app],
            )
          ).rows[0].v,
      )
      expect(vendor).toBeTruthy()
      const v = (
        await c.query(`select status, owner_id, slug from public.vendors where id=$1`, [vendor])
      ).rows[0]
      expect(v.status).toBe('approved')
      expect(v.owner_id).toBe(a)
      expect(v.slug).toMatch(/^mama-test-kitchen-[0-9a-f]{4}$/)
      expect(
        (
          await c.query(
            `select 1 from public.vendor_staff where vendor_id=$1 and user_id=$2 and staff_role='owner'`,
            [vendor, a],
          )
        ).rowCount,
      ).toBe(1)
      expect(
        (
          await c.query(
            `select 1 from public.role_assignments where user_id=$1 and role='vendor_owner' and status='active' and granted_by=$2`,
            [a, admin],
          )
        ).rowCount,
      ).toBe(1)
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where action='vendor_application.approved' and actor_id=$1`,
            [admin],
          )
        ).rowCount,
      ).toBe(1)
      const again = await as(c, AAL2(admin), () =>
        failure(c, `select public.decide_vendor_application($1,'reject','changed my mind')`, [app]),
      )
      expect(again.message).toMatch(/already decided/)
      // an admin cannot decide their own application
      const adminApp = await as(
        c,
        AAL2(admin),
        async () => (await c.query(APPLY, [cat])).rows[0].id,
      )
      const self = await as(c, AAL2(admin), () =>
        failure(c, `select public.decide_vendor_application($1,'approve',null)`, [adminApp]),
      )
      expect(self.message).toMatch(/your own application/)
    })
  })

  it('rejection needs a reason; the applicant stays a plain customer; a new application is then possible', async () => {
    await withTx(async (c) => {
      const a = await createUser(c)
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const cat = await category(c)
      const app = await as(c, AAL2(a), async () => (await c.query(APPLY, [cat])).rows[0].id)
      const noReason = await as(c, AAL2(admin), () =>
        failure(c, `select public.decide_vendor_application($1,'reject','')`, [app]),
      )
      expect(noReason.message).toMatch(/reason/)
      await as(c, AAL2(admin), () =>
        c.query(`select public.decide_vendor_application($1,'reject','Missing documents')`, [app]),
      )
      expect(
        (
          await c.query(
            `select 1 from public.role_assignments where user_id=$1 and role='vendor_owner'`,
            [a],
          )
        ).rowCount,
      ).toBe(0)
      expect(
        (
          await c.query(
            `select status, decision_reason from public.vendor_applications where id=$1`,
            [app],
          )
        ).rows[0],
      ).toEqual({ status: 'rejected', decision_reason: 'Missing documents' })
      await as(c, AAL2(a), () => c.query(APPLY, [cat])) // allowed again
    })
  })

  it('two approvals with the same business name get distinct slugs', async () => {
    await withTx(async (c) => {
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const cat = await category(c)
      const slugs: string[] = []
      for (let i = 0; i < 3; i++) {
        const u = await createUser(c)
        const app = await as(c, AAL2(u), async () => (await c.query(APPLY, [cat])).rows[0].id)
        const v = await as(
          c,
          AAL2(admin),
          async () =>
            (
              await c.query(`select public.decide_vendor_application($1,'approve',null) as v`, [
                app,
              ])
            ).rows[0].v,
        )
        slugs.push((await c.query(`select slug from public.vendors where id=$1`, [v])).rows[0].slug)
      }
      expect(new Set(slugs).size).toBe(3)
    })
  })
})

describe('vendor status (suspension)', () => {
  it('admin-only with a reason; a suspended vendor loses write access at once and disappears from public browse', async () => {
    await withTx(async (c) => {
      const owner = await createUser(c)
      const admin = await createUser(c)
      const cust = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const v = await mkVendor(c, { owner })
      const p = await mkProduct(c, v.id, { name: 'Visible Jollof' })
      expect(
        await as(
          c,
          null,
          async () =>
            (await c.query(`select public.browse_vendors('Visible') as r`)).rows[0].r.length,
        ),
      ).toBe(1)
      for (const [who, msg] of [
        [AAL2(owner), /forbidden/],
        [AAL2(cust), /forbidden/],
        [AAL1(admin), /aal2/],
      ] as const) {
        const e = await as(c, who, () =>
          failure(c, `select public.set_vendor_status($1,'suspended','policy breach')`, [v.id]),
        )
        expect(e.message).toMatch(msg)
      }
      const noReason = await as(c, AAL2(admin), () =>
        failure(c, `select public.set_vendor_status($1,'suspended','x')`, [v.id]),
      )
      expect(noReason.message).toMatch(/reason/)
      // the owner already has a valid aal2 session when the suspension lands
      await as(c, AAL2(owner), () =>
        c.query(`select public.product_set_availability($1, true)`, [p]),
      )
      await as(c, AAL2(admin), () =>
        c.query(`select public.set_vendor_status($1,'suspended','policy breach')`, [v.id]),
      )
      const w = await as(c, AAL2(owner), () =>
        failure(c, `select public.product_set_availability($1, false)`, [p]),
      )
      expect(w.message).toMatch(/not active/)
      const w2 = await as(c, AAL2(owner), () =>
        failure(c, `select public.vendor_set_temporarily_closed($1, true)`, [v.id]),
      )
      expect(w2.message).toMatch(/not active/)
      expect(
        await as(
          c,
          null,
          async () =>
            (await c.query(`select public.browse_vendors('Visible') as r`)).rows[0].r.length,
        ),
      ).toBe(0)
      expect(
        await as(
          c,
          null,
          async () => (await c.query(`select public.get_vendor_menu($1) as r`, [v.slug])).rows[0].r,
        ),
      ).toBeNull()
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where action='vendor.status_changed' and actor_id=$1`,
            [admin],
          )
        ).rowCount,
      ).toBe(1)
      await as(c, AAL2(admin), () =>
        c.query(`select public.set_vendor_status($1,'approved','appeal accepted')`, [v.id]),
      )
      expect(
        await as(
          c,
          null,
          async () =>
            (await c.query(`select public.browse_vendors('Visible') as r`)).rows[0].r.length,
        ),
      ).toBe(1)
    })
  })
})

describe('vendor isolation and permissions', () => {
  it('vendor A cannot read or change vendor B’s data; aal1 sees and changes nothing', async () => {
    await withTx(async (c) => {
      const oa = await createUser(c)
      const ob = await createUser(c)
      const va = await mkVendor(c, { owner: oa })
      const vb = await mkVendor(c, { owner: ob })
      const pa = await mkProduct(c, va.id)
      const pb = await mkProduct(c, vb.id)
      expect(
        await as(c, AAL2(oa), async () =>
          (await c.query('select id from public.products')).rows.map((r) => r.id),
        ),
      ).toEqual([pa])
      expect(
        await as(c, AAL2(oa), async () =>
          (await c.query('select vendor_id from public.store_hours group by 1')).rows.map(
            (r) => r.vendor_id,
          ),
        ),
      ).toEqual([va.id])
      expect(
        await as(
          c,
          AAL1(oa),
          async () => (await c.query('select id from public.products')).rowCount,
        ),
      ).toBe(0)
      const attempts: [string, unknown[]][] = [
        [
          `select public.product_upsert($1, null, 'Hijack', 'd', 1000, null, true, null, null)`,
          [vb.id],
        ],
        [
          `select public.product_upsert($1, $2, 'Hijack', 'd', 1000, null, true, null, null)`,
          [va.id, pb],
        ], // B's product via A's vendor id
        [`select public.product_set_availability($1, false)`, [pb]],
        [`select public.product_archive($1)`, [pb]],
        [`select public.vendor_set_temporarily_closed($1, true)`, [vb.id]],
        [`select public.vendor_set_hours($1, '[]'::jsonb)`, [vb.id]],
        [`select public.vendor_update_profile($1,'d','08012345678','p',10)`, [vb.id]],
        [`select public.vendor_add_staff($1,'x@example.test')`, [vb.id]],
      ]
      for (const [sql, params] of attempts) {
        const e = await as(c, AAL2(oa), () => failure(c, sql, params))
        expect(e.message + e.code, sql).toMatch(/forbidden|unknown product|42501|P0002/)
      }
      for (const [sql, params] of [
        [`select public.product_set_availability($1, false)`, [pa]],
        [`select public.product_archive($1)`, [pa]],
      ] as [string, unknown[]][]) {
        const e = await as(c, AAL1(oa), () => failure(c, sql, params))
        expect(e.message, sql).toMatch(/aal2/)
      }
      // B's data is untouched
      expect(
        (await c.query(`select is_available, status from public.products where id=$1`, [pb]))
          .rows[0],
      ).toEqual({ is_available: true, status: 'active' })
    })
  })

  it('direct table writes are impossible for vendors', async () => {
    await withTx(async (c) => {
      const o = await createUser(c)
      const v = await mkVendor(c, { owner: o })
      const p = await mkProduct(c, v.id)
      for (const sql of [
        `update public.products set price_kobo = 1 where id='${p}'`,
        `delete from public.products where id='${p}'`,
        `insert into public.products (vendor_id, name, price_kobo) values ('${v.id}','x1',100)`,
        `update public.vendors set status='approved'`,
        `insert into public.vendor_staff values ('${v.id}', '${o}')`,
        `update public.store_hours set closes='23:00'`,
        `insert into public.categories (slug,name) values ('hack','Hack')`,
      ]) {
        const e = await as(c, AAL2(o), () => failure(c, sql))
        expect(e.code, sql).toBe(PRIV_DENIED)
      }
    })
  })

  it('staff can manage products but not profile, hours or staff; owner can', async () => {
    await withTx(async (c) => {
      const owner = await createUser(c)
      const staff = await createUser(c)
      const v = await mkVendor(c, { owner })
      await as(c, AAL2(owner), () =>
        c.query(`select public.vendor_add_staff($1, $2)`, [v.id, `${staff}@nowhere.test`]),
      ) // unknown email: silently nothing
      expect(
        (await c.query(`select 1 from public.vendor_staff where vendor_id=$1`, [v.id])).rowCount,
      ).toBe(1)
      const email = (await c.query(`select email from auth.users where id=$1`, [staff])).rows[0]
        .email
      await as(c, AAL2(owner), () =>
        c.query(`select public.vendor_add_staff($1, $2)`, [v.id, email.toUpperCase()]),
      )
      expect(
        (
          await c.query(
            `select 1 from public.vendor_staff where vendor_id=$1 and user_id=$2 and staff_role='staff'`,
            [v.id, staff],
          )
        ).rowCount,
      ).toBe(1)
      expect(
        (
          await c.query(
            `select 1 from public.role_assignments where user_id=$1 and role='vendor_staff' and status='active'`,
            [staff],
          )
        ).rowCount,
      ).toBe(1)
      const pid = await as(
        c,
        AAL2(staff),
        async () =>
          (
            await c.query(
              `select public.product_upsert($1,null,'Staff Made Meal','d',150000,null,true,null,null) as id`,
              [v.id],
            )
          ).rows[0].id,
      )
      expect(pid).toBeTruthy()
      for (const [sql, params] of [
        [`select public.vendor_update_profile($1,'d','08012345678','p',10)`, [v.id]],
        [`select public.vendor_set_hours($1,'[]'::jsonb)`, [v.id]],
        [`select public.vendor_add_staff($1,'someone@example.test')`, [v.id]],
        [`select public.vendor_remove_staff($1,$2)`, [v.id, owner]],
      ] as [string, unknown[]][]) {
        const e = await as(c, AAL2(staff), () => failure(c, sql, params))
        expect(e.message, sql).toMatch(/forbidden/)
      }
      // owner cannot remove the owner row; staff removal revokes the role; adding an existing member again is a no-op
      await as(c, AAL2(owner), () =>
        c.query(`select public.vendor_remove_staff($1,$2)`, [v.id, owner]),
      )
      expect(
        (
          await c.query(`select 1 from public.vendor_staff where vendor_id=$1 and user_id=$2`, [
            v.id,
            owner,
          ])
        ).rowCount,
      ).toBe(1)
      await as(c, AAL2(owner), () =>
        c.query(`select public.vendor_remove_staff($1,$2)`, [v.id, staff]),
      )
      expect(
        (await c.query(`select 1 from public.vendor_staff where user_id=$1`, [staff])).rowCount,
      ).toBe(0)
      expect(
        (
          await c.query(
            `select 1 from public.role_assignments where user_id=$1 and role='vendor_staff' and status='active'`,
            [staff],
          )
        ).rowCount,
      ).toBe(0)
      const actions = (
        await c.query(`select action from public.audit_events where actor_id=$1`, [owner])
      ).rows.map((r) => r.action)
      expect(actions).toEqual(
        expect.arrayContaining(['vendor.staff_added', 'vendor.staff_removed']),
      )
      // a person who already belongs to a vendor cannot be added to a second one
      const other = await createUser(c)
      const v2 = await mkVendor(c, { owner: other })
      await as(c, AAL2(other), () =>
        c.query(`select public.vendor_add_staff($1,$2)`, [v2.id, email]),
      )
      await as(c, AAL2(owner), () =>
        c.query(`select public.vendor_add_staff($1,$2)`, [v.id, email]),
      )
      await as(c, AAL2(other), () =>
        c.query(`select public.vendor_add_staff($1,$2)`, [v2.id, email]),
      )
      expect(
        (await c.query(`select count(*)::int n from public.vendor_staff where user_id=$1`, [staff]))
          .rows[0].n,
      ).toBe(1)
    })
  })
})

describe('opening hours', () => {
  it('open_now is evaluated in Africa/Lagos; closed flag and non-approved vendors are closed', async () => {
    await withTx(async (c) => {
      const o = await createUser(c)
      const v = await mkVendor(c, { owner: o, hours: false })
      await as(c, AAL2(o), () =>
        c.query(`select public.vendor_set_hours($1, $2::jsonb)`, [
          v.id,
          JSON.stringify([
            { weekday: 1, opens: '08:00', closes: '18:00' },
            { weekday: 1, opens: '19:00', closes: '21:00' },
          ]),
        ]),
      )
      const open = async (iso: string) =>
        (await c.query(`select app_private.vendor_is_open($1, $2::timestamptz) as o`, [v.id, iso]))
          .rows[0].o
      // 2026-10-12 is a Monday. Lagos = UTC+1 (no DST).
      expect(await open('2026-10-12T09:00:00Z')).toBe(true) // 10:00 Lagos
      expect(await open('2026-10-12T07:00:00Z')).toBe(true) // 08:00 Lagos: opening instant is inclusive
      expect(await open('2026-10-12T06:59:00Z')).toBe(false) // 07:59 Lagos
      expect(await open('2026-10-12T17:00:00Z')).toBe(false) // 18:00 Lagos closed
      expect(await open('2026-10-12T16:59:59Z')).toBe(true)
      expect(await open('2026-10-12T19:00:00Z')).toBe(true) // 20:00 Lagos second window
      expect(await open('2026-10-11T09:00:00Z')).toBe(false) // Sunday
      expect(await open('2026-10-12T23:30:00Z')).toBe(false) // 00:30 Tuesday Lagos
      await as(c, AAL2(o), () =>
        c.query(`select public.vendor_set_temporarily_closed($1, true)`, [v.id]),
      )
      expect(await open('2026-10-12T09:00:00Z')).toBe(false)
      await as(c, AAL2(o), () =>
        c.query(`select public.vendor_set_temporarily_closed($1, false)`, [v.id]),
      )
      await c.query(`update public.vendors set status='suspended' where id=$1`, [v.id])
      expect(await open('2026-10-12T09:00:00Z')).toBe(false)
      expect(
        (await c.query(`select app_private.vendor_is_open(gen_random_uuid()) as o`)).rows[0].o,
      ).toBe(false)
    })
  })
  it('rejects overlapping, inverted and malformed intervals; replaces atomically', async () => {
    await withTx(async (c) => {
      const o = await createUser(c)
      const v = await mkVendor(c, { owner: o })
      const set = (h: unknown) =>
        as(c, AAL2(o), () =>
          failure(c, `select public.vendor_set_hours($1, $2::jsonb)`, [v.id, JSON.stringify(h)]),
        )
      expect(
        (
          await set([
            { weekday: 1, opens: '08:00', closes: '12:00' },
            { weekday: 1, opens: '11:00', closes: '14:00' },
          ])
        ).message,
      ).toMatch(/overlapping/)
      expect((await set([{ weekday: 1, opens: '12:00', closes: '08:00' }])).message).toMatch(
        /invalid interval/,
      )
      expect((await set([{ weekday: 9, opens: '08:00', closes: '12:00' }])).message).toMatch(
        /invalid interval/,
      )
      expect((await set([{ weekday: 1, opens: 'banana', closes: '12:00' }])).message).toMatch(
        /invalid interval/,
      )
      expect((await set({ not: 'an array' })).message).toMatch(/array/)
      expect(
        (
          await set(
            Array.from({ length: 29 }, (_, i) => ({
              weekday: i % 7,
              opens: '00:00',
              closes: '00:01',
            })),
          )
        ).message,
      ).toMatch(/too many/)
      expect(
        (await c.query(`select count(*)::int n from public.store_hours where vendor_id=$1`, [v.id]))
          .rows[0].n,
      ).toBe(7) // untouched by failures
      await as(c, AAL2(o), () => c.query(`select public.vendor_set_hours($1,'[]'::jsonb)`, [v.id]))
      expect(
        (await c.query(`select count(*)::int n from public.store_hours where vendor_id=$1`, [v.id]))
          .rows[0].n,
      ).toBe(0)
    })
  })
})

describe('product validation', () => {
  it('rejects invalid prices, names, stock and malformed option groups', async () => {
    await withTx(async (c) => {
      const o = await createUser(c)
      const v = await mkVendor(c, { owner: o })
      const up = (name: string, price: number, stock: number | null, options: unknown = []) =>
        as(c, AAL2(o), () =>
          failure(c, `select public.product_upsert($1,null,$2,'d',$3,null,true,$4,$5::jsonb)`, [
            v.id,
            name,
            price,
            stock,
            JSON.stringify(options),
          ]),
        )
      expect((await up('Good name', 0, null)).code).toBe('23514')
      expect((await up('Good name', -5, null)).code).toBe('23514')
      expect((await up('Good name', 100000001, null)).code).toBe('23514')
      expect((await up('x', 1000, null)).code).toBe('23514')
      expect((await up('Good name', 1000, -1)).code).toBe('23514')
      expect((await up('Good name', 1000, 100001)).code).toBe('23514')
      expect(
        (
          await up('Good name', 1000, null, [
            { name: 'G', min: 2, max: 1, options: [{ name: 'a' }, { name: 'b' }] },
          ])
        ).message,
      ).toMatch(/limits/)
      expect(
        (await up('Good name', 1000, null, [{ name: 'G', min: 0, max: 1, options: [] }])).message,
      ).toMatch(/1-20 options/)
      expect(
        (
          await up('Good name', 1000, null, [
            { name: 'G', min: 0, max: 3, options: [{ name: 'a' }] },
          ])
        ).message,
      ).toMatch(/limits/)
      expect(
        (
          await up('Good name', 1000, null, [
            { name: 'G', min: 0, max: 1, options: [{ name: 'a', price_delta_kobo: -5 }] },
          ])
        ).code,
      ).toBe('23514')
      expect((await up('Good name', 1000, null, 'nope')).message).toMatch(/invalid options/)
      expect(
        (await c.query(`select count(*)::int n from public.products where vendor_id=$1`, [v.id]))
          .rows[0].n,
      ).toBe(0)
    })
  })
  it('creates, updates (replacing options) and archives; archived products disappear publicly', async () => {
    await withTx(async (c) => {
      const o = await createUser(c)
      const v = await mkVendor(c, { owner: o })
      const opts = [
        {
          name: 'Size',
          min: 1,
          max: 1,
          options: [
            { name: 'Regular', price_delta_kobo: 0 },
            { name: 'Large', price_delta_kobo: 30000 },
          ],
        },
      ]
      const id = await as(
        c,
        AAL2(o),
        async () =>
          (
            await c.query(
              `select public.product_upsert($1,null,'Suya Platter','Spicy',200000,'Mains',true,10,$2::jsonb) as id`,
              [v.id, JSON.stringify(opts)],
            )
          ).rows[0].id,
      )
      expect(
        (
          await c.query(
            `select count(*)::int n from public.product_options po join public.product_option_groups g on g.id=po.group_id where g.product_id=$1`,
            [id],
          )
        ).rows[0].n,
      ).toBe(2)
      await as(c, AAL2(o), () =>
        c.query(
          `select public.product_upsert($1,$2,'Suya Platter XL','Spicy',250000,'Mains',true,5,'[]'::jsonb)`,
          [v.id, id],
        ),
      )
      expect(
        (
          await c.query(
            `select name, price_kobo, stock_quantity from public.products where id=$1`,
            [id],
          )
        ).rows[0],
      ).toEqual({ name: 'Suya Platter XL', price_kobo: '250000', stock_quantity: 5 })
      expect(
        (
          await c.query(
            `select count(*)::int n from public.product_option_groups where product_id=$1`,
            [id],
          )
        ).rows[0].n,
      ).toBe(0)
      const menu = await as(
        c,
        null,
        async () => (await c.query(`select public.get_vendor_menu($1) as m`, [v.slug])).rows[0].m,
      )
      expect(menu.products).toHaveLength(1)
      await as(c, AAL2(o), () => c.query(`select public.product_archive($1)`, [id]))
      const after = await as(
        c,
        null,
        async () => (await c.query(`select public.get_vendor_menu($1) as m`, [v.slug])).rows[0].m,
      )
      expect(after.products).toHaveLength(0)
      const upd = await as(c, AAL2(o), () =>
        failure(c, `select public.product_upsert($1,$2,'Revive','d',1000,null,true,null,null)`, [
          v.id,
          id,
        ]),
      )
      expect(upd.message).toMatch(/unknown product/) // archived products cannot be edited back to life
    })
  })
})

describe('categories and delivery points (admin managed)', () => {
  it('only an aal2 platform admin can change them; delivery points list is for signed-in users and hides inactive ones', async () => {
    await withTx(async (c) => {
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const cust = await createUser(c)
      for (const sql of [
        `select public.category_upsert(null,'sample-cat','Sample',1,true)`,
        `select public.delivery_point_upsert(null,'Sample point A (placeholder)',null,true,1)`,
      ]) {
        expect((await as(c, AAL2(cust), () => failure(c, sql))).message).toMatch(/forbidden/)
        expect((await as(c, AAL1(admin), () => failure(c, sql))).message).toMatch(/aal2/)
        expect((await as(c, null, () => failure(c, sql))).code).toBe(PRIV_DENIED)
        await as(c, AAL2(admin), () => c.query(sql))
      }
      const bad = await as(c, AAL2(admin), () =>
        failure(c, `select public.category_upsert(null,'Bad Slug!','Sample',1,true)`),
      )
      expect(bad.code).toBe('23514')
      await as(c, AAL2(admin), () =>
        c.query(
          `select public.delivery_point_upsert(null,'Hidden point (placeholder)',null,false,2)`,
        ),
      )
      const list = await as(
        c,
        AAL2(cust),
        async () => (await c.query(`select public.list_delivery_points() as l`)).rows[0].l,
      )
      expect(list.map((p: { label: string }) => p.label)).toContain('Sample point A (placeholder)')
      expect(list.map((p: { label: string }) => p.label)).not.toContain(
        'Hidden point (placeholder)',
      )
      expect(
        (await as(c, null, () => failure(c, `select public.list_delivery_points()`))).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where actor_id=$1 and action in ('category.saved','delivery_point.saved')`,
            [admin],
          )
        ).rowCount,
      ).toBe(3)
      // direct table access to delivery points: admin reads, customers cannot
      expect(
        await as(
          c,
          AAL2(cust),
          async () => (await c.query('select 1 from public.approved_delivery_points')).rowCount,
        ),
      ).toBe(0)
    })
  })
})
