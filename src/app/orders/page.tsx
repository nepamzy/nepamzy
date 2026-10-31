import { lagosDate } from '@/lib/time'
import type { Metadata } from 'next'
import Link from 'next/link'
import { OrderStatusPill } from '@/components/domain/order-status'
import { ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/card'
import { cn } from '@/components/ui/cn'
import { DataTable } from '@/components/ui/data-table'
import { Money } from '@/components/ui/money'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { listOrdersPage } from '@/server/modules/orders-and-state-machine/queries'

export const metadata: Metadata = { title: 'My orders' }

const VIEWS = [
  ['all', 'All orders'],
  ['active', 'In progress'],
  ['finished', 'Finished'],
] as const

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; view?: string }>
}) {
  const sp = await searchParams
  const n = Number(sp.page)
  const page = Number.isInteger(n) && n >= 1 ? n : 1
  const view = VIEWS.some(([v]) => v === sp.view) ? sp.view! : 'all'
  const { orders, hasMore } = await listOrdersPage({
    page,
    pageSize: 25,
    ...(view === 'active' ? { finished: false } : view === 'finished' ? { finished: true } : {}),
  })
  return (
    <>
      <PageHeader
        title="My orders"
        subtitle="Track and manage your orders"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Orders' }]}
      />
      <nav aria-label="Order filter" className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map(([v, label]) => (
          <Link
            key={v}
            href={v === 'all' ? '/orders' : `/orders?view=${v}`}
            aria-current={view === v ? 'true' : undefined}
            className={cn(
              'touch-target inline-flex items-center rounded-full border px-4 text-sm font-bold',
              view === v
                ? 'border-navy-900 bg-navy-900 text-white'
                : 'border-line-strong bg-card text-navy-900 hover:bg-brand-50',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <DataTable
        caption="Your orders"
        rows={orders}
        rowKey={(o) => o.id}
        empty={
          page === 1 ? (
            <EmptyState
              title={view === 'all' ? 'No orders yet' : 'No orders here'}
              icon="package"
              action={
                <ButtonLink href="/products" variant="gold">
                  Browse items
                </ButtonLink>
              }
            >
              {view === 'all' ? 'Your orders will appear here.' : 'Try another filter.'}
            </EmptyState>
          ) : (
            <p className="text-muted">There are no orders on this page.</p>
          )
        }
        columns={[
          {
            header: 'Order',
            cell: (o) => (
              <Link className="font-bold text-brand-700 hover:underline" href={`/orders/${o.id}`}>
                {o.order_number}
              </Link>
            ),
          },
          { header: 'Shop', cell: (o) => o.vendor_name },
          { header: 'Type', cell: (o) => (o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup') },
          { header: 'Date', cell: (o) => lagosDate(o.created_at) },
          {
            header: 'Total',
            align: 'right',
            cell: (o) => <Money kobo={o.total_kobo} className="font-bold" />,
          },
          { header: 'Status', cell: (o) => <OrderStatusPill code={o.status} /> },
          {
            header: 'Actions',
            cell: (o) => (
              <Link className="font-bold text-brand-700 hover:underline" href={`/orders/${o.id}`}>
                View
              </Link>
            ),
          },
        ]}
      />
      <Pager
        basePath="/orders"
        page={page}
        hasMore={hasMore}
        params={view === 'all' ? {} : { view }}
      />
    </>
  )
}
