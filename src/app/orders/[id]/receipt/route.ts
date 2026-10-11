import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { getHandoverEvidence, getOrder } from '@/server/modules/orders-and-state-machine/queries'
import { buildReceiptPdf } from '@/server/modules/orders-and-state-machine/receipt'

export const dynamic = 'force-dynamic'

/** PDF receipt. Route handlers sit outside layouts, so this checks access itself; RLS decides which order is visible. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { decision } = await checkAccess({ aal: 'aal2' })
  if (!decision.allow) return new Response('Sign in required', { status: 401 })
  const found = await getOrder((await ctx.params).id)
  if (!found) return new Response('Not found', { status: 404 })
  const { order, items, history } = found
  if (order.status === 'PENDING_PAYMENT' || order.status === 'CANCELLED')
    return new Response('No receipt for this order', { status: 404 })
  const ev = await getHandoverEvidence(order.id)
  const evidence = ev
    ? {
        recipient: ev.recipient_name,
        completedAt: ev.completed_at,
        signaturePng: Uint8Array.from(Buffer.from(ev.signature_png.replace(/^\\x/, ''), 'hex')),
      }
    : null
  const pdf = await buildReceiptPdf({ order, items, history, evidence })
  return new Response(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${order.order_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
