import type { Metadata } from 'next'
import Link from 'next/link'
import { OrderStatusPill, ORDER_STATES } from '@/components/domain/order-status'
import { PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { LinkTabs } from '@/components/ui/list-controls'
import { Money } from '@/components/ui/money'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { listOrdersPage } from '@/server/modules/orders-and-state-machine/queries'

export const metadata: Metadata = { title: 'Orders' }

const TABS = [
  ['all', 'All'],
  ['active', 'In progress'],
  ['finished', 'Finished'],
] as const

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; status?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 30)
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'all'
  const status = ORDER_STATES.some((s) => s.code === sp.status) ? sp.status! : undefined
  const n = Number(sp.page)
  const page = Number.isInteger(n) && n >= 1 ? n : 1
  const { orders, hasMore } = await listOrdersPage({
    page,
    pageSize: 25,
    q,
    ...(status
      ? { statuses: [status] }
      : tab === 'active'
        ? { finished: false }
        : tab === 'finished'
          ? { finished: true }
          : {}),
  })
  const href = (k: string) =>
    `/admin/orders?${new URLSearchParams({ ...(q ? { q } : {}), ...(k === 'all' ? {} : { tab: k }) })}`
  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Every order on the platform"
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Orders' }]}
      />
      <LinkTabs
        label="Order group"
        active={status ? '' : tab}
        tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: href(k) }))}
      />
      <form
        action="/admin/orders"
        method="get"
        role="search"
        className="mb-4 flex flex-wrap items-end gap-2"
      >
        <label className="min-w-0 flex-1 text-sm font-semibold">
          Order number
          <input
            name="q"
            defaultValue={q}
            maxLength={30}
            placeholder="For example AFT-1001"
            className="touch-target mt-1 block w-full rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2 text-base font-normal"
          />
        </label>
        <label className="text-sm font-semibold">
          Status
          <select
            name="status"
            defaultValue={status ?? ''}
            className="touch-target mt-1 block rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2 text-base font-normal"
          >
            <option value="">Any</option>
            {ORDER_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="touch-target rounded-[var(--radius-control)] border border-line-strong bg-card px-4 font-bold hover:bg-brand-50"
        >
          Filter
        </button>
      </form>
      <DataTable
        caption="Orders"
        rows={orders}
        rowKey={(o) => o.id}
        empty={
          <EmptyState title="No orders match" icon="package">
            Try another search, status or tab.
          </EmptyState>
        }
        columns={[
          {
            header: 'Order',
            cell: (o) => (
              <Link
                className="font-bold text-brand-700 hover:underline"
                href={`/admin/orders/${o.id}`}
              >
                {o.order_number}
              </Link>
            ),
          },
          { header: 'Shop', cell: (o) => o.vendor_name },
          { header: 'Type', cell: (o) => (o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup') },
          { header: 'Total', align: 'right', cell: (o) => <Money kobo={o.total_kobo} /> },
          { header: 'Status', cell: (o) => <OrderStatusPill code={o.status} /> },
          { header: 'Placed', cell: (o) => new Date(o.created_at).toLocaleString('en-NG') },
        ]}
      />
      <Pager
        basePath="/admin/orders"
        page={page}
        hasMore={hasMore}
        params={{ q: q || undefined, tab: tab === 'all' ? undefined : tab, status }}
      />
    </>
  )
}
