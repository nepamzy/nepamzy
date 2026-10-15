import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui/card'
import { adminOverview } from '@/server/modules/engagement/queries'

export const metadata: Metadata = { title: 'Administration' }
const CARDS = [
  ['/admin/applications', 'Applications', 'Review vendor applications.'],
  ['/admin/vendors', 'Vendors', 'Suspend or reinstate vendors.'],
  [
    '/admin/delivery-points',
    'Delivery points',
    'Approved places for delivery (fictional placeholders for now).',
  ],
  ['/admin/categories', 'Categories', 'Vendor categories.'],
  ['/admin/riders', 'Riders', 'Approve rider applications; suspend or reinstate riders.'],
  ['/admin/rider-issues', 'Rider issues', 'Problems reported by riders (support).'],
  ['/admin/payments', 'Payments', 'Reconciliation flags and refund requests (test mode).'],
  [
    '/admin/refunds',
    'Refunds',
    'Review, approve and (fake-)execute refund requests. Approval and execution are separate.',
  ],
  [
    '/admin/settlements',
    'Settlements',
    'Vendor commission and calculated amounts due (finance and administrators; nothing is paid out).',
  ],
  ['/admin/cases', 'Reports', 'Customer reports and disputes (support).'],
  ['/admin/returns', 'Returns', 'Decide return requests (support).'],
  ['/admin/reviews', 'Review reports', 'Decide reports about customer reviews (support).'],
  ['/admin/jobs', 'Background jobs', 'Job and notification queue health (administrators only).'],
  [
    '/admin/settings',
    'Settings',
    'Fees, limits and policies (administrators only). Every change is recorded.',
  ],
  ['/admin/audit', 'Audit trail', 'Read-only record of important actions.'],
  ['/admin/roles', 'Roles', 'Grant or revoke roles (administrators only).'],
]
const COUNTER_LABELS: Record<string, string> = {
  cases_open: 'Open reports',
  cases_awaiting_close: 'Decided reports awaiting close',
  returns_waiting: 'Returns waiting for a decision',
  review_reports_open: 'Open review reports',
  rider_issues_open: 'Open rider issues',
  deliveries_in_flight: 'Deliveries in progress',
  refunds_requested: 'Refunds waiting for review',
  refunds_awaiting_execution: 'Refunds approved, not executed',
  refunds_need_reconciliation: 'Refunds needing reconciliation',
  payment_flags_open: 'Open payment flags',
  vendor_applications_pending: 'Vendor applications pending',
  rider_applications_pending: 'Rider applications pending',
  notifications_dead: 'Notifications that failed for good',
  notifications_stuck: 'Notifications stuck in processing',
}

export default async function AdminHome() {
  const overview = await adminOverview()
  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Protected area. Every action here is recorded."
      />
      {overview && Object.keys(overview).length > 0 && (
        <section aria-labelledby="todo" className="mb-6">
          <h2 id="todo" className="mb-2 text-lg font-bold">
            Needs attention
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(overview).map(([k, v]) => (
              <Card key={k} className="p-3 sm:p-3">
                <dt className="text-sm text-muted">
                  {COUNTER_LABELS[k] ?? k.replaceAll('_', ' ')}
                </dt>
                <dd className="text-2xl font-bold">{v}</dd>
              </Card>
            ))}
          </dl>
        </section>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(([href, t, d]) => (
          <Card key={href}>
            <h2 className="font-bold">{t}</h2>
            <p className="text-muted">{d}</p>
            <Link className="mt-2 inline-block font-semibold text-brand-700 underline" href={href!}>
              Open
            </Link>
          </Card>
        ))}
      </div>
    </>
  )
}
