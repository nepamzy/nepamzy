import { lagosDateTime } from '@/lib/time'
import type { Metadata } from 'next'
import { StatusBadge } from '@/components/domain/delivery-fee-view'
import { RiderFreeNotice } from '@/components/domain/rider-free-notice'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard, MetricGrid } from '@/components/ui/metric-card'
import { Money } from '@/components/ui/money'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { getDeliveryHistory, getMyRider } from '@/server/modules/riders/queries'

export const metadata: Metadata = { title: 'Delivery history' }

const PAGE_SIZE = 20

export default async function RiderHistory({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const me = await getMyRider()
  if (!me)
    return (
      <EmptyState title="Your rider account is not available">Contact an administrator.</EmptyState>
    )
  const h = await getDeliveryHistory(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
  const rows = h.rows.slice(0, PAGE_SIZE)
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Rider', href: '/rider' }, { label: 'History' }]}
        title="Delivery history"
        subtitle="Deliveries you have finished or handed back, newest first."
      />
      <MetricGrid>
        <MetricCard
          label="Completed deliveries"
          value={h.completed}
          icon="check-circle"
          accent="success"
        />
        <MetricCard
          label="Handed back"
          value={h.released}
          note="Released before delivery"
          icon="return"
        />
      </MetricGrid>
      <div className="mb-5 max-w-3xl">
        <RiderFreeNotice extra="Fees shown are the delivery fee of each order. Whether a fee reached you is recorded on the Payments page, where you confirm it yourself." />
      </div>
      <DataTable
        caption="Finished deliveries"
        rows={rows}
        rowKey={(r) => r.assignment_id}
        empty={
          <EmptyState title="No finished deliveries yet">
            Deliveries you complete appear here.
          </EmptyState>
        }
        columns={[
          {
            header: 'Order',
            cell: (r) => (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.order_number}</span>
                <Badge tone={r.status === 'completed' ? 'success' : 'warning'}>
                  {r.status === 'completed' ? 'Completed' : 'Handed back'}
                </Badge>
              </span>
            ),
          },
          { header: 'Collected from', cell: (r) => r.vendor_name },
          { header: 'Delivered to', cell: (r) => r.deliver_to ?? 'Not recorded' },
          {
            header: 'Finished',
            cell: (r) => lagosDateTime(r.finished_at),
          },
          {
            header: 'Delivery fee',
            align: 'right',
            cell: (r) => <Money kobo={r.delivery_fee_kobo} />,
          },
          {
            header: 'Fee payment',
            cell: (r) =>
              r.fee_payment_status ? (
                <StatusBadge status={r.fee_payment_status} />
              ) : (
                <span className="text-muted">Not opened</span>
              ),
          },
        ]}
      />
      <Pager basePath="/rider/history" page={page} hasMore={h.rows.length > PAGE_SIZE} />
    </>
  )
}
