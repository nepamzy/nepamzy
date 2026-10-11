import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui/card'

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
  ['/admin/cases', 'Reports', 'Customer reports and disputes (support).'],
  ['/admin/returns', 'Returns', 'Decide return requests (support).'],
  ['/admin/audit', 'Audit trail', 'Read-only record of important actions.'],
  ['/admin/roles', 'Roles', 'Grant or revoke roles (administrators only).'],
]
export default function AdminHome() {
  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Protected area. Every action here is recorded."
      />
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
