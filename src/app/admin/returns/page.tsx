import type { Metadata } from 'next'
import { ReturnDecisionForm } from '@/components/domain/support-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { listReturns } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Returns' }

export default async function AdminReturns() {
  const returns = await listReturns()
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Returns' }]}
        title="Returns"
        subtitle="A return is separate from a refund. Approving a return does not pay anyone and nothing is restocked automatically."
      />
      {returns.length === 0 ? (
        <EmptyState title="No return requests">Customer return requests appear here.</EmptyState>
      ) : (
        <div className="space-y-4">
          {returns.map((r) => (
            <Card
              key={r.id}
              role="group"
              aria-label={`Return ${r.order_number} ${r.id.slice(0, 8)}`}
              className="space-y-2"
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.order_number}</span>
                <Badge tone="info">{r.status.replaceAll('_', ' ')}</Badge>
                <Badge tone={r.return_rule === 'not_returnable' ? 'danger' : 'neutral'}>
                  shop rule: {r.return_rule.replaceAll('_', ' ')}
                </Badge>
              </p>
              <p>{r.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
              <p className="text-sm text-muted">{r.reason}</p>
              {r.decision_reason && <p className="text-sm">Decision: {r.decision_reason}</p>}
              {r.vendor_condition && <p className="text-sm">Shop says: {r.vendor_condition}</p>}
              {r.status === 'requested' && <ReturnDecisionForm returnId={r.id} />}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
