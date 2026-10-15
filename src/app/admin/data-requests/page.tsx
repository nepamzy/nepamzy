import type { Metadata } from 'next'
import { ResolveDataRequestForm } from '@/components/domain/engagement-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { adminDataRequests } from '@/server/modules/engagement/queries'

export const metadata: Metadata = { title: 'Data requests' }

export default async function AdminDataRequests() {
  const rows = await adminDataRequests()
  return (
    <>
      <PageHeader
        title="Data requests"
        subtitle="Closure, access, correction and deletion requests. Handle each by hand, then record the outcome. Nothing is deleted automatically."
      />
      {rows.length === 0 ? (
        <EmptyState title="No requests">Requests from users appear here.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-2">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{r.kind}</span>
                  <Badge tone="info">{r.status.replaceAll('_', ' ')}</Badge>
                  <span className="text-sm text-muted">{r.requester ?? 'account removed'}</span>
                </p>
                {r.detail && <p className="text-sm">{r.detail}</p>}
                {r.status === 'open' || r.status === 'in_progress' ? (
                  <ResolveDataRequestForm requestId={r.id} />
                ) : (
                  <p className="text-sm">Reply: {r.response_note}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
