import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
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
  fixPricing,
  giveRole,
  mkDeliveryPoint,
  mkOptionGroup,
  mkProduct,
  mkVendor,
  pool,
  removeCustomerRole,
  setSetting,
  withTx,
} from './helpers'

afterAll(async () => {
  await pool.end()
})

/** One vendor (open, with stock-tracked product), one customer, one delivery point, known pricing. */
async function shop(c: PoolClient, o: { stock?: number | null; price?: number } = {}) {
  await fixPricing(c, { delivery: 50000 })
  const owner = await createUser(c, 'owner')
  const cust = await createUser(c, 'cust')
  const v = await mkVendor(c, { owner })
  const p = await mkProduct(c, v.id, {
    price: o.price ?? 250000,
    stock: o.stock === undefined ? 10 : o.stock,
  })
  const point = await mkDeliveryPoint(c)
  return { owner, cust, v, p, point }
}
const quote = (
  c: PoolClient,
  who: ReturnType<typeof AAL2>,
  f: 'pickup' | 'delivery',
  point: string | null = null,
) =>
  as(
    c,
    who,
    async () => (await c.query(`select public.cart_quote($1, $2) as q`, [f, point])).rows[0].q,
  )
const stock = async (c: PoolClient, p: string) =>
  (await c.query(`select stock_quantity s from public.products where id=$1`, [p])).rows[0].s as
    number | null

describe('the customer platform fee is retired; commission arithmetic is integer half-up', () => {
  it('platform_fee is 0 whatever the inputs (the customer is never charged a service fee)', async () => {
    const r = await pool.query(
      `select app_private.platform_fee(500000, 500) a, app_private.platform_fee(99999, 3000) b, app_private.platform_fee(0, 0) c`,
    )
    expect(r.rows[0]).toEqual({ a: '0', b: '0', c: '0' })
  })
  it.each([
    [0, 450, 0],
    [1, 450, 0],
    [11, 450, 0],
    [12, 450, 1],
    [500000, 450, 22500],
    [500000, 300, 15000],
    [500000, 150, 7500],
    [333, 450, 15],
    [99999, 450, 4500],
    [1000, 0, 0],
  ])('round_bps(%s kobo, %s bps) = %s (half up)', async (amount, bps, out) => {
    const r = await pool.query(`select app_private.round_bps($1::bigint, $2::bigint) as f`, [
      amount,
      bps,
    ])
    expect(Number(r.rows[0].f)).toBe(out)
  })
  it('round_bps matches an independent BigInt implementation on 300 random inputs, including huge values', async () => {
    const rnd = (max: bigint) => BigInt(Math.floor(Math.random() * Number(max)))
    for (let i = 0; i < 300; i++) {
      const items = i % 10 === 0 ? 100000000n * 100n * 30n - rnd(1000n) : rnd(1000000000000n)
      const bps = rnd(2001n)
      const r = await pool.query(
        `select app_private.round_bps($1::bigint, $2::bigint)::text as f`,
        [items.toString(), bps.toString()],
      )
      expect(r.rows[0].f, `${items} @ ${bps}`).toBe(((items * bps + 5000n) / 10000n).toString())
    }
  })
})

