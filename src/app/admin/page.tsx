import type { Metadata } from 'next'
import Link from 'next/link'
import { OrderStatusPill } from '@/components/domain/order-status'
import { BarChart } from '@/components/ui/bar-chart'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { type IconName } from '@/components/ui/icons'
import { MetricCard, MetricGrid } from '@/components/ui/metric-card'
import { Money } from '@/components/ui/money'
import { Section } from '@/components/ui/section'
import { EmptyState } from '@/components/ui/states'
import { formatNaira } from '@/lib/money'
import { adminDashboard } from '@/server/modules/admin/queries'
import { adminOverview } from '@/server/modules/engagement/queries'

export const metadata: Metadata = { title: 'Administration' }

const ATTENTION: Record<string, [string, string]> = {
  cases_open: ['Open reports', '/admin/cases'],
  cases_awaiting_close: ['Decided reports awaiting close', '/admin/cases'],
  returns_waiting: ['Returns waiting for a decision', '/admin/returns'],
  review_reports_open: ['Open review reports', '/admin/reviews'],
  rider_issues_open: ['Open rider issues', '/admin/rider-issues'],
  deliveries_in_flight: ['Deliveries in progress', '/admin/orders'],
  refunds_requested: ['Refunds waiting for review', '/admin/refunds'],
  refunds_awaiting_execution: ['Refunds approved, not executed', '/admin/refunds'],
  refunds_need_reconciliation: ['Refunds needing reconciliation', '/admin/refunds'],
  payment_flags_open: ['Open payment flags', '/admin/payments'],
  vendor_applications_pending: ['Vendor applications pending', '/admin/applications'],
  rider_applications_pending: ['Rider applications pending', '/admin/applications'],
  notifications_dead: ['Notifications that failed for good', '/admin/jobs'],
  notifications_stuck: ['Notifications stuck in processing', '/admin/jobs'],
}
const ACTIONS: [string, string, IconName][] = [
  ['/admin/users', 'Manage users', 'users'],
  ['/admin/vendors', 'Manage vendors', 'store'],
  ['/admin/riders', 'Manage riders', 'bike'],
  ['/admin/orders', 'View orders', 'package'],
  ['/admin/refunds', 'Process refunds', 'refund'],
  ['/admin/reports', 'View reports', 'chart'],
  ['/admin/settings', 'Platform settings', 'sliders'],
]

export default async function AdminHome() {
  const [d, overview] = await Promise.all([adminDashboard(), adminOverview()])
  const attention = Object.entries(overview ?? {}).filter(([, v]) => v > 0)
  return (
    <>
      <PageHeader
        title="Admin dashboard"
        subtitle="System overview and key numbers. Every figure comes from the live database."
        actions={
          <ButtonLink href="/admin/reports" variant="secondary">
            View reports
          </ButtonLink>
        }
      />
      {!d ? (
        <EmptyState title="We could not load the dashboard" icon="alert">
          Please refresh the page. If it keeps happening, check the jobs page and the audit trail.
        </EmptyState>
      ) : (
        <>
          <MetricGrid>
            <MetricCard
              label="Orders (all time)"
              value={d.orders_total}
              note={`${d.orders_7d} in the last 7 days`}
              icon="package"
              href="/admin/orders"
            />
            <MetricCard
              label="Payments received"
              value={
                d.payments_received_kobo === null
                  ? 'Not shown'
                  : formatNaira(d.payments_received_kobo)
              }
              note={
                d.payments_received_kobo === null
                  ? 'Finance and administrators only'
                  : `${formatNaira(d.payments_received_7d_kobo ?? 0)} in the last 7 days (per ledger)`
              }
              icon="coins"
              accent="success"
              href="/admin/payments"
            />
            <MetricCard
              label="Approved vendors"
              value={d.vendors_approved}
              note={`${d.vendors_pending} application${d.vendors_pending === 1 ? '' : 's'} pending`}
              icon="store"
              accent="gold"
              href="/admin/vendors"
            />
            <MetricCard
              label="Approved riders"
              value={d.riders_approved}
              note={`${d.orders_active} order${d.orders_active === 1 ? '' : 's'} in progress`}
              icon="bike"
              accent="danger"
              href="/admin/riders"
            />
          </MetricGrid>
          <div className="mb-8 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <h2 className="mb-2 text-lg font-extrabold text-navy-900">Orders, last 14 days</h2>
              <BarChart
                label="Orders per day over the last 14 days"
                data={d.orders_by_day.map((x) => ({
                  label: new Date(x.day).toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'short',
                  }),
                  value: x.orders,
                }))}
              />
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-extrabold text-navy-900">Quick actions</h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {ACTIONS.map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="touch-target flex items-center justify-between rounded-[var(--radius-control)] border border-line px-3 py-2 font-bold text-navy-900 hover:bg-brand-50"
                    >
                      {label} <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Section
            title="Recent orders"
            id="recent"
            actions={
              <Link href="/admin/orders" className="font-bold text-brand-700 hover:underline">
                View all →
              </Link>
            }
          >
            <DataTable
              caption="Recent orders"
              rows={d.recent_orders}
              rowKey={(o) => o.id}
              empty={
                <EmptyState title="No orders yet" icon="package">
                  Orders appear here as customers place them.
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
                { header: 'Total', align: 'right', cell: (o) => <Money kobo={o.total_kobo} /> },
                { header: 'Status', cell: (o) => <OrderStatusPill code={o.status} /> },
                { header: 'Placed', cell: (o) => new Date(o.created_at).toLocaleString('en-NG') },
              ]}
            />
          </Section>
        </>
      )}
      <Section
        title="Needs attention"
        id="todo"
        description="Only items that need someone are listed."
      >
        {attention.length === 0 ? (
          <EmptyState title="Nothing needs attention" icon="check-circle">
            Reports, refunds, applications and background jobs are all clear.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attention.map(([k, v]) => {
              const [label, href] = ATTENTION[k] ?? [k.replaceAll('_', ' '), '/admin']
              return (
                <li key={k}>
                  <Link
                    href={href}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-pop)]"
                  >
                    <span className="text-sm font-semibold text-muted">{label}</span>
                    <span className="text-2xl font-extrabold text-navy-900">{v}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </>
  )
}
