import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { OrderStatusPill, ORDER_STATES } from '@/components/domain/order-status'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { StatusBadge } from '@/components/ui/status-badge'
import { Timeline } from '@/components/ui/timeline'
import {
  getOrder,
  listPaymentTransactions,
} from '@/server/modules/orders-and-state-machine/queries'

export const metadata: Metadata = { title: 'Order' }

export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const found = await getOrder((await params).id)
  if (!found) notFound()
  const { order, items, history, payments } = found
  const txns = await listPaymentTransactions(order.id)
  const label = (c: string) => ORDER_STATES.find((s) => s.code === c)?.label ?? c
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex flex-wrap justify-between gap-2 py-1.5">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  )
  return (
    <>
      <PageHeader
        title={order.order_number}
        subtitle={`${order.vendor_name} · ${order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}`}
        breadcrumbs={[
          { label: 'Administration', href: '/admin' },
          { label: 'Orders', href: '/admin/orders' },
          { label: order.order_number },
        ]}
        actions={<OrderStatusPill code={order.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-lg font-extrabold text-navy-900">Items and price breakdown</h2>
            <ul className="space-y-2">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span>
                    {i.quantity} × {i.product_name}
                    {i.options.length > 0 && (
                      <span className="block text-sm text-muted">
                        {i.options.map((o) => o.name).join(', ')}
                      </span>
                    )}
                  </span>
                  <Money kobo={i.line_total_kobo} />
                </li>
              ))}
            </ul>
            <hr className="my-3 border-line" />
            <dl>
              {row('Items', <Money kobo={order.items_total_kobo} />)}
              {row(
                'Delivery fee',
                <>
                  <Money kobo={order.delivery_fee_kobo} />{' '}
                  {order.delivery_fee_kobo > 0 && (
                    <span className="text-sm text-muted">
                      (
                      {order.delivery_fee_collection === 'direct_to_rider'
                        ? 'paid directly to the rider'
                        : 'collected with the order'}
                      )
                    </span>
                  )}
                </>,
              )}
              {order.discount_kobo > 0 && row('Discount', <Money kobo={order.discount_kobo} />)}
              {order.platform_fee_kobo > 0 &&
                row('Service fee (older orders)', <Money kobo={order.platform_fee_kobo} />)}
              {row('Total', <Money kobo={order.total_kobo} className="font-extrabold" />)}
            </dl>
          </Card>
          <Card>
            <h2 className="mb-2 text-lg font-extrabold text-navy-900">Payment records</h2>
            {payments.length === 0 && txns.length === 0 ? (
              <p className="text-muted">No payment has been recorded for this order.</p>
            ) : (
              <ul className="space-y-2">
                {payments.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {p.provider === 'mock' ? 'Test payment' : p.provider} ·{' '}
                      <Money kobo={p.amount_kobo} />
                    </span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
                {txns.map((t, i) => (
                  <li key={`t${i}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span>Paystack transaction</span>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm text-muted">
              Reconciliation and refunds:{' '}
              <Link href="/admin/payments" className="font-bold text-brand-700 underline">
                Payments
              </Link>
              ,{' '}
              <Link href="/admin/refunds" className="font-bold text-brand-700 underline">
                Refunds
              </Link>
              ,{' '}
              <Link href="/admin/cases" className="font-bold text-brand-700 underline">
                Reports
              </Link>
              .
            </p>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-lg font-extrabold text-navy-900">Fulfilment</h2>
            <dl>
              {row('Type', order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup')}
              {order.fulfilment === 'delivery'
                ? row('Delivery point', order.delivery_point_label)
                : row('Pickup location', order.pickup_location_snapshot ?? order.vendor_name)}
              {row('Placed', new Date(order.created_at).toLocaleString('en-NG'))}
              {row(
                'Customer reference',
                <code className="text-sm">{order.customer_id.slice(0, 8)}</code>,
              )}
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-extrabold text-navy-900">Order timeline</h2>
            <Timeline
              steps={history.map((h, i) => ({
                label: label(h.to_status),
                detail:
                  new Date(h.created_at).toLocaleString('en-NG') +
                  (h.reason ? ` · ${h.reason}` : ''),
                state: i === history.length - 1 ? 'current' : 'done',
              }))}
            />
          </Card>
        </div>
      </div>
    </>
  )
}
