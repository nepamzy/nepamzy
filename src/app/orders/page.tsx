import type { Metadata } from 'next'
import Link from 'next/link'
import { OrderStatusPill, ORDER_STATES } from '@/components/domain/order-status'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { listOrders } from '@/server/modules/orders-and-state-machine/queries'

export const metadata: Metadata = { title: 'My orders' }

export default async function OrdersPage() {
  const orders = await listOrders()
  return (
    <>
      <PageHeader title="My orders" />
      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          action={<ButtonLink href="/vendors">Browse vendors</ButtonLink>}
        >
          Your orders will appear here.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    <Link className="hover:underline" href={`/orders/${o.id}`}>
                      {o.order_number}
                    </Link>{' '}
                    · {o.vendor_name}
                  </p>
                  <OrderStatusPill code={o.status} />
                </div>
                <p className="mt-1 text-muted">
                  {o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} ·{' '}
                  <Money kobo={o.total_kobo} /> · {new Date(o.created_at).toLocaleString('en-NG')}
                </p>
                <p className="mt-1 text-sm">
                  {ORDER_STATES.find((s) => s.code === o.status)?.meaning}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
