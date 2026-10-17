import type { Metadata } from 'next'
import { ReleaseForm, ResolveIssueForm } from '@/components/domain/rider-admin-forms'
import { OpsExceptionForm } from '@/components/domain/support-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { listOpenRiderIssues } from '@/server/modules/riders/queries'

export const metadata: Metadata = { title: 'Rider issues' }
const LABEL: Record<string, string> = {
  vendor_not_ready: 'Vendor not ready',
  recipient_unavailable: 'Recipient unavailable',
  blocked_route: 'Blocked route',
  safety_security_restriction: 'Safety or security restriction',
  gps_issue: 'GPS problem (this is NOT an arrival)',
  ops_flag: 'Flagged by operations',
}

export default async function RiderIssues() {
  const issues = await listOpenRiderIssues()
  return (
    <>
      <PageHeader
        title="Rider issues"
        subtitle="Reports from riders. A report never penalises anyone automatically."
      />
      {issues.length === 0 ? (
        <EmptyState title="No open issues">Reports from riders appear here.</EmptyState>
      ) : (
        <div className="space-y-4">
          {issues.map((i) => (
            <Card key={i.id} className="space-y-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">{LABEL[i.reason] ?? i.reason}</Badge>
                <span className="font-bold">{i.order_number}</span>
                <span className="text-sm text-muted">
                  {new Date(i.created_at).toLocaleString('en-NG')}
                </span>
              </p>
              {i.note && <p>{i.note}</p>}
              <ResolveIssueForm id={i.id} />
              {i.assignment_id && i.assignment_status === 'accepted' && (
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Return this delivery to the pool
                  </summary>
                  <div className="mt-2">
                    <ReleaseForm assignmentId={i.assignment_id} />
                  </div>
                </details>
              )}
              {[
                'PICKED_UP_BY_RIDER',
                'EN_ROUTE',
                'ARRIVAL_DETECTED',
                'AWAITING_RECIPIENT_PROOF',
              ].includes(i.order_status) && (
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Handle a parcel that is on its way (recipient unavailable, rider cannot finish)
                  </summary>
                  <div className="mt-2">
                    <OpsExceptionForm orderId={i.order_id} />
                  </div>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
