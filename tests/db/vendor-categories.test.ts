import { afterAll, describe, expect, it } from 'vitest'
import { AAL2, as, createUser, failure, giveRole, pool, withTx } from './helpers'
import type { PoolClient } from 'pg'

afterAll(async () => {
  await pool.end()
})

const cat = async (c: PoolClient, slug: string, name = slug) => {
  await c.query(
    `insert into public.categories (slug, name, sort_order) values ($1, $2, 900) on conflict (slug) do nothing`,
    [slug, name],
  )
  return (await c.query(`select id from public.categories where slug = $1`, [slug])).rows[0]
    .id as string
}
const APPLY = `select public.submit_vendor_application('Campus Bundle','08012345678',$1,'Clothes and gadgets for students','Near the main gate',true,$2::uuid[],$3,$4,$5) as id`

describe('shops with several categories and a type', () => {
  it('records every chosen category on approval, shows the shop under each, and keeps the main one', async () => {
    await withTx(async (c) => {
      const clothing = await cat(c, 'clothing')
      const gadgets = await cat(c, 'gadgets')
      const other = await cat(c, 'other')
      const applicant = await createUser(c, 'multi')
      const admin = await createUser(c, 'adm')
      await giveRole(c, admin, 'platform_admin')
      const app = await as(
        c,
        AAL2(applicant),
        async () =>
          (
            await c.query(APPLY, [
              clothing,
              [gadgets, other, gadgets],
              'Hand-made leather keyrings',
              'afit_shop',
              'Beside the main gate',
            ])
          ).rows[0].id,
      )
      const row = (await c.query(`select * from public.vendor_applications where id = $1`, [app]))
        .rows[0]
      expect(row.vendor_type).toBe('afit_shop')
      expect(row.other_category).toBe('Hand-made leather keyrings')
      expect([...row.extra_category_ids].sort()).toEqual([gadgets, other].sort())
      const vendor = await as(
        c,
        AAL2(admin),
        async () =>
          (await c.query(`select public.decide_vendor_application($1,'approve',null) as v`, [app]))
            .rows[0].v,
      )
      const cats = (
        await c.query(`select category_id from public.vendor_categories where vendor_id = $1`, [
          vendor,
        ])
      ).rows.map((r) => r.category_id)
      expect(cats.sort()).toEqual([clothing, gadgets, other].sort())
      const v = (
        await c.query(`select category_id, other_category from public.vendors where id = $1`, [
          vendor,
        ])
      ).rows[0]
      expect(v.category_id).toBe(clothing)
      expect(v.other_category).toBe('Hand-made leather keyrings')
      // browsing by any of its categories finds it
      for (const slug of ['clothing', 'gadgets', 'other']) {
        const r = (
          await c.query(`select public.browse_vendors(null, $1, false, 50, 0) as r`, [slug])
        ).rows[0].r as { id: string }[]
        expect(
          r.some((x) => x.id === vendor),
          slug,
        ).toBe(true)
      }
      const none = (await c.query(`select public.browse_vendors(null, 'food', false, 50, 0) as r`))
        .rows[0].r as { id: string }[]
      expect(none.some((x) => x.id === vendor)).toBe(false)
      // my_vendor reports them
      const me = (await as(c, AAL2(applicant), () => c.query(`select public.my_vendor() as m`)))
        .rows[0].m
      expect([...me.category_slugs].sort()).toEqual(['clothing', 'gadgets', 'other'])
      expect(me.category_slug).toBe('clothing')
    })
  })

  it('refuses a made-up type, an AFIT shop with no place, and too many categories', async () => {
    await withTx(async (c) => {
      const clothing = await cat(c, 'clothing')
      const u = await createUser(c, 'bad1')
      const e1 = await as(c, AAL2(u), () => failure(c, APPLY, [clothing, [], null, 'wizard', null]))
      expect(e1.message).toMatch(/invalid_vendor_type/)
      const e2 = await as(c, AAL2(u), () =>
        failure(c, APPLY, [clothing, [], null, 'afit_shop', ' ']),
      )
      expect(e2.message).toMatch(/shop_place_required/)
      const many = await Promise.all([...Array(9)].map((_, i) => cat(c, `cat-x${i}`)))
      const e3 = await as(c, AAL2(u), () =>
        failure(c, APPLY, [clothing, many, null, 'other', null]),
      )
      expect(e3.message).toMatch(/too_many_categories/)
      // the old six-argument call still works
      const ok = await as(
        c,
        AAL2(u),
        async () =>
          (
            await c.query(
              `select public.submit_vendor_application('Old Style','08012345678',$1,'A description long enough','Pickup point',true) as id`,
              [clothing],
            )
          ).rows[0].id,
      )
      expect(ok).toBeTruthy()
    })
  })

  it('lets only the shop owner change the categories later', async () => {
    await withTx(async (c) => {
      const clothing = await cat(c, 'clothing')
      const games = await cat(c, 'games')
      const owner = await createUser(c, 'own')
      const staff = await createUser(c, 'stf')
      const stranger = await createUser(c, 'str')
      const { mkVendor } = await import('./helpers')
      const v = await mkVendor(c, { owner, category: 'clothing' })
      await c.query(
        `insert into public.vendor_staff (vendor_id, user_id, staff_role) values ($1, $2, 'staff')`,
        [v.id, staff],
      )
      await as(c, AAL2(owner), () =>
        c.query(`select public.vendor_set_categories($1, $2, $3::uuid[], 'Phone covers')`, [
          v.id,
          games,
          [clothing],
        ]),
      )
      const rows = (
        await c.query(`select category_id from public.vendor_categories where vendor_id = $1`, [
          v.id,
        ])
      ).rows.map((r) => r.category_id)
      expect(rows.sort()).toEqual([clothing, games].sort())
      expect(
        (
          await c.query(`select category_id, other_category from public.vendors where id = $1`, [
            v.id,
          ])
        ).rows[0],
      ).toMatchObject({ category_id: games, other_category: 'Phone covers' })
      for (const who of [staff, stranger]) {
        const f = await as(c, AAL2(who), () =>
          failure(c, `select public.vendor_set_categories($1, $2, '{}', null)`, [v.id, clothing]),
        )
        expect(f.code).toBe('42501')
      }
    })
  })
})
