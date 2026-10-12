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
