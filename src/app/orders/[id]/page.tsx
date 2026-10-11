import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { OrderStatusPill, ORDER_STATES } from '@/components/domain/order-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { Timeline } from '@/components/ui/timeline'
import { mockPaymentsAllowed } from '@/lib/env'
import { cancelOrderAction, mockPayAction } from '@/server/modules/cart-and-checkout/actions'
import { getOrder } from '@/server/modules/orders-and-state-machine/queries'

export const metadata: Metadata = { title: 'Order' }

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const found = await getOrder((await params).id)
  if (!found) notFound()
  const { order, items, history, payments } = found
  const unpaid = order.status === 'PENDING_PAYMENT'
  const label = (c: string) => ORDER_STATES.find((s) => s.code === c)?.label ?? c
  return (
    <>
      <p className="mb-2"><Link href="/orders" className="font-semibold text-brand-700 underline">← My orders</Link></p>
      <PageHeader title={order.order_number} subtitle={`${order.vendor_name} · ${order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}`} actions={<OrderStatusPill code={order.status} />} />
      <p className="mb-4">{ORDER_STATES.find((s) => s.code === order.status)?.meaning}</p>

      {unpaid && (
        <Card className="mb-5 space-y-3 border-warning-700">
          <h2 className="text-lg font-bold">Payment needed</h2>
          <p>Total to pay: <Money kobo={order.total_kobo} className="font-bold" />{order.expires_at && <span className="text-sm text-muted"> · hold ends {new Date(order.expires_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</span>}</p>
          <div className="flex flex-wrap gap-3">
            {mockPaymentsAllowed() ? (
              <form action={mockPayAction}><input type="hidden" name="orderId" value={order.id} /><Button type="submit">Pay (test only, no real money)</Button></form>
            ) : <p className="font-medium text-warning-700">Online payment is not open yet.</p>}
            <form action={cancelOrderAction}><input type="hidden" name="orderId" value={order.id} /><Button type="submit" variant="secondary">Cancel order</Button></form>
          </div>
          {mockPaymentsAllowed() && <p className="text-xs text-muted"><Badge tone="warning">Test mode</Badge> This is a rehearsal. Real card payment arrives in a later release.</p>}
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Items</h2>
          <ul className="space-y-2">{items.map((i) => (
            <li key={i.id} className="flex justify-between gap-2"><span>{i.quantity} × {i.product_name}{i.options.length > 0 && <span className="block text-sm text-muted">{i.options.map((o) => o.name).join(', ')}</span>}</span><Money kobo={i.line_total_kobo} /></li>))}</ul>
          <hr className="border-line" />
          <dl className="space-y-1">
            <div className="flex justify-between"><dt>Items</dt><dd><Money kobo={order.items_total_kobo} /></dd></div>
            <div className="flex justify-between"><dt>Delivery</dt><dd><Money kobo={order.delivery_fee_kobo} /></dd></div>
            <div className="flex justify-between"><dt>Service fee</dt><dd><Money kobo={order.platform_fee_kobo} /></dd></div>
            <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd><Money kobo={order.total_kobo} /></dd></div>
          </dl>
          {order.fulfilment === 'delivery' ? <p className="text-sm"><strong>Deliver to:</strong> {order.delivery_point_label}</p> : <p className="text-sm"><strong>Collect from:</strong> {order.pickup_location_snapshot ?? order.vendor_name}{order.prep_minutes_snapshot ? ` · ready in about ${order.prep_minutes_snapshot} min` : ''}</p>}
          {payments.length > 0 && <p className="text-sm text-muted">Payment: {payments.map((p) => `${p.provider === 'mock' ? 'Test payment' : p.provider} ${p.status}`).join(', ')}</p>}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Progress</h2>
          <Timeline steps={history.map((h, i) => ({ label: label(h.to_status), detail: new Date(h.created_at).toLocaleString('en-NG'), state: i === history.length - 1 ? 'current' : 'done' }))} />
        </Card>
      </div>
    </>
  )
}
