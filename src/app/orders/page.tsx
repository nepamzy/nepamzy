import type { Metadata } from 'next'
import { Card, PageHeader, SampleDataNote } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { OrderStatusPill, ORDER_STATES } from '@/components/domain/order-status'
import { MOCK_ORDERS } from '@/mocks/data'

export const metadata: Metadata = { title: 'My orders' }

export default function OrdersPage() {
  return (
    <>
      <PageHeader title="My orders" />
      <SampleDataNote />
      <ul className="space-y-3">
        {MOCK_ORDERS.map((o) => {
          const meaning = ORDER_STATES.find((s) => s.code === o.status)?.meaning
          return (
            <li key={o.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {o.id} · {o.vendor}
                  </p>
                  <OrderStatusPill code={o.status} />
                </div>
                <p className="mt-1 text-muted">
                  {o.mode} · <Money kobo={o.totalKobo} />
                </p>
                {meaning && <p className="mt-1 text-sm">{meaning}</p>}
              </Card>
            </li>
          )
        })}
      </ul>
    </>
  )
}
