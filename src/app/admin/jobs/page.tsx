import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { jobHealth } from '@/server/modules/engagement/queries'

export const metadata: Metadata = { title: 'Background jobs' }

const when = (v: string | null) => (v ? new Date(v).toLocaleString('en-NG') : 'never')

export default async function Jobs() {
  const h = await jobHealth()
  if (!h) return <EmptyState title="Unavailable">Job health could not be loaded.</EmptyState>
  return (
    <>
      <PageHeader title="Background jobs" subtitle={h.note} />
      {h.problems.length === 0 ? (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700"
        >
          No problems detected: every job has succeeded within its expected window and no
          notification work is piling up.
        </p>
      ) : (
        <div
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 text-danger-700"
        >
          <p className="font-bold">{h.problems.length} problem(s) detected</p>
          <ul className="list-disc pl-5">
            {h.problems.map((p, i) => (
              <li key={i}>
                {p.job}: {p.kind.replaceAll('_', ' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-3">
        {h.jobs.map((j) => (
          <Card key={j.job} className="space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{j.job}</span>
              {j.last_run_ok === null ? (
                <Badge tone="warning">Never run</Badge>
              ) : j.last_run_ok ? (
                <Badge tone="success">Last run OK</Badge>
              ) : (
                <Badge tone="danger">Last run failed</Badge>
              )}
            </p>
            <p className="text-sm">Last run: {when(j.last_run_at)}</p>
            <p className="text-sm">Last success: {when(j.last_ok_at)}</p>
            <p className="text-sm">Failures in the last 24 hours: {j.failures_24h}</p>
            <p className="text-sm text-muted">
              Counts as stale after {j.max_age_minutes} minutes without a success.
            </p>
          </Card>
        ))}
      </div>
      <h2 className="mt-8 mb-2 text-lg font-bold">Notification queue</h2>
      <Card>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1">
          {Object.entries(h.notifications).map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{k.replaceAll('_', ' ')}</dt>
              <dd className="font-semibold">{v ?? 'none'}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  )
}
