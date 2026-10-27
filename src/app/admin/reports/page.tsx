import type { Metadata } from 'next'
import { BarChart } from '@/components/ui/bar-chart'
import { Card, PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { LinkTabs } from '@/components/ui/list-controls'
import { MetricCard, MetricGrid } from '@/components/ui/metric-card'
import { Money } from '@/components/ui/money'
import { Section } from '@/components/ui/section'
import { EmptyState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatNaira } from '@/lib/money'
import { adminReport } from '@/server/modules/admin/queries'

export const metadata: Metadata = { title: 'Reports' }

const RANGES = [7, 30, 90] as const

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const n = Number((await searchParams).days)
  const days = (RANGES as readonly number[]).includes(n) ? n : 30
  const r = await adminReport(days)
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Totals from persisted orders and the payment ledger. Nothing here is estimated."
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Reports' }]}
      />
      <LinkTabs
        label="Period"
        active={String(days)}
        tabs={RANGES.map((d) => ({
          key: String(d),
          label: `Last ${d} days`,
          href: `/admin/reports?days=${d}`,
        }))}
      />
      {!r ? (
        <EmptyState title="We could not load reports" icon="alert">
          Please try again.
        </EmptyState>
      ) : (
        <>
          <MetricGrid>
            <MetricCard
              label="Orders placed"
              value={r.orders}
              note={`${r.orders_completed} completed, ${r.orders_cancelled} cancelled`}
              icon="package"
            />
            <MetricCard
              label="Payments received"
              value={formatNaira(r.payments_received_kobo)}
              note="Per the payment ledger"
              icon="coins"
              accent="success"
            />
            <MetricCard
              label="Refunds paid"
              value={formatNaira(r.refunds_paid_kobo)}
              note="Only refunds confirmed as paid"
              icon="refund"
              accent="danger"
            />
            <MetricCard label="New users" value={r.new_users} icon="users" accent="gold" />
          </MetricGrid>
          <div className="mb-8 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-lg font-extrabold text-navy-900">Orders per day</h2>
              <BarChart
                label={`Orders per day, last ${days} days`}
                data={r.by_day.map((d) => ({
                  label: new Date(d.day).toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'short',
                  }),
                  value: d.orders,
                }))}
              />
            </Card>
            <Card>
              <h2 className="mb-2 text-lg font-extrabold text-navy-900">
                Payments received per day
              </h2>
              <BarChart
                label={`Payments received per day, last ${days} days`}
                format={(k) => formatNaira(k)}
                data={r.by_day.map((d) => ({
                  label: new Date(d.day).toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'short',
                  }),
                  value: d.received_kobo,
                }))}
              />
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Orders by status" id="status">
              <DataTable
                caption="Orders by status"
                rows={r.by_status}
                rowKey={(s) => s.status}
                empty={<EmptyState title="No orders in this period" icon="package" />}
                columns={[
                  { header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
                  { header: 'Orders', align: 'right', cell: (s) => s.n },
                ]}
              />
            </Section>
            <Section title="Busiest shops" id="vendors" description="By number of orders placed">
              <DataTable
                caption="Busiest shops"
                rows={r.top_vendors}
                rowKey={(v) => v.vendor_name}
                empty={<EmptyState title="No orders in this period" icon="store" />}
                columns={[
                  { header: 'Shop', cell: (v) => v.vendor_name },
                  { header: 'Orders', align: 'right', cell: (v) => v.orders },
                  {
                    header: 'Completed items value',
                    align: 'right',
                    cell: (v) => <Money kobo={v.completed_items_kobo} />,
                  },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </>
  )
}
