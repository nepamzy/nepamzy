import type { Metadata } from 'next'
import Link from 'next/link'
import { ModerateForm, UnhideForm } from '@/components/domain/engagement-forms'
import { Badge, type Tone } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { PAGE_SIZE, listReviewReports, pageParam } from '@/server/modules/engagement/queries'

export const metadata: Metadata = { title: 'Review reports' }
const STATUSES = ['open', 'upheld', 'dismissed'] as const
const TONE: Record<string, Tone> = { open: 'info', upheld: 'danger', dismissed: 'neutral' }

export default async function ReviewReports({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const sp = await searchParams
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'open'
  const page = pageParam(sp.page)
  const [{ rows, total }, { who }] = await Promise.all([
    listReviewReports(status, page),
    checkAccess({ roles: ['platform_admin', 'support_agent'], aal: 'aal2' }),
  ])
  const isAdmin = who.roles.includes('platform_admin')
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Review reports' }]}
        title="Review reports"
        subtitle="Hiding a review keeps it on record. It never changes an order, a payment or a refund."
      />
      <nav aria-label="Status" className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/reviews?status=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className="touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong px-3 font-semibold aria-[current=page]:bg-brand-50"
          >
            {s}
          </Link>
        ))}
      </nav>
      <p className="mb-3 text-sm text-muted">{total} in this list.</p>
      {rows.length === 0 ? (
        <EmptyState title="No reports here">Nothing to decide in this list.</EmptyState>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <Card key={r.id} className="space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.vendor}</span>
                <span>{'★'.repeat(r.rating)}</span>
                <Badge tone={TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                <Badge>{`review is ${r.review_status}`}</Badge>
              </p>
              <p>{r.comment ?? <span className="text-muted">No comment.</span>}</p>
              <p className="text-sm">
                Reported as <strong>{r.reason.replaceAll('_', ' ')}</strong>
                {r.note ? `: ${r.note}` : ''}
              </p>
              {r.resolution_reason && (
                <p className="text-sm text-muted">Decision: {r.resolution_reason}</p>
              )}
              {r.status === 'open' && <ModerateForm reportId={r.id} canJudge />}
              {isAdmin && r.review_status === 'hidden' && <UnhideForm reviewId={r.review_id} />}
            </Card>
          ))}
        </div>
      )}
      <Pager
        basePath="/admin/reviews"
        page={page}
        hasMore={rows.length === PAGE_SIZE}
        params={{ status }}
      />
    </>
  )
}
