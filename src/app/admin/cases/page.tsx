import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { ListFilter } from '@/components/ui/list-filter'
import { Pager } from '@/components/ui/pager'
import { pageParam } from '@/server/modules/engagement/queries'
import { STAFF_PAGE, staffListCases } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Reports (support)' }

const STATUSES = ['open', 'under_review', 'decided', 'closed'] as const

export default async function AdminCases({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const sp = await searchParams
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status : undefined
  const q = (sp.q ?? '').trim().slice(0, 40)
  const page = pageParam(sp.page)
  const cases = await staffListCases(status, page, q)
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Disputes and problems. No decision is ever automatic: every one is made by a person, with a reason."
      />
      <ListFilter
        action="/admin/cases"
        statuses={STATUSES}
        status={status}
        q={q}
        searchLabel="Order or report number"
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
      <Pager
        basePath="/admin/cases"
        page={page}
        hasMore={cases.length === STAFF_PAGE}
        params={{ status, q }}
      />
    </>
  )
}
