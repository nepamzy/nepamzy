import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { HistoryRow, OrderItemRow, OrderRow } from './queries'

const ngn = (kobo: number) =>
  'NGN ' +
  (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Standard PDF fonts cover WinAnsi only; replace anything outside it so generation never throws.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

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
  } | null
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([420, 700])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let y = 660
  const line = (t: string, o: { b?: boolean; size?: number; gap?: number; x?: number } = {}) => {
    page.drawText(safe(t), {
      x: o.x ?? 30,
      y,
      size: o.size ?? 10,
      font: o.b ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    })
    y -= o.gap ?? 15
  }
  const row = (l: string, r: string, b = false) => {
    page.drawText(safe(l), { x: 30, y, size: 10, font: b ? bold : font })
    const w = (b ? bold : font).widthOfTextAtSize(safe(r), 10)
    page.drawText(safe(r), { x: 390 - w, y, size: 10, font: b ? bold : font })
    y -= 15
  }
  line('AFIT Market - Receipt', { b: true, size: 16, gap: 24 })
  line('TEST MODE: no real money was moved.', { size: 9, gap: 20 })
  line(`Order ${a.order.order_number}`, { b: true })
  line(`Shop: ${a.order.vendor_name}`)
  line(`Placed: ${new Date(a.order.created_at).toLocaleString('en-NG')}`)
  line(
    a.order.fulfilment === 'delivery'
      ? `Delivery to: ${a.order.delivery_point_label ?? ''}`
      : 'Pickup',
    { gap: 22 },
  )
  for (const i of a.items) {
    row(`${i.quantity} x ${i.product_name}`, ngn(i.line_total_kobo))
    if (i.options.length)
      line('   ' + i.options.map((o) => o.name).join(', '), { size: 8, gap: 12 })
  }
  y -= 6
  row('Items', ngn(a.order.items_total_kobo))
  row('Delivery', ngn(a.order.delivery_fee_kobo))
  row('Service fee', ngn(a.order.platform_fee_kobo))
  row('Total', ngn(a.order.total_kobo), true)
  y -= 10
  line(`Status: ${a.order.status}`, { gap: 20 })
  if (a.evidence) {
    line('Handover', { b: true })
    line(`Received by: ${a.evidence.recipient}`)
    line(`At: ${new Date(a.evidence.completedAt).toLocaleString('en-NG')}`, { gap: 8 })
    if (a.evidence.method === 'typed_acknowledgement' || !a.evidence.signaturePng) {
      line('Capture: TYPED acknowledgement (not a drawn signature)')
      line(`Typed: ${a.evidence.typedText ?? ''}`)
      return doc.save()
    }
    line('Capture: drawn signature', { gap: 8 })
    try {
      const img = await doc.embedPng(a.evidence.signaturePng)
      const w = 200
      const h = (img.height / img.width) * w
      page.drawImage(img, { x: 30, y: y - h, width: w, height: h })
      y -= h + 10
    } catch {
      line('(signature image unavailable)')
    }
  }
  return doc.save()
}