describe('cart and quote', () => {
  it('prices pickup vs delivery, with options, from the database', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const withOpt = await mkProduct(c, s.v.id, { price: 100000 })
      const { optionIds } = await mkOptionGroup(c, withOpt, {
        name: 'Size',
        min: 1,
        max: 1,
        options: [
          { name: 'Regular', delta: 0 },
          { name: 'Large', delta: 30000 },
        ],
      })
      await addToCart(c, AAL2(s.cust), s.p, 2)
      await addToCart(c, AAL2(s.cust), withOpt, 3, [optionIds[1]!])
      const pick = await quote(c, AAL2(s.cust), 'pickup')
      // 2 x 250000 + 3 x 130000 = 890000 ; no customer fee
      expect(pick).toMatchObject({
        items_total_kobo: 890000,
        delivery_fee_kobo: 0,
        platform_fee_kobo: 0,
        total_kobo: 890000,
        problems: [],
      })
      expect(pick.lines.map((l: { unit_price_kobo: number }) => l.unit_price_kobo)).toEqual([
        250000, 130000,
      ])
      const del = await quote(c, AAL2(s.cust), 'delivery', s.point)
      expect(del).toMatchObject({ delivery_fee_kobo: 50000, total_kobo: 940000, problems: [] })
      const noPoint = await quote(c, AAL2(s.cust), 'delivery', null)
      expect(noPoint.problems.map((p: { code: string }) => p.code)).toContain(
        'delivery_point_invalid',
      )
      const inactive = await mkDeliveryPoint(c, { active: false })
      expect(
        (await quote(c, AAL2(s.cust), 'delivery', inactive)).problems.map(
          (p: { code: string }) => p.code,
        ),
      ).toContain('delivery_point_invalid')
      expect(
        (await as(c, AAL2(s.cust), () => failure(c, `select public.cart_quote('teleport', null)`)))
          .message,
      ).toMatch(/invalid_fulfilment/)
    })
  })

  it('an empty cart quotes zero; a customer without two-step sign-in uses the cart; once they set it up, ordering needs aal2', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      await c.query('delete from auth.mfa_factors where user_id = $1', [s.cust])
      expect((await quote(c, AAL1(s.cust), 'pickup')).empty).toBe(true)
      await addToCart(c, AAL1(s.cust), s.p, 1)
      expect((await quote(c, AAL1(s.cust), 'pickup')).total_kobo).toBeGreaterThan(0)
      await c.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
         values (gen_random_uuid(), $1, 'test', 'totp', 'verified', now(), now())`,
        [s.cust],
      )
      expect(
        (
          await as(c, AAL1(s.cust), () =>
            failure(c, `select public.create_order('pickup', null, 'abcdefgh-1')`),
          )
        ).message,
      ).toMatch(/aal2/)
    })
  })

  it('enforces one vendor per cart with an explicit replace', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const other = await mkVendor(c, { owner: await createUser(c) })
      const op = await mkProduct(c, other.id)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const conflict = await addToCart(c, AAL2(s.cust), op, 1)
      expect(conflict).toEqual({ status: 'vendor_conflict' })
      expect(
        (
          await c.query(
            `select count(*)::int n from public.cart_items ci join public.carts k on k.id=ci.cart_id where k.user_id=$1`,
            [s.cust],
          )
        ).rows[0].n,
      ).toBe(1)
      expect(await addToCart(c, AAL2(s.cust), op, 1, [], true)).toEqual({ status: 'added' })
      const lines = (await quote(c, AAL2(s.cust), 'pickup')).lines
      expect(lines).toHaveLength(1)
      expect(lines[0].product_id).toBe(op)
      expect(
        (await c.query(`select vendor_id from public.carts where user_id=$1`, [s.cust])).rows[0]
          .vendor_id,
      ).toBe(other.id)
    })
  })

  it('merges identical lines (option order irrelevant), caps quantities, validates options and products', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const p2 = await mkProduct(c, s.v.id, { price: 100000 })
      const g = await mkOptionGroup(c, p2, {
        name: 'Extras',
        min: 0,
        max: 2,
        options: [
          { name: 'A', delta: 100 },
          { name: 'B', delta: 200 },
          { name: 'C', delta: 300, available: false },
        ],
      })
      const other = await mkProduct(c, s.v.id)
      const foreign = await mkOptionGroup(c, other, { options: [{ name: 'X', delta: 1 }] })
      await addToCart(c, AAL2(s.cust), p2, 2, [g.optionIds[0]!, g.optionIds[1]!])
      await addToCart(c, AAL2(s.cust), p2, 3, [g.optionIds[1]!, g.optionIds[0]!])
      const items = (
        await c.query(
          `select quantity from public.cart_items ci join public.carts k on k.id=ci.cart_id where k.user_id=$1`,
          [s.cust],
        )
      ).rows
      expect(items).toEqual([{ quantity: 5 }])
      await addToCart(c, AAL2(s.cust), p2, 20, [g.optionIds[0]!, g.optionIds[1]!])
      expect(
        (
          await c.query(
            `select quantity from public.cart_items ci join public.carts k on k.id=ci.cart_id where k.user_id=$1`,
            [s.cust],
          )
        ).rows,
      ).toEqual([{ quantity: 20 }]) // capped at max_cart_item_quantity
      const bad = async (qty: number, opts: string[], msg: RegExp, product = p2) =>
        expect(
          (
            await as(c, AAL2(s.cust), () =>
              failure(c, `select public.cart_add_item($1,$2,$3::uuid[],false)`, [
                product,
                qty,
                opts,
              ]),
            )
          ).message,
        ).toMatch(msg)
      await bad(0, [], /invalid_quantity/)
      await bad(-3, [], /invalid_quantity/)
      await bad(21, [], /invalid_quantity/)
      await bad(1, [g.optionIds[2]!], /option_unavailable/) // sold-out option
      await bad(1, [foreign.optionIds[0]!], /invalid_option/) // option of another product
      await bad(1, [randomUUID()], /invalid_option/)
      await bad(1, [g.optionIds[0]!, g.optionIds[0]!], /invalid_option/) // duplicate
      await bad(
        1,
        [g.optionIds[0]!, g.optionIds[1]!, g.optionIds[2]!],
        /option_unavailable|option_selection_invalid/,
      )
      const req = await mkProduct(c, s.v.id)
      const r = await mkOptionGroup(c, req, {
        min: 1,
        max: 1,
        options: [
          { name: 'S', delta: 0 },
          { name: 'L', delta: 1 },
        ],
      })
      await bad(1, [], /option_selection_invalid/, req) // required group missing
      await bad(1, r.optionIds, /option_selection_invalid/, req) // too many
      const gone = await mkProduct(c, s.v.id, { available: false })
      const arch = await mkProduct(c, s.v.id, { status: 'archived' })
      await bad(1, [], /product_unavailable/, gone)
      await bad(1, [], /product_unavailable/, arch)
      await bad(1, [], /product_unavailable/, randomUUID())
    })
  })

  it('set_quantity: only your own items; 0 removes and resets the vendor; bounds enforced', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const other = await createUser(c)
      await addToCart(c, AAL2(s.cust), s.p, 2)
      const item = (
        await c.query(
          `select ci.id from public.cart_items ci join public.carts k on k.id=ci.cart_id where k.user_id=$1`,
          [s.cust],
        )
      ).rows[0].id
      expect(
        (
          await as(c, AAL2(other), () =>
            failure(c, `select public.cart_set_quantity($1, 5)`, [item]),
          )
        ).message,
      ).toMatch(/unknown item/)
      expect(
        (
          await as(c, AAL2(s.cust), () =>
            failure(c, `select public.cart_set_quantity($1, 21)`, [item]),
          )
        ).message,
      ).toMatch(/invalid_quantity/)
      expect(
        (
          await as(c, AAL2(s.cust), () =>
            failure(c, `select public.cart_set_quantity($1, -1)`, [item]),
          )
        ).message,
      ).toMatch(/invalid_quantity/)
      await as(c, AAL2(s.cust), () => c.query(`select public.cart_set_quantity($1, 7)`, [item]))
      expect(
        (await c.query(`select quantity from public.cart_items where id=$1`, [item])).rows[0]
          .quantity,
      ).toBe(7)
      await as(c, AAL2(s.cust), () => c.query(`select public.cart_set_quantity($1, 0)`, [item]))
      expect(
        (await c.query(`select vendor_id from public.carts where user_id=$1`, [s.cust])).rows[0]
          .vendor_id,
      ).toBeNull()
    })
  })

  it('carts are private; privileged accounts need aal2 even for carts; non-customers and anon are refused', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const intruder = await createUser(c)
      const noCust = await createUser(c)
      await removeCustomerRole(c, noCust)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      expect(
        await as(
          c,
          AAL2(intruder),
          async () => (await c.query('select 1 from public.carts')).rowCount,
        ),
      ).toBe(0)
      expect(
        await as(
          c,
          AAL2(intruder),
          async () => (await c.query('select 1 from public.cart_items')).rowCount,
        ),
      ).toBe(0)
      expect(
        await as(
          c,
          AAL2(s.cust),
          async () => (await c.query('select 1 from public.carts')).rowCount,
        ),
      ).toBe(1)
      // the vendor owner is also a customer, but privileged => aal2 required everywhere
      expect(
        (
          await as(c, AAL1(s.owner), () =>
            failure(c, `select public.cart_add_item($1,1,'{}',false)`, [s.p]),
          )
        ).message,
      ).toMatch(/aal2/)
      expect(
        (
          await as(c, AAL2(noCust), () =>
            failure(c, `select public.cart_add_item($1,1,'{}',false)`, [s.p]),
          )
        ).message,
      ).toMatch(/forbidden/)
      expect(
        (await as(c, null, () => failure(c, `select public.cart_add_item($1,1,'{}',false)`, [s.p])))
          .code,
      ).toBe(PRIV_DENIED)
      for (const sql of [
        `insert into public.carts (user_id) values ('${intruder}')`,
        `update public.cart_items set quantity = 99`,
        `delete from public.carts`,
      ]) {
        expect((await as(c, AAL2(s.cust), () => failure(c, sql))).code, sql).toBe(PRIV_DENIED)
      }
    })
  })
})

describe('create_order', () => {
  it('creates an immutable snapshot order, decrements stock, records history and audit, and clears the cart', async () => {
    await withTx(async (c) => {
      const s = await shop(c, { stock: 10 })
      const g = await mkOptionGroup(c, s.p, {
        name: 'Protein',
        min: 1,
        max: 1,
        options: [
          { name: 'Chicken', delta: 50000 },
          { name: 'Beef', delta: 70000 },
        ],
      })
      await addToCart(c, AAL2(s.cust), s.p, 3, [g.optionIds[0]!])
      const id = await createOrderAs(c, AAL2(s.cust), 'delivery', s.point)
      const o = (await c.query(`select * from public.orders where id=$1`, [id])).rows[0]
      // unit 300000 x 3 = 900000 ; no customer fee ; delivery 50000 ; total 950000
      expect([
        o.items_total_kobo,
        o.delivery_fee_kobo,
        o.platform_fee_kobo,
        o.discount_kobo,
        o.total_kobo,
      ]).toEqual(['900000', '50000', '0', '0', '950000'])
      expect(o).toMatchObject({
        status: 'PENDING_PAYMENT',
        fulfilment: 'delivery',
        customer_id: s.cust,
        vendor_id: s.v.id,
        vendor_name: expect.any(String),
      })
      expect(o.order_number).toMatch(/^AFM-\d{6}$/)
      expect(new Date(o.expires_at).getTime()).toBeGreaterThan(Date.now() + 25 * 60000)
      expect(o.delivery_point_label).toMatch(/Sample point/)
      const items = (await c.query(`select * from public.order_items where order_id=$1`, [id])).rows
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        quantity: 3,
        unit_price_kobo: '300000',
        line_total_kobo: '900000',
        base_price_kobo: '250000',
      })
      expect(items[0].options).toEqual([
        expect.objectContaining({ name: 'Chicken', group: 'Protein', price_delta_kobo: 50000 }),
      ])
      expect(await stock(c, s.p)).toBe(7)
      expect(
        (
          await c.query(
            `select from_status, to_status, actor_id from public.order_status_history where order_id=$1`,
            [id],
          )
        ).rows,
      ).toEqual([{ from_status: null, to_status: 'PENDING_PAYMENT', actor_id: s.cust }])
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where action='order.created' and entity_id=$1 and actor_id=$2`,
            [id, s.cust],
          )
        ).rowCount,
      ).toBe(1)
      expect(
        (
          await c.query(
            `select count(*)::int n from public.cart_items ci join public.carts k on k.id=ci.cart_id where k.user_id=$1`,
            [s.cust],
          )
        ).rows[0].n,
      ).toBe(0)
      expect(
        (await c.query(`select vendor_id from public.carts where user_id=$1`, [s.cust])).rows[0]
          .vendor_id,
      ).toBeNull()
    })
  })

  it('pickup orders carry no delivery fee or point; the DB constraint ties totals together', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const id = await createOrderAs(c, AAL2(s.cust), 'pickup', s.point) // a point supplied for pickup is ignored
      const o = (await c.query(`select * from public.orders where id=$1`, [id])).rows[0]
      expect([
        o.fulfilment,
        o.delivery_point_id,
        o.delivery_point_label,
        o.delivery_fee_kobo,
        o.total_kobo,
      ]).toEqual(['pickup', null, null, '0', '250000'])
      expect(o.pickup_location_snapshot).toMatch(/Sample pickup/)
      expect(o.prep_minutes_snapshot).toBe(15)
      for (const sql of [
        `update public.orders set total_kobo = total_kobo + 1 where id='${id}'`,
        `update public.orders set delivery_fee_kobo = 5, total_kobo = total_kobo + 5 where id='${id}'`,
        `update public.orders set status = 'MADE_UP' where id='${id}'`,
      ])
        expect((await failure(c, sql)).code, sql).toBe('23514')
    })
  })

  it('ignores any client price: the order uses current database prices, and later price edits never change it', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      await c.query(`update public.products set price_kobo = 300000 where id=$1`, [s.p]) // vendor changes price after the customer added it
      const id = await createOrderAs(c, AAL2(s.cust), 'pickup')
      expect(
        (await c.query(`select items_total_kobo t from public.orders where id=$1`, [id])).rows[0].t,
      ).toBe('300000')
      await c.query(`update public.products set price_kobo = 999 where id=$1`, [s.p])
      expect(
        (await c.query(`select unit_price_kobo u from public.order_items where order_id=$1`, [id]))
          .rows[0].u,
      ).toBe('300000')
      // there is no way to pass a price: the function signature only takes fulfilment, point and key
      const sig = await c.query(
        `select pg_get_function_arguments('public.create_order(text,uuid,text)'::regprocedure) a`,
      )
      expect(sig.rows[0].a).toBe('p_fulfilment text, p_delivery_point uuid, p_idempotency_key text')
    })
  })

  it('refuses: aal1, anon, non-customers, empty cart, bad key, unknown fulfilment', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const noCust = await createUser(c)
      await removeCustomerRole(c, noCust)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const call = (who: ReturnType<typeof AAL2> | null, f = 'pickup', key = 'long-enough-key') =>
        as(c, who, () => failure(c, `select public.create_order($1, null, $2)`, [f, key]))
      expect((await call(AAL1(s.cust))).message).toMatch(/aal2/)
      expect((await call(null)).code).toBe(PRIV_DENIED)
      expect((await call(AAL2(noCust))).message).toMatch(/forbidden/)
      expect((await call(AAL2(s.cust), 'pickup', 'short')).message).toMatch(/idempotency/)
      expect((await call(AAL2(s.cust), 'teleport')).message).toMatch(/invalid_fulfilment/)
      expect(
        (
          await as(c, AAL2(await createUser(c)), () =>
            failure(c, `select public.create_order('pickup', null, 'long-enough-key')`),
          )
        ).message,
      ).toMatch(/cart_empty/)
      expect(await stock(c, s.p)).toBe(10) // nothing was consumed by the failures
    })
  })

  it.each([
    [
      'vendor closed',
      async (c: PoolClient, s: { v: { id: string }; p: string }) => {
        await c.query(`update public.vendors set temporarily_closed = true where id=$1`, [s.v.id])
      },
      'vendor_closed',
    ],
    [
      'vendor suspended',
      async (c: PoolClient, s: { v: { id: string }; p: string }) => {
        await c.query(`update public.vendors set status='suspended' where id=$1`, [s.v.id])
      },
      'vendor_unavailable',
    ],
    [
      'product unavailable',
      async (c: PoolClient, s: { v: { id: string }; p: string }) => {
        await c.query(`update public.products set is_available=false where id=$1`, [s.p])
      },
      'unavailable',
    ],
    [
      'product archived',
      async (c: PoolClient, s: { v: { id: string }; p: string }) => {
        await c.query(`update public.products set status='archived' where id=$1`, [s.p])
      },
      'unavailable',
    ],
    [
      'stock too low',
      async (c: PoolClient, s: { v: { id: string }; p: string }) => {
        await c.query(`update public.products set stock_quantity=1 where id=$1`, [s.p])
      },
      'out_of_stock',
    ],
  ])('blocks checkout when: %s', async (_name, mutate, code) => {
    await withTx(async (c) => {
      const s = await shop(c)
      await addToCart(c, AAL2(s.cust), s.p, 2)
      await mutate(c, s)
      const e = await as(c, AAL2(s.cust), () =>
        failure(c, `select public.create_order('pickup', null, 'long-enough-key')`),
      )
      expect(e.message).toBe('checkout_blocked')
      expect(JSON.parse(e.detail!).map((p: { code: string }) => p.code)).toContain(code)
      expect(
        (await c.query(`select 1 from public.orders where customer_id=$1`, [s.cust])).rowCount,
      ).toBe(0)
      expect(
        (
          await c.query(
            `select count(*)::int n from public.cart_items ci join public.carts k on k.id=ci.cart_id where k.user_id=$1`,
            [s.cust],
          )
        ).rows[0].n,
      ).toBe(1) // cart kept
    })
  })

  it('blocks checkout for delivery without a valid point, and for options that became unavailable', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const g = await mkOptionGroup(c, s.p, {
        min: 1,
        max: 1,
        options: [
          { name: 'A', delta: 0 },
          { name: 'B', delta: 0 },
        ],
      })
      await addToCart(c, AAL2(s.cust), s.p, 1, [g.optionIds[0]!])
      const noPoint = await as(c, AAL2(s.cust), () =>
        failure(c, `select public.create_order('delivery', null, 'long-enough-key')`),
      )
      expect(JSON.parse(noPoint.detail!)[0].code).toBe('delivery_point_invalid')
      const inactive = await mkDeliveryPoint(c, { active: false })
      expect(
        JSON.parse(
          (
            await as(c, AAL2(s.cust), () =>
              failure(c, `select public.create_order('delivery', $1, 'long-enough-key')`, [
                inactive,
              ]),
            )
          ).detail!,
        )[0].code,
      ).toBe('delivery_point_invalid')
      expect(
        JSON.parse(
          (
            await as(c, AAL2(s.cust), () =>
              failure(c, `select public.create_order('delivery', $1, 'long-enough-key')`, [
                randomUUID(),
              ]),
            )
          ).detail!,
        )[0].code,
      ).toBe('delivery_point_invalid')
      await c.query(`update public.product_options set is_available=false where id=$1`, [
        g.optionIds[0]!,
      ])
      const e = await as(c, AAL2(s.cust), () =>
        failure(c, `select public.create_order('pickup', null, 'long-enough-key')`),
      )
      expect(JSON.parse(e.detail!).map((p: { code: string }) => p.code)).toContain(
        'option_unavailable',
      )
    })
  })

  it('is idempotent per customer+key: same key returns the same order and consumes stock once', async () => {
    await withTx(async (c) => {
      const s = await shop(c, { stock: 5 })
      await addToCart(c, AAL2(s.cust), s.p, 2)
      const a = await createOrderAs(c, AAL2(s.cust), 'pickup', null, 'idem-key-0001')
      await addToCart(c, AAL2(s.cust), s.p, 1) // the cart now holds something new...
      const b = await createOrderAs(c, AAL2(s.cust), 'pickup', null, 'idem-key-0001') // ...but a replayed key returns the original order
      expect(b).toBe(a)
      expect(await stock(c, s.p)).toBe(3)
      expect(
        (
          await c.query(
            `select count(*)::int n from public.cart_items ci join public.carts k on k.id=ci.cart_id where k.user_id=$1`,
            [s.cust],
          )
        ).rows[0].n,
      ).toBe(1) // untouched
      const other = await createUser(c)
      await addToCart(c, AAL2(other), s.p, 1)
      const otherOrder = await createOrderAs(c, AAL2(other), 'pickup', null, 'idem-key-0001') // same key, different customer => separate order
      expect(otherOrder).not.toBe(a)
      const c2 = await createOrderAs(c, AAL2(s.cust), 'pickup', null, 'idem-key-0002')
      expect(c2).not.toBe(a)
    })
  })

  it('order numbers are unique and increasing', async () => {
    await withTx(async (c) => {
      const s = await shop(c)
      const nums: number[] = []
      for (let i = 0; i < 3; i++) {
        await addToCart(c, AAL2(s.cust), s.p, 1)
        const id = await createOrderAs(c, AAL2(s.cust))
        nums.push(
          Number(
            (
              await c.query(`select order_number n from public.orders where id=$1`, [id])
            ).rows[0].n.slice(4),
          ),
        )
      }
      expect(nums[1]! > nums[0]! && nums[2]! > nums[1]!).toBe(true)
    })
  })
})

