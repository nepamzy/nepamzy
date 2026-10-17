import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { listMyCases } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Reports' }

export default async function Cases() {
  const cases = await listMyCases()
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Problems you reported, or reports about orders you handled."
      />
      {cases.length === 0 ? (
        <EmptyState title="No reports">
          When an order has a problem, the report appears here.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center gap-3">
              <Link className="font-bold text-brand-700 underline" href={`/cases/${c.id}`}>
                {c.case_no}
              </Link>
              <span>{c.order_number}</span>
              <span>{c.case_type.replaceAll('_', ' ')}</span>
              <Badge tone="info">{c.status.replaceAll('_', ' ')}</Badge>
              <span className="text-sm text-muted">as {c.role}</span>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
