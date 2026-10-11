import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatementForm } from '@/components/domain/support-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Timeline } from '@/components/ui/timeline'
import { getCase } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Report' }

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const c = await getCase((await params).id)
  if (!c) notFound()
  return (
    <>
      <p className="mb-2">
        <Link href="/cases" className="font-semibold text-brand-700 underline">
          ← Reports
        </Link>
      </p>
      <PageHeader
        title={c.case_no}
        subtitle={`${c.order_number} · ${c.case_type.replaceAll('_', ' ')}`}
        actions={<Badge tone="info">{c.status.replaceAll('_', ' ')}</Badge>}
      />
      {c.description && (
        <Card className="mb-5">
          <h2 className="font-bold">What was reported</h2>
          <p>{c.description}</p>
        </Card>
      )}
      {c.decision && (
        <Card className="mb-5 border-brand-700">
          <h2 className="font-bold">Decision</h2>
          <p>
            <strong>{c.decision.replaceAll('_', ' ')}</strong>
            {c.decision_reason ? `: ${c.decision_reason}` : ''}
          </p>
          <p className="text-sm text-muted">
            A refund decision creates a request that finance still has to approve and run.
          </p>
        </Card>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Statements</h2>
          {c.statements.length === 0 ? (
            <p className="text-muted">No statements yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.statements.map((s, i) => (
                <li key={i} className="rounded-[var(--radius-control)] border border-line p-3">
                  <p className="text-sm font-semibold">
                    {s.party === 'support' ? 'Support' : s.party}
                  </p>
                  <p>{s.body}</p>
                  <p className="text-xs text-muted">{new Date(s.at).toLocaleString('en-NG')}</p>
                </li>
              ))}
            </ul>
          )}
          {c.status !== 'closed' && <StatementForm caseId={c.id} />}
        </Card>
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Progress</h2>
          <Timeline
            steps={[
              ...c.timeline.map((t) => ({
                label: t.action.replaceAll('_', ' '),
                detail: new Date(t.at).toLocaleString('en-NG'),
              })),
            ].map((s, i, a) => ({
              ...s,
              state: i === a.length - 1 ? ('current' as const) : ('done' as const),
            }))}
          />
        </Card>
      </div>
    </>
  )
}
