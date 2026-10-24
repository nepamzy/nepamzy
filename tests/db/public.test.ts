import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  as,
  createUser,
  failure,
  mkOptionGroup,
  mkProduct,
  mkVendor,
  pool,
  withTx,
  PRIV_DENIED,
} from './helpers'
import type { PoolClient } from 'pg'

afterAll(async () => {
  await pool.end()
})

const anon = <T>(c: PoolClient, fn: () => Promise<T>) => as(c, null, fn)
const browse = (c: PoolClient, q: string | null, extra = '') =>
  anon(
    c,
    async () =>
      (await c.query(`select public.browse_vendors($1${extra}) as r`, [q])).rows[0].r as Record<
        string,
        unknown
      >[],
  )

describe('public read model (anonymous visitors)', () => {
  it('shows only approved vendors and active products; hides pending, suspended and archived', async () => {
    await withTx(async (c) => {
      const tok = `Tk${randomUUID().slice(0, 6)}`
      const o1 = await createUser(c)
      const ok = await mkVendor(c, { owner: o1, name: `${tok} Good` })
      const pend = await mkVendor(c, { name: `${tok} Pending`, status: 'pending' })
      const susp = await mkVendor(c, { name: `${tok} Suspended`, status: 'suspended' })
      await mkProduct(c, ok.id, { name: `${tok} Rice` })
      await mkProduct(c, ok.id, { name: `${tok} Gone`, status: 'archived' })
      await mkProduct(c, pend.id, { name: `${tok} PendProduct` })
      await mkProduct(c, susp.id, { name: `${tok} SuspProduct` })
      const names = (await browse(c, tok)).map((v) => v.name)
      expect(names).toEqual([`${tok} Good`])
      const menu = await anon(
        c,
        async () => (await c.query(`select public.get_vendor_menu($1) as m`, [ok.slug])).rows[0].m,
      )
      expect(menu.products.map((p: { name: string }) => p.name)).toEqual([`${tok} Rice`])
      for (const v of [pend, susp]) {
        expect(
          await anon(
            c,
            async () =>
              (await c.query(`select public.get_vendor_menu($1) as m`, [v.slug])).rows[0].m,
          ),
        ).toBeNull()
      }
      const found = await anon(
        c,
        async () => (await c.query(`select public.search_products($1) as r`, [tok])).rows[0].r,
      )
      expect(found.map((p: { name: string }) => p.name)).toEqual([`${tok} Rice`])
    })
  })

  it('exposes only public-safe fields (no phone, owner, status, stock quantities)', async () => {
    await withTx(async (c) => {
      const o = await createUser(c)
      const v = await mkVendor(c, { owner: o })
      const p = await mkProduct(c, v.id, { stock: 7 })
      await c.query(`update public.vendors set contact_phone='08012345678' where id=$1`, [v.id])
      const menu = await anon(
        c,
        async () => (await c.query(`select public.get_vendor_menu($1) as m`, [v.slug])).rows[0].m,
      )
      expect(Object.keys(menu.vendor).sort()).toEqual([
        'category',
        'description',
        'id',
        'name',
        'open_now',
        'pickup_location_text',
        'prep_minutes',
        'slug',
        'temporarily_closed',
      ])
      expect(Object.keys(menu.products[0]).sort()).toEqual([
        'available',
        'description',
        'id',
        'name',
        'options',
        'price_kobo',
        'section',
      ])
      expect(JSON.stringify(menu)).not.toMatch(/08012345678|owner_id|stock_quantity|contact_phone/)
      const prod = await anon(
        c,
        async () => (await c.query(`select public.get_product($1) as r`, [p])).rows[0].r,
      )
      expect(prod.product.id).toBe(p)
      const list = await browse(c, v.slug.slice(0, 4))
      for (const row of list)
        expect(Object.keys(row)).not.toEqual(
          expect.arrayContaining(['contact_phone', 'owner_id', 'status']),
        )
    })
  })

  it('flags unavailable / sold-out products; option availability is reported', async () => {
    await withTx(async (c) => {
      const o = await createUser(c)
      const v = await mkVendor(c, { owner: o })
      const a = await mkProduct(c, v.id, { name: 'Alpha item' })
      const b = await mkProduct(c, v.id, { name: 'Beta item', available: false })
      const d = await mkProduct(c, v.id, { name: 'Delta item', stock: 0 })
      await mkOptionGroup(c, a, {
        name: 'Extras',
        options: [
          { name: 'Egg', delta: 20000 },
          { name: 'Fish', delta: 90000, available: false },
        ],
      })
      const menu = await anon(
        c,
        async () => (await c.query(`select public.get_vendor_menu($1) as m`, [v.slug])).rows[0].m,
      )
      const by = Object.fromEntries(menu.products.map((p: { name: string }) => [p.name, p]))
      expect(by['Alpha item'].available).toBe(true)
      expect(by['Beta item'].available).toBe(false)
      expect(by['Delta item'].available).toBe(false)
      expect(
        by['Alpha item'].options[0].options.map((x: { name: string; available: boolean }) => [
          x.name,
          x.available,
        ]),
      ).toEqual([
        ['Egg', true],
        ['Fish', false],
      ])
      void b
      void d
    })
  })

  it('search treats % and _ as plain characters, survives hostile input, caps limits and paginates', async () => {
    await withTx(async (c) => {
      const tok = `Pg${randomUUID().slice(0, 6)}`
      const o = await createUser(c)
      const base = await mkVendor(c, { owner: o, name: `${tok} 00` })
      for (let i = 1; i < 55; i++)
        await mkVendor(c, { name: `${tok} ${String(i).padStart(2, '0')}` })
      await mkProduct(c, base.id, { name: `${tok} 100% cotton` })
      for (const q of [
        '%',
        '_',
        '%%',
        'a_c',
        '\\',
        "'; drop table public.products; --",
        '"',
        '\u0000'.replace('\u0000', 'x'),
      ]) {
        const r = await browse(c, q)
        expect(Array.isArray(r), q).toBe(true)
        if (['_', '%%', '\\'].includes(q))
          expect(r, `wildcard ${q} must not match everything`).toHaveLength(0)
        // '%' appears literally in exactly one product name ("100% cotton"), so exactly that vendor matches
        if (q === '%') expect(r.map((v) => v.name)).toEqual([`${tok} 00`])
      }
      const pct = await anon(
        c,
        async () => (await c.query(`select public.search_products('%') as r`)).rows[0].r,
      )
      expect(pct.map((p: { name: string }) => p.name)).toEqual([`${tok} 100% cotton`]) // literal match only, not "everything"
      expect(
        await anon(
          c,
          async () => (await c.query(`select public.search_products('_') as r`)).rows[0].r,
        ),
      ).toEqual([])
      const literal = await anon(
        c,
        async () => (await c.query(`select public.search_products('100%') as r`)).rows[0].r,
      )
      expect(literal).toHaveLength(1)
      const capped = await browse(c, tok, ', null, false, 1000, 0')
      expect(capped).toHaveLength(50)
      const page2 = await browse(c, tok, ', null, false, 1000, 50')
      expect(page2).toHaveLength(5)
      const names = new Set([...capped, ...page2].map((v) => v.name))
      expect(names.size).toBe(55)
      expect(await browse(c, tok, ', null, false, 0, 0')).toHaveLength(1) // limit floor is 1
      expect(await browse(c, tok, ', null, false, 5, -10')).toHaveLength(5) // negative offset treated as 0
      expect(
        await anon(
          c,
          async () => (await c.query(`select public.search_products(null) as r`)).rows[0].r,
        ),
      ).toEqual([])
      expect(
        await anon(
          c,
          async () => (await c.query(`select public.search_products('   ') as r`)).rows[0].r,
        ),
      ).toEqual([])
    })
  })

  it('filters by category, open now and price; open vendors sort first', async () => {
    await withTx(async (c) => {
      const tok = `Ft${randomUUID().slice(0, 6)}`
      const closed = await mkVendor(c, { name: `${tok} A closed`, hours: false, category: 'food' })
      const open = await mkVendor(c, { name: `${tok} B open`, category: 'food' })
      const print = await mkVendor(c, { name: `${tok} C print`, category: 'printing' })
      await mkProduct(c, closed.id, { name: `${tok} cheap`, price: 50000 })
      await mkProduct(c, open.id, { name: `${tok} pricey`, price: 500000 })
      expect((await browse(c, tok)).map((v) => v.name)).toEqual([
        `${tok} B open`,
        `${tok} C print`,
        `${tok} A closed`,
      ])
      expect((await browse(c, tok, ", 'printing'")).map((v) => v.name)).toEqual([`${tok} C print`])
      expect((await browse(c, tok, ', null, true')).map((v) => v.name)).toEqual([
        `${tok} B open`,
        `${tok} C print`,
      ])
      const cheap = await anon(
        c,
        async () =>
          (await c.query(`select public.search_products($1, 100000) as r`, [tok])).rows[0].r,
      )
      expect(cheap.map((p: { name: string }) => p.name)).toEqual([`${tok} cheap`])
      const openOnly = await anon(
        c,
        async () =>
          (await c.query(`select public.search_products($1, null, true) as r`, [tok])).rows[0].r,
      )
      expect(openOnly.map((p: { name: string }) => p.name)).toEqual([`${tok} pricey`])
      void print
    })
  })

  it('get_product returns null for archived, suspended and unknown products', async () => {
    await withTx(async (c) => {
      const v = await mkVendor(c)
      const s = await mkVendor(c, { status: 'suspended' })
      const arch = await mkProduct(c, v.id, { status: 'archived' })
      const sp = await mkProduct(c, s.id)
      for (const id of [arch, sp, randomUUID()]) {
        expect(
          await anon(
            c,
            async () => (await c.query(`select public.get_product($1) as r`, [id])).rows[0].r,
          ),
        ).toBeNull()
      }
    })
  })

  it('anonymous visitors still cannot read any table or call any non-public function', async () => {
    await withTx(async (c) => {
      for (const t of [
        'vendors',
        'products',
        'store_hours',
        'categories',
        'orders',
        'carts',
        'approved_delivery_points',
      ]) {
        expect((await anon(c, () => failure(c, `select * from public.${t}`))).code, t).toBe(
          PRIV_DENIED,
        )
      }
      for (const fn of [
        'public.my_vendor()',
        'public.cart_clear()',
        `public.cart_quote('pickup', null)`,
        'public.list_delivery_points()',
      ]) {
        expect((await anon(c, () => failure(c, `select ${fn}`))).code, fn).toBe(PRIV_DENIED)
      }
    })
  })
})
