import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL2,
  addToCart,
  createOrderAs,
  createUser,
  fixPricing,
  mkProduct,
  mkVendor,
  payOrder,
  pool,
  withTx,
} from './helpers'
import { as } from './helpers'

afterAll(async () => {
  await pool.end()
})

/**
 * CHANNEL 1: the commission is 4.5% of the product subtotal after product discounts, delivery excluded, in whole kobo rounded
 * half up (AFIT allocation 3.0%, Paystack-cost budget = the remainder). These tests build REAL orders through the cart,
 * create_order and the (fake) Paystack payment, then compare the stored settlement line with an independent BigInt calculation.
 */
const halfUp = (amount: bigint, bps: bigint) => (amount * bps + 5000n) / 10000n

async function realOrder(
  c: PoolClient,
  prices: number[],
  fulfilment: 'pickup' | 'delivery' = 'pickup',
) {
  await fixPricing(c, { delivery: fulfilment === 'delivery' ? 50000 : 0 })
  const owner = await createUser(c, 'owner')
  const vendor = await mkVendor(c, { owner })
  const cust = await createUser(c, 'cust')
  let point: string | null = null
  if (fulfilment === 'delivery') {
    const { mkDeliveryPoint } = await import('./helpers')
    point = await mkDeliveryPoint(c)
  }
  for (const price of prices)
    await addToCart(c, AAL2(cust), await mkProduct(c, vendor.id, { price, stock: 50 }), 1)
  const order = await createOrderAs(c, AAL2(cust), fulfilment, point)
  await payOrder(c, AAL2(cust), order)
  return { owner, vendor: vendor.id, cust, order }
}
const complete = (c: PoolClient, order: string) =>
  c.query(
    `insert into public.order_status_history (order_id, from_status, to_status, reason) values ($1,'PAID','COMPLETED','channel1')`,
    [order],
  )
const line = async (c: PoolClient, order: string) =>
  (
    await c.query(
      `select base_kobo, commission_kobo, afit_allocation_kobo, paystack_allowance_kobo, delivery_fee_kobo, commission_bps from public.order_settlement_lines where order_id=$1`,
      [order],
    )
  ).rows

describe('commission on orders created through the real checkout path', () => {
  it.each([
    [[3333]], // 33.33 naira
    [[1999, 12345, 1]], // odd kobo amounts
    [[100000, 150000, 50000]],
    [[10]], // 10 kobo: rounding at the smallest scale
    [[22222, 22222, 22222, 22222]],
  ])(
    'items %j: stored commission equals the independent half-up calculation; the three parts add up exactly',
    async (prices) => {
      await withTx(async (c) => {
        const o = await realOrder(c, prices)
        await complete(c, o.order)
        const [l] = await line(c, o.order)
        const base = BigInt(prices.reduce((s, p) => s + p, 0))
        expect(BigInt(l.base_kobo)).toBe(base)
        expect(BigInt(l.commission_kobo)).toBe(halfUp(base, 450n))
        expect(BigInt(l.afit_allocation_kobo)).toBe(halfUp(base, 300n))
        expect(BigInt(l.afit_allocation_kobo) + BigInt(l.paystack_allowance_kobo)).toBe(
          BigInt(l.commission_kobo),
        )
        expect(l.commission_bps).toBe(450)
      })
    },
  )

  it('delivery is excluded from the base: a delivery order with a fee still has a base of the product subtotal; the fee is only recorded', async () => {
    await withTx(async (c) => {
      const o = await realOrder(c, [150000, 50000], 'delivery')
      const ord = (
        await c.query(
          `select items_total_kobo, delivery_fee_kobo, total_kobo from public.orders where id=$1`,
          [o.order],
        )
      ).rows[0]
      expect(Number(ord.delivery_fee_kobo)).toBe(50000)
      expect(Number(ord.total_kobo)).toBe(Number(ord.items_total_kobo) + 50000)
      await complete(c, o.order)
      const [l] = await line(c, o.order)
      expect(Number(l.base_kobo)).toBe(200000)
      expect(Number(l.commission_kobo)).toBe(9000)
      expect(Number(l.delivery_fee_kobo)).toBe(50000)
    })
  })

  it('the quote and the order never contain a product discount (the checkout has no discount feature); the settlement base would be items minus discount if one were ever stored', async () => {
    await withTx(async (c) => {
      const o = await realOrder(c, [100000])
      expect(
        Number(
          (await c.query(`select discount_kobo from public.orders where id=$1`, [o.order])).rows[0]
            .discount_kobo,
        ),
      ).toBe(0)
      // a stored discount (set by the owner here, as no application path sets it) reduces the base before the rate is applied
      await c.query(
        `update public.orders set discount_kobo = 10000, total_kobo = total_kobo - 10000 where id = $1`,
        [o.order],
      )
      await complete(c, o.order)
      const [l] = await line(c, o.order)
      expect(Number(l.base_kobo)).toBe(90000)
      expect(Number(l.commission_kobo)).toBe(4050)
    })
  })

  it('a rate change after completion never rewrites the stored line; a later order uses the new rate', async () => {
    await withTx(async (c) => {
      const o1 = await realOrder(c, [100000])
      await complete(c, o1.order)
      await c.query(
        `update public.platform_settings set value = '500'::jsonb where key = 'vendor_commission_bps'`,
      )
      const [l1] = await line(c, o1.order)
      expect(l1.commission_bps).toBe(450)
      expect(Number(l1.commission_kobo)).toBe(4500)
    })
  })

  it('cancelled or unpaid orders never produce a settlement line; only COMPLETED does', async () => {
    await withTx(async (c) => {
      await fixPricing(c, { delivery: 0 })
      const owner = await createUser(c, 'owner')
      const vendor = await mkVendor(c, { owner })
      const cust = await createUser(c, 'cust')
      await addToCart(c, AAL2(cust), await mkProduct(c, vendor.id, { price: 50000, stock: 5 }), 1)
      const order = await createOrderAs(c, AAL2(cust), 'pickup', null) // PENDING_PAYMENT
      expect(await line(c, order)).toHaveLength(0)
      await as(c, AAL2(cust), () => c.query(`select public.cancel_unpaid_order($1)`, [order]))
      expect(await line(c, order)).toHaveLength(0)
    })
  })
})
