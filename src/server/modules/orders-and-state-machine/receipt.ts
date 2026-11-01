import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { lagosDateTime } from '@/lib/time'
import type { HistoryRow, OrderItemRow, OrderRow } from './queries'

const ngn = (kobo: number) =>
  'NGN ' +
  (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Standard PDF fonts cover WinAnsi only; replace anything outside it so generation never throws.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

// AFIT Market colours (see docs/design-tokens.md), as 0..1 RGB.
const NAVY = rgb(0x07 / 255, 0x3b / 255, 0x7a / 255)
const GOLD = rgb(1, 0xc9 / 255, 0x28 / 255)
const INK = rgb(0x13 / 255, 0x1c / 255, 0x2b / 255)
const MUTED = rgb(0x44 / 255, 0x53 / 255, 0x6a / 255)
const LINE = rgb(0xcd / 255, 0xd6 / 255, 0xe4 / 255)
const TINT = rgb(0xe8 / 255, 0xf1 / 255, 0xfb / 255)
const SURFACE = rgb(0xf3 / 255, 0xf7 / 255, 0xfc / 255)
const WHITE = rgb(1, 1, 1)
const GREEN = rgb(0x17 / 255, 0x67 / 255, 0x3a / 255)
const GREEN_TINT = rgb(0xe5 / 255, 0xf4 / 255, 0xea / 255)
const WARN_TINT = rgb(1, 0xf4 / 255, 0xcf / 255)
const WARN = rgb(0x7a / 255, 0x54 / 255, 0)

const W = 595 // A4 portrait, in points
const H = 842
const M = 40 // side margin
const R = W - M

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completed',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
  PAID: 'Paid',
  VENDOR_REVIEW: 'Paid, waiting for the shop',
  ACCEPTED: 'Accepted',
  PREPARING: 'Being prepared',
  READY: 'Ready',
  PICKUP_AWAITING_HANDOVER: 'Ready for pickup',
  AWAITING_RIDER: 'Finding a rider',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP_BY_RIDER: 'Picked up',
  EN_ROUTE: 'On the way',
  ARRIVAL_DETECTED: 'Rider has arrived',
  AWAITING_RECIPIENT_PROOF: 'Waiting for your confirmation',
  DELIVERED: 'Delivered',
}
const statusLabel = (s: string) =>
  STATUS_LABEL[s] ??
  s
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase())

/** Money lines for an order, in one place so the receipt and its tests agree. Everything is in kobo. */
export function receiptTotals(
  o: Pick<
    OrderRow,
    | 'items_total_kobo'
    | 'delivery_fee_kobo'
    | 'delivery_fee_collection'
    | 'platform_fee_kobo'
    | 'discount_kobo'
    | 'total_kobo'
  >,
) {
  const direct = o.delivery_fee_collection === 'direct_to_rider' && o.delivery_fee_kobo > 0
  return {
    direct,
    items: o.items_total_kobo,
    discount: o.discount_kobo,
    serviceFee: o.platform_fee_kobo,
    /** Delivery included in the online total (Paystack-collected). */
    deliveryInTotal: direct ? 0 : o.delivery_fee_kobo,
    /** Delivery paid straight to the rider, outside the online total. */
    deliveryToRider: direct ? o.delivery_fee_kobo : 0,
    paidOnline: o.total_kobo,
    /** What the whole order costs the customer, delivery fee included wherever it was paid. */
    orderValue: o.total_kobo + (direct ? o.delivery_fee_kobo : 0),
  }
}

