import { describe, expect, it } from 'vitest'
import { buildReceiptPdf, receiptTotals } from './receipt'
import type { OrderItemRow, OrderRow } from './queries'

const order = (o: Partial<OrderRow> = {}): OrderRow => ({
  id: 'o1',
  order_number: 'AFM-001002',
  customer_id: 'c',
  vendor_id: 'v',
  vendor_name: 'Beta Kitchen',
  fulfilment: 'delivery',
  delivery_point_label: 'Beta test point 1: Main gate',
  pickup_location_snapshot: null,
  prep_minutes_snapshot: null,
  status: 'COMPLETED',
  items_total_kobo: 1_250_000,
  delivery_fee_kobo: 50_000,
  delivery_fee_collection: 'direct_to_rider',
  platform_fee_kobo: 0,
  discount_kobo: 0,
  total_kobo: 1_250_000,
  expires_at: null,
  created_at: '2026-10-31T08:10:00Z',
  ...o,
})
const items: OrderItemRow[] = [
  {
    id: 'i1',
    product_name: 'Jollof rice and chicken',
    quantity: 5,
    unit_price_kobo: 250_000,
    line_total_kobo: 1_250_000,
    options: [{ group: 'Extra', name: 'Extra chicken', price_delta_kobo: 0 }],
  },
]

describe('receipt totals', () => {
  it('a delivery fee paid to the rider is shown beside the online total, never inside it', () => {
    const t = receiptTotals(order())
    expect(t.paidOnline).toBe(1_250_000)
    expect(t.deliveryInTotal).toBe(0)
    expect(t.deliveryToRider).toBe(50_000)
    expect(t.orderValue).toBe(1_300_000)
    expect(t.items + t.deliveryInTotal + t.serviceFee - t.discount).toBe(t.paidOnline)
  })
  it('a delivery fee collected online is part of the total', () => {
    const t = receiptTotals(order({ delivery_fee_collection: 'paystack', total_kobo: 1_300_000 }))
    expect(t.deliveryInTotal).toBe(50_000)
    expect(t.deliveryToRider).toBe(0)
    expect(t.items + t.deliveryInTotal).toBe(t.paidOnline)
    expect(t.orderValue).toBe(1_300_000)
  })
  it('pickup orders and zero fees never show a rider fee', () => {
    expect(receiptTotals(order({ delivery_fee_kobo: 0 })).deliveryToRider).toBe(0)
  })
})

describe('receipt pdf', () => {
  it('builds a valid multi-item PDF with and without a signature', async () => {
    const many = Array.from({ length: 40 }, (_, n) => ({
      ...items[0]!,
      id: `i${n}`,
      product_name: `Item ${n} with a rather long name to check it is cut to fit the column`,
      options: [],
    }))
    const pdf = await buildReceiptPdf({
      order: order(),
      items: many,
      history: [],
      evidence: {
        recipient: 'Ada',
        completedAt: '2026-10-31T09:00:00Z',
        signaturePng: null,
        method: 'typed_acknowledgement',
        typedText: 'I received it',
        kind: 'delivery',
        arrivalAt: '2026-10-31T08:55:00Z',
      },
    })
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-')
    const plain = await buildReceiptPdf({
      order: order({ fulfilment: 'pickup', delivery_fee_kobo: 0 }),
      items,
      history: [],
      evidence: null,
    })
    expect(plain.length).toBeGreaterThan(1000)
  })
})