describe('orders: access control and immutability', () => {
  async function placed(c: PoolClient) {
    const s = await shop(c)
    await addToCart(c, AAL2(s.cust), s.p, 1)
    const id = await createOrderAs(c, AAL2(s.cust), 'pickup')
    return { ...s, id }
  }
  const count = (c: PoolClient, who: ReturnType<typeof AAL2> | null, t = 'orders') =>
    as(c, who, async () => (await c.query(`select 1 from public.${t}`)).rowCount)

  it('customer sees only own orders (aal2 only); strangers, aal1 and anon see nothing', async () => {
    await withTx(async (c) => {
      const s = await placed(c)
      const stranger = await createUser(c)
      for (const t of ['orders', 'order_items', 'order_status_history']) {
        expect(await count(c, AAL2(s.cust), t), t).toBeGreaterThan(0)
        expect(await count(c, AAL1(s.cust), t), `${t} aal1`).toBe(0)
        expect(await count(c, AAL2(stranger), t), `${t} stranger`).toBe(0)
      }
      expect((await as(c, null, () => failure(c, 'select * from public.orders'))).code).toBe(
        PRIV_DENIED,
      )
    })
  })

  it('vendor members see their own vendor’s orders read-only; other vendors, aal1 and customers of others do not', async () => {
    await withTx(async (c) => {
      const s = await placed(c)
      const otherOwner = await createUser(c)
      await mkVendor(c, { owner: otherOwner })
      const staff = await createUser(c)
      await c.query(`insert into public.vendor_staff (vendor_id, user_id) values ($1,$2)`, [
        s.v.id,
        staff,
      ])
      await giveRole(c, staff, 'vendor_staff')
      for (const t of ['orders', 'order_items', 'order_status_history']) {
        expect(await count(c, AAL2(s.owner), t), t).toBeGreaterThan(0)
        expect(await count(c, AAL2(staff), t), `${t} staff`).toBeGreaterThan(0)
        expect(await count(c, AAL1(s.owner), t), `${t} aal1`).toBe(0)
        expect(await count(c, AAL2(otherOwner), t), `${t} other vendor`).toBe(0)
      }
      for (const sql of [
        `update public.orders set status='COMPLETED'`,
        `delete from public.orders`,
        `update public.order_items set quantity = 9`,
      ]) {
        expect((await as(c, AAL2(s.owner), () => failure(c, sql))).code, sql).toBe(PRIV_DENIED)
      }
      // payments are not visible to vendors
      expect(await count(c, AAL2(s.owner), 'payment_attempts')).toBe(0)
    })
  })

  it('admin/support/finance read at aal2; nobody can write rows directly', async () => {
    await withTx(async (c) => {
      const s = await placed(c)
      for (const role of ['platform_admin', 'support_agent', 'finance_admin']) {
        const u = await createUser(c)
        await giveRole(c, u, role)
        expect(await count(c, AAL2(u)), role).toBeGreaterThan(0)
        expect(await count(c, AAL1(u)), `${role} aal1`).toBe(0)
      }
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      for (const who of [AAL2(s.cust), AAL2(admin), null]) {
        for (const sql of [
          `insert into public.orders (order_number, customer_id, vendor_id, vendor_name, fulfilment, items_total_kobo, delivery_fee_kobo, platform_fee_kobo, total_kobo, idempotency_key) values ('AFM-1','${s.cust}','${s.v.id}','x','pickup',1,0,0,1,'abcdefgh')`,
          `update public.orders set status='COMPLETED'`,
          `delete from public.orders`,
          `insert into public.payment_attempts (order_id, provider, amount_kobo, status, idempotency_key) values ('${s.id}','mock',1,'succeeded','forged-1')`,
          `insert into public.order_status_history (order_id, to_status) values ('${s.id}','COMPLETED')`,
        ])
          expect((await as(c, who, () => failure(c, sql))).code, sql).toBe(PRIV_DENIED)
      }
    })
  })

  it('order items, history and payment attempts are immutable even for the table owner', async () => {
    await withTx(async (c) => {
      const s = await placed(c)
      for (const sql of [
        `update public.order_items set unit_price_kobo = 1, line_total_kobo = 1`,
        `update public.order_items set quantity = 2`,
        `delete from public.order_items`,
        `truncate public.order_items`,
        `update public.order_status_history set to_status = 'COMPLETED'`,
        `delete from public.order_status_history`,
      ])
        // truncating order_items is refused either by the immutability trigger or, since refunds/returns reference
        // the table (Batch 5), by the foreign key itself
        expect((await failure(c, sql)).message, sql).toMatch(
          /immutable|append-only|cannot truncate a table referenced/,
        )
      // deleting a product only nulls the link; the snapshot (name, price) is untouched
      await c.query(`delete from public.products where id=$1`, [s.p])
      const row = (
        await c.query(
          `select product_id, product_name, unit_price_kobo from public.order_items where order_id=$1`,
          [s.id],
        )
      ).rows[0]
      expect(row.product_id).toBeNull()
      expect(row.product_name).toMatch(/^Product /)
      expect(row.unit_price_kobo).toBe('250000')
    })
  })
})