export async function buildReceiptPdf(a: {
  order: OrderRow
  items: OrderItemRow[]
  history: HistoryRow[]
  evidence: {
    recipient: string
    completedAt: string
    signaturePng: Uint8Array | null
    method: 'drawn' | 'typed_acknowledgement'
    typedText: string | null
    kind?: 'pickup' | 'delivery'
    arrivalAt?: string | null
  } | null
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`AFIT Market receipt ${a.order.order_number}`)
  doc.setAuthor('AFIT Market')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique)

  let page: PDFPage = doc.addPage([W, H])
  let y = H

  // ---- helpers ----
  const fit = (t: string, f: PDFFont, size: number, max: number) => {
    let s = safe(t)
    if (f.widthOfTextAtSize(s, size) <= max) return s
    while (s.length > 1 && f.widthOfTextAtSize(s + '...', size) > max) s = s.slice(0, -1)
    return s + '...'
  }
  const text = (
    t: string,
    x: number,
    yy: number,
    o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; max?: number } = {},
  ) => {
    const f = o.f ?? font
    const size = o.size ?? 10
    page.drawText(o.max ? fit(t, f, size, o.max) : safe(t), {
      x,
      y: yy,
      size,
      font: f,
      color: o.color ?? INK,
    })
  }
  const right = (
    t: string,
    xr: number,
    yy: number,
    o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const f = o.f ?? font
    const size = o.size ?? 10
    const s = safe(t)
    page.drawText(s, {
      x: xr - f.widthOfTextAtSize(s, size),
      y: yy,
      size,
      font: f,
      color: o.color ?? INK,
    })
  }
  const rect = (
    x: number,
    yy: number,
    w: number,
    h: number,
    color: ReturnType<typeof rgb>,
    border?: ReturnType<typeof rgb>,
  ) =>
    page.drawRectangle({
      x,
      y: yy,
      width: w,
      height: h,
      color,
      ...(border ? { borderColor: border, borderWidth: 0.8 } : {}),
    })
  const need = (h: number) => {
    if (y - h < 70) {
      page = doc.addPage([W, H])
      y = H - 50
    }
  }

  // ---- header band ----
  rect(0, H - 104, W, 104, NAVY)
  rect(0, H - 108, W, 4, GOLD)
  // brand mark: white tile with a navy "A" and a gold underline
  rect(M, H - 76, 40, 40, WHITE)
  page.drawSvgPath('M20 3 L3 37 L11 37 L14 30 L26 30 L29 37 L37 37 Z', {
    x: M,
    y: H - 36,
    scale: 1,
    color: NAVY,
    borderWidth: 0,
  })
  rect(M + 4, H - 74, 32, 3, GOLD)
  text('AFIT Market', M + 54, H - 54, { f: bold, size: 22, color: WHITE })
  text('Campus marketplace, Kaduna', M + 54, H - 72, { size: 9.5, color: rgb(0.86, 0.91, 0.97) })
  right('RECEIPT', R, H - 50, { f: bold, size: 11, color: GOLD })
  right(a.order.order_number, R, H - 72, { f: bold, size: 20, color: WHITE })
  y = H - 108 - 22

  // ---- test-mode note ----
  rect(M, y - 18, R - M, 22, WARN_TINT)
  text('TEST MODE: this is a rehearsal order. No real money was moved.', M + 10, y - 11, {
    f: bold,
    size: 8.5,
    color: WARN,
  })
  y -= 40

  // ---- order facts, two columns ----
  const colB = M + (R - M) / 2 + 10
  const fact = (label: string, value: string, x: number, yy: number, max = 230) => {
    text(label.toUpperCase(), x, yy, { f: bold, size: 7.5, color: MUTED })
    text(value, x, yy - 13, { size: 10.5, max })
  }
  fact('Shop', a.order.vendor_name, M, y)
  fact('Placed', lagosDateTime(a.order.created_at), colB, y)
  y -= 38
  fact(
    a.order.fulfilment === 'delivery' ? 'Delivered to' : 'Collected from',
    a.order.fulfilment === 'delivery'
      ? (a.order.delivery_point_label ?? 'Delivery point')
      : (a.order.pickup_location_snapshot ?? 'Shop pickup counter'),
    M,
    y,
  )
  text('STATUS', colB, y, { f: bold, size: 7.5, color: MUTED })
  const label = statusLabel(a.order.status)
  const pillW = bold.widthOfTextAtSize(safe(label), 9) + 18
  const done = a.order.status === 'COMPLETED'
  rect(colB, y - 18, pillW, 16, done ? GREEN_TINT : TINT)
  text(label, colB + 9, y - 13, { f: bold, size: 9, color: done ? GREEN : NAVY })
  y -= 30

  // ---- items table ----
  need(120)
  rect(M, y - 20, R - M, 22, NAVY)
  text('ITEM', M + 10, y - 13, { f: bold, size: 8, color: WHITE })
  right('QTY', R - 190, y - 13, { f: bold, size: 8, color: WHITE })
  right('PRICE', R - 100, y - 13, { f: bold, size: 8, color: WHITE })
  right('TOTAL', R - 10, y - 13, { f: bold, size: 8, color: WHITE })
  y -= 22
  a.items.forEach((i, idx) => {
    const opts = i.options.length ? i.options.map((o) => o.name).join(', ') : ''
    const h = opts ? 30 : 22
    need(h + 4)
    if (idx % 2 === 1) rect(M, y - h + 2, R - M, h, SURFACE)
    text(i.product_name, M + 10, y - 13, { f: bold, size: 10, max: 270 })
    if (opts) text(opts, M + 10, y - 25, { size: 8, color: MUTED, max: 300 })
    right(String(i.quantity), R - 190, y - 13)
    right(ngn(i.unit_price_kobo), R - 100, y - 13)
    right(ngn(i.line_total_kobo), R - 10, y - 13, { f: bold })
    y -= h
  })
  page.drawLine({ start: { x: M, y: y + 2 }, end: { x: R, y: y + 2 }, thickness: 0.8, color: LINE })
  y -= 12

  // ---- totals ----
  const t = receiptTotals(a.order)
  const lines: { l: string; v: string; color?: ReturnType<typeof rgb> }[] = [
    { l: 'Items', v: ngn(t.items) },
  ]
  if (t.deliveryInTotal > 0) lines.push({ l: 'Delivery fee', v: ngn(t.deliveryInTotal) })
  if (t.serviceFee > 0) lines.push({ l: 'Service fee (earlier order)', v: ngn(t.serviceFee) })
  if (t.discount > 0) lines.push({ l: 'Discount', v: '- ' + ngn(t.discount), color: GREEN })
  need(lines.length * 18 + 90)
  const bx = R - 250
  for (const ln of lines) {
    text(ln.l, bx, y - 12, { size: 10, color: MUTED })
    right(ln.v, R, y - 12, { color: ln.color })
    y -= 18
  }
  y -= 4
  rect(bx - 10, y - 34, R - bx + 10, 38, NAVY)
  text(t.direct ? 'TOTAL PAID ONLINE' : 'TOTAL PAID', bx, y - 14, {
    f: bold,
    size: 8.5,
    color: GOLD,
  })
  right(ngn(t.paidOnline), R - 10, y - 22, { f: bold, size: 15, color: WHITE })
  y -= 50

  if (t.direct) {
    need(70)
    rect(M, y - 52, R - M, 56, TINT)
    rect(M, y - 52, 4, 56, GOLD)
    text('Delivery fee paid to your rider', M + 16, y - 14, { f: bold, size: 10, color: NAVY })
    right(ngn(t.deliveryToRider), R - 12, y - 14, { f: bold, size: 10, color: NAVY })
    text(
      'You send this directly to the rider by bank transfer after delivery. It is not part of the online total above.',
      M + 16,
      y - 29,
      { size: 8.5, color: MUTED, max: R - M - 32 },
    )
    text(`Whole order, delivery fee included: ${ngn(t.orderValue)}`, M + 16, y - 43, {
      size: 8.5,
      color: MUTED,
    })
    y -= 70
  }

  // ---- delivery / handover confirmation ----
  if (a.evidence) {
    const ev = a.evidence
    const delivery = ev.kind === 'delivery'
    const drawn = ev.method !== 'typed_acknowledgement' && !!ev.signaturePng
    need(drawn ? 200 : 120)
    text(delivery ? 'DELIVERY CONFIRMED BY THE RECIPIENT' : 'HANDOVER CONFIRMED', M, y - 4, {
      f: bold,
      size: 8.5,
      color: NAVY,
    })
    page.drawLine({
      start: { x: M, y: y - 9 },
      end: { x: R, y: y - 9 },
      thickness: 1.2,
      color: GOLD,
    })
    y -= 28
    fact('Received by', ev.recipient, M, y)
    fact('Confirmed', lagosDateTime(ev.completedAt), colB, y)
    y -= 36
    if (delivery && ev.arrivalAt) {
      fact('Rider arrival detected', lagosDateTime(ev.arrivalAt), M, y)
      y -= 36
    }
    text(drawn ? 'RECIPIENT SIGNATURE' : 'ACKNOWLEDGEMENT (TYPED, NOT A DRAWN SIGNATURE)', M, y, {
      f: bold,
      size: 7.5,
      color: MUTED,
    })
    y -= 6
    if (drawn) {
      try {
        const img = await doc.embedPng(ev.signaturePng!)
        const maxW = 230
        const maxH = 80
        const scale = Math.min(maxW / img.width, maxH / img.height)
        const w = img.width * scale
        const h = img.height * scale
        rect(M, y - h - 16, maxW + 20, h + 16, WHITE, LINE)
        page.drawImage(img, { x: M + 10, y: y - h - 8, width: w, height: h })
        y -= h + 24
      } catch {
        text('(signature image unavailable)', M, y - 14, { f: oblique, size: 9, color: MUTED })
        y -= 24
      }
    } else {
      rect(M, y - 34, R - M, 34, WHITE, LINE)
      text(ev.typedText ?? '', M + 10, y - 21, { f: oblique, size: 10.5, max: R - M - 20 })
      y -= 46
    }
  }

  // ---- footer on every page ----
  const pages = doc.getPages()
  pages.forEach((p, n) => {
    p.drawLine({ start: { x: M, y: 52 }, end: { x: R, y: 52 }, thickness: 0.8, color: LINE })
    p.drawText('Thank you for ordering on AFIT Market.', {
      x: M,
      y: 38,
      size: 9,
      font: bold,
      color: NAVY,
    })
    p.drawText(
      safe(
        `Order ${a.order.order_number}  |  Generated ${lagosDateTime(new Date())} (Nigeria time)  |  Page ${n + 1} of ${pages.length}`,
      ),
      {
        x: M,
        y: 26,
        size: 7.5,
        font,
        color: MUTED,
      },
    )
    const help = 'Problem with this order? Open it in the app and choose Get help.'
    p.drawText(help, {
      x: R - font.widthOfTextAtSize(help, 7.5),
      y: 26,
      size: 7.5,
      font,
      color: MUTED,
    })
  })
  return doc.save()
}
