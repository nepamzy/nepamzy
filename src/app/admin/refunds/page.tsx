import type { Metadata } from 'next'
import { RefundStaffControls } from '@/components/domain/support-forms'
import { Badge, type Tone } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { staffListRefunds } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Refunds' }

const STATUS: Record<string, [string, Tone]> = {
  requested: ['Requested', 'info'],
  under_review: ['Under review', 'info'],
  approved: ['Approved: NOT executed', 'brand'],
  rejected: ['Rejected', 'danger'],
  processing: ['Processing (fake provider)', 'warning'],
  succeeded: ['Succeeded', 'success'],
  failed: ['Failed', 'danger'],
  reconciliation_required: ['Needs reconciliation', 'warning'],
}

export default async function Refunds() {
  const refunds = await staffListRefunds()
  const { who } = await checkAccess({ roles: ['platform_admin', 'finance_admin'], aal: 'aal2' })
  const finance = who.roles.includes('platform_admin') || who.roles.includes('finance_admin')
  return (
    <>
      <PageHeader
        title="Refunds"
        subtitle="Request, approval and execution are three separate steps. Only a FAKE provider exists: no real refund is sent anywhere."
      />
      {refunds.length === 0 ? (
        <EmptyState title="No refund requests">
          Customer and finance requests appear here.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {refunds.map((r) => {
            const [label, tone] = STATUS[r.status] ?? [r.status, 'neutral' as Tone]
            return (
              <Card
                key={r.id}
                role="group"
                aria-label={`Refund ${r.order_number} ${r.id.slice(0, 8)}`}
                className="space-y-3"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{r.order_number}</span>
                  <Money kobo={r.amount_kobo} className="font-bold" />
                  <Badge tone={tone}>{label}</Badge>
                  {r.provider_mode === 'fake' && (
                    <Badge tone="warning">FAKE provider: no real money</Badge>
                  )}
                  <span className="text-sm text-muted">via {r.source}</span>
                </p>
                <p>{r.reason}</p>
                {r.items.length > 0 && (
                  <p className="text-sm">
                    {r.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">History</summary>
                  <ul className="mt-1 space-y-1 text-sm">
                    {r.events.map((e, i) => (
                      <li key={i}>
                        {new Date(e.at).toLocaleString('en-NG')} · {e.action.replaceAll('_', ' ')}
                        {e.note ? `: ${e.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
                <RefundStaffControls
                  refundId={r.id}
                  status={r.status}
                  ownRequest={r.own_request}
                  canApprove={finance}
                  canExecute={finance}
                />
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
