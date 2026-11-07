import { afterAll, describe, expect, it } from 'vitest'
import { as, createUser, failure, mkVendor, pool, withTx } from './helpers'

afterAll(async () => {
  await pool.end()
})

describe('shop picks for "add from the list"', () => {
  it('are closed to every API role directly and open only to the shop through the functions', async () => {
    await withTx(async (c) => {
      for (const role of ['authenticated', 'anon'])
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const r = await c.query(
            `select has_table_privilege($1, 'public.vendor_catalogue_picks', $2) as ok`,
            [role, priv],
          )
          expect(r.rows[0].ok, `${role} ${priv}`).toBe(false)
        }
      const owner = await createUser(c, 'pickowner')
      const other = await createUser(c, 'pickother')
      await c.query(
        `insert into public.categories (slug, name) values ('clothing', 'Clothing') on conflict (slug) do nothing`,
      )
      const v = await mkVendor(c, { owner, category: 'clothing' })
      const mine = { id: owner, aal: 'aal2' as const }
      await as(c, mine, () =>
        c.query(`select public.vendor_picks_add($1, array['hoodie','jeans','hoodie'])`, [v.id]),
      )
      const list = await as(c, mine, () =>
        c.query(`select public.vendor_picks_list($1) as l`, [v.id]),
      )
      expect([...list.rows[0].l].sort()).toEqual(['hoodie', 'jeans'])
      await as(c, mine, () => c.query(`select public.vendor_picks_remove($1, 'hoodie')`, [v.id]))
      const after = await as(c, mine, () =>
        c.query(`select public.vendor_picks_list($1) as l`, [v.id]),
      )
      expect(after.rows[0].l).toEqual(['jeans'])
      // someone from another shop, or nobody, is refused
      const theirs = { id: other, aal: 'aal2' as const }
      const denied = await as(c, theirs, () =>
        failure(c, `select public.vendor_picks_list($1)`, [v.id]),
      )
      expect(denied.message).toMatch(/forbidden/)
      expect(
        await as(c, null, () =>
          failure(c, `select public.vendor_picks_add($1, array['x1'])`, [v.id]),
        ),
      ).toBeTruthy()
      // a bad slug cannot be stored
      expect(
        await as(c, mine, () =>
          failure(c, `select public.vendor_picks_add($1, array['Bad Slug'])`, [v.id]),
        ),
      ).toBeTruthy()
      // my_vendor now carries the category
      const me = await as(c, mine, () => c.query(`select public.my_vendor() as m`))
      expect(me.rows[0].m.category_slug).toBe('clothing')
    })
  })
})
