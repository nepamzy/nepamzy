import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { staffListCases } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Reports (support)' }

export default async function AdminCases() {
  const cases = await staffListCases()
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Disputes and problems. No decision is ever automatic: every one is made by a person, with a reason."
      />
      {cases.length === 0 ? (
        <EmptyState title="No reports">Customer reports appear here.</EmptyState>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center gap-3">
              <Link className="font-bold text-brand-700 underline" href={`/admin/cases/${c.id}`}>
                {c.case_no}
              </Link>
              <span>{c.order_number}</span>
              <span>{c.case_type.replaceAll('_', ' ')}</span>
              <Badge tone="info">{c.status.replaceAll('_', ' ')}</Badge>
              {c.decision && <Badge tone="brand">{c.decision.replaceAll('_', ' ')}</Badge>}
              <span className="text-sm text-muted">
                {new Date(c.created_at).toLocaleString('en-NG')}
              </span>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