describe('mock payment (fails closed) and cancellation', () => {
  it('the shipped migrations seed mock_payments_enabled = false (only the LOCAL seed file turns it on)', async () => {
    const { readFileSync } = await import('node:fs')
    const migration = readFileSync('supabase/migrations/20261011000002_cart_orders.sql', 'utf8')
    expect(migration).toMatch(/\('mock_payments_enabled', 'false'::jsonb/)
    expect(migration).not.toMatch(/'mock_payments_enabled', 'true'/)
    expect(readFileSync('supabase/seed.sql', 'utf8')).toMatch(/LOCAL ONLY/)
  })

  it('is refused while mock_payments_enabled is false', async () => {
    await withTx(async (c) => {
      await setSetting(c, 'mock_payments_enabled', false) // explicit precondition; the local seed turns it on
      const s = await shop(c)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const id = await createOrderAs(c, AAL2(s.cust))
      const e = await as(c, AAL2(s.cust), () =>
        failure(c, `select public.mock_pay_order($1)`, [id]),
      )
      expect(e.message).toMatch(/mock_payments_disabled/)
      expect(
        (await c.query(`select status from public.orders where id=$1`, [id])).rows[0].status,
      ).toBe('PENDING_PAYMENT')
      // and an administrator cannot switch it on from the application
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const sw = await as(c, AAL2(admin), () =>
        failure(
          c,
          `select public.set_platform_setting('mock_payments_enabled', 'true'::jsonb, 'Fixture reason for this test')`,
        ),
      )
      expect(sw.message).toMatch(/direct database access/)
    })
  })

  it('when enabled: only the order’s customer at aal2 can pay; payment is recorded, audited and idempotent', async () => {
    await withTx(async (c) => {
      await setSetting(c, 'mock_payments_enabled', true)
      const s = await shop(c)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const id = await createOrderAs(c, AAL2(s.cust))
      const stranger = await createUser(c)
      expect(
        (await as(c, AAL1(s.cust), () => failure(c, `select public.mock_pay_order($1)`, [id])))
          .message,
      ).toMatch(/aal2/)
      expect(
        (await as(c, AAL2(stranger), () => failure(c, `select public.mock_pay_order($1)`, [id])))
          .message,
      ).toMatch(/forbidden/)
      expect(
        (await as(c, AAL2(s.owner), () => failure(c, `select public.mock_pay_order($1)`, [id])))
          .message,
      ).toMatch(/forbidden/)
      expect(
        (await as(c, null, () => failure(c, `select public.mock_pay_order($1)`, [id]))).code,
      ).toBe(PRIV_DENIED)
      await as(c, AAL2(s.cust), () => c.query(`select public.mock_pay_order($1)`, [id]))
      await as(c, AAL2(s.cust), () => c.query(`select public.mock_pay_order($1)`, [id])) // replay: no error, no second payment
      expect(
        (await c.query(`select status from public.orders where id=$1`, [id])).rows[0].status,
      ).toBe('PAID')
      expect(
        (
          await c.query(
            `select provider, amount_kobo, status from public.payment_attempts where order_id=$1`,
            [id],
          )
        ).rows,
      ).toEqual([{ provider: 'mock', amount_kobo: '250000', status: 'succeeded' }])
      expect(
        (
          await c.query(
            `select to_status from public.order_status_history where order_id=$1 order by id`,
            [id],
          )
        ).rows.map((r) => r.to_status),
      ).toEqual(['PENDING_PAYMENT', 'PAID'])
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where action='order.mock_paid' and entity_id=$1`,
            [id],
          )
        ).rowCount,
      ).toBe(1)
      // customer can read their payment attempt; vendor cannot; a paid order cannot be cancelled by the customer
      expect(
        await as(
          c,
          AAL2(s.cust),
          async () => (await c.query('select 1 from public.payment_attempts')).rowCount,
        ),
      ).toBe(1)
      expect(
        (await as(c, AAL2(s.cust), () => failure(c, `select public.cancel_unpaid_order($1)`, [id])))
          .message,
      ).toMatch(/order_not_cancellable/)
    })
  })

  it('cancelled and expired orders are not payable', async () => {
    await withTx(async (c) => {
      await setSetting(c, 'mock_payments_enabled', true)
      const s = await shop(c)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const a = await createOrderAs(c, AAL2(s.cust))
      await as(c, AAL2(s.cust), () => c.query(`select public.cancel_unpaid_order($1)`, [a]))
      expect(
        (await as(c, AAL2(s.cust), () => failure(c, `select public.mock_pay_order($1)`, [a])))
          .message,
      ).toMatch(/order_not_payable/)
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const b = await createOrderAs(c, AAL2(s.cust))
      await c.query(
        `update public.orders set expires_at = now() - interval '1 minute' where id=$1`,
        [b],
      )
      expect(
        (await as(c, AAL2(s.cust), () => failure(c, `select public.mock_pay_order($1)`, [b])))
          .message,
      ).toMatch(/order_not_payable/)
    })
  })

  it('cancelling an unpaid order releases stock; only the owner may cancel; history records it', async () => {
    await withTx(async (c) => {
      const s = await shop(c, { stock: 5 })
      await addToCart(c, AAL2(s.cust), s.p, 3)
      const id = await createOrderAs(c, AAL2(s.cust))
      expect(await stock(c, s.p)).toBe(2)
      const stranger = await createUser(c)
      expect(
        (
          await as(c, AAL2(stranger), () =>
            failure(c, `select public.cancel_unpaid_order($1)`, [id]),
          )
        ).message,
      ).toMatch(/forbidden/)
      expect(
        (
          await as(c, AAL2(s.owner), () =>
            failure(c, `select public.cancel_unpaid_order($1)`, [id]),
          )
        ).message,
      ).toMatch(/forbidden/)
      expect(
        (await as(c, AAL1(s.cust), () => failure(c, `select public.cancel_unpaid_order($1)`, [id])))
          .message,
      ).toMatch(/aal2/)
      await as(c, AAL2(s.cust), () => c.query(`select public.cancel_unpaid_order($1)`, [id]))
      expect(await stock(c, s.p)).toBe(5)
      expect(
        (await c.query(`select status from public.orders where id=$1`, [id])).rows[0].status,
      ).toBe('CANCELLED')
      expect(
        (
          await c.query(
            `select reason from public.order_status_history where order_id=$1 and to_status='CANCELLED'`,
            [id],
          )
        ).rows[0].reason,
      ).toBe('customer_cancelled')
      expect(
        (await as(c, AAL2(s.cust), () => failure(c, `select public.cancel_unpaid_order($1)`, [id])))
          .message,
      ).toMatch(/order_not_cancellable/) // no double release
      expect(await stock(c, s.p)).toBe(5)
    })
  })

  it('expire_unpaid_orders (service role only) cancels overdue orders, releases stock once, and is repeatable', async () => {
    await withTx(async (c) => {
      const s = await shop(c, { stock: 6 })
      await addToCart(c, AAL2(s.cust), s.p, 2)
      const late = await createOrderAs(c, AAL2(s.cust))
      await addToCart(c, AAL2(s.cust), s.p, 1)
      const fresh = await createOrderAs(c, AAL2(s.cust))
      expect(await stock(c, s.p)).toBe(3)
      await c.query(
        `update public.orders set expires_at = now() - interval '5 minutes' where id=$1`,
        [late],
      )
      for (const who of [AAL2(s.cust), null])
        expect(
          (await as(c, who, () => failure(c, `select public.expire_unpaid_orders()`))).code,
        ).toBe(PRIV_DENIED)
      await c.query('set local role service_role')
      const n1 = (await c.query(`select public.expire_unpaid_orders() n`)).rows[0].n
      const n2 = (await c.query(`select public.expire_unpaid_orders() n`)).rows[0].n
      await c.query('reset role')
      expect([n1 >= 1, n2]).toEqual([true, 0])
      expect(
        (await c.query(`select status from public.orders where id=$1`, [late])).rows[0].status,
      ).toBe('CANCELLED')
      expect(
        (await c.query(`select status from public.orders where id=$1`, [fresh])).rows[0].status,
      ).toBe('PENDING_PAYMENT')
      expect(await stock(c, s.p)).toBe(5)
    })
  })
})

describe('configuration', () => {
  it('pricing settings accept only sane integers from a platform admin', async () => {
    await withTx(async (c) => {
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const set = (k: string, v: unknown) =>
        as(c, AAL2(admin), () =>
          failure(
            c,
            `select public.set_platform_setting($1, $2::jsonb, 'Fixture reason for this test')`,
            [k, JSON.stringify(v)],
          ),
        )
      expect((await set('platform_fee_bps', 1)).message).toMatch(/out of range/) // retired: pinned to 0
      expect((await set('vendor_commission_bps', 2001)).message).toMatch(/out of range/)
      expect((await set('commission_afit_bps', 2001)).message).toMatch(/out of range/)
      expect((await set('platform_fee_bps', -1)).message).toMatch(/invalid value/)
      expect((await set('platform_fee_bps', 5.5)).message).toMatch(/invalid value/)
      expect((await set('platform_fee_bps', '500')).message).toMatch(/invalid value/)
      expect((await set('delivery_fee_kobo', 1000001)).message).toMatch(/out of range/)
      expect((await set('unpaid_order_expiry_minutes', 1)).message).toMatch(/out of range/)
      expect((await set('max_cart_item_quantity', 0)).message).toMatch(/out of range/)
      await as(c, AAL2(admin), () =>
        c.query(
          `select public.set_platform_setting('vendor_commission_bps', '600'::jsonb, 'Fixture reason for this test')`,
        ),
      )
      expect(
        (
          await c.query(
            `select value from public.platform_settings where key='vendor_commission_bps'`,
          )
        ).rows[0].value,
      ).toBe(600)
      const cust = await createUser(c)
      expect(
        (
          await as(c, AAL2(cust), () =>
            failure(
              c,
              `select public.set_platform_setting('vendor_commission_bps','1'::jsonb, 'Fixture reason for this test')`,
            ),
          )
        ).message,
      ).toMatch(/forbidden/)
    })
  })
})
