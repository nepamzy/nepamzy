import type { Metadata } from 'next'
import { RefundRequestForm, ResolveFlagForm } from '@/components/domain/finance-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Payments' }

type Flag = {
  id: string
  order_id: string | null
  order_number: string | null
  reason: string
  details: Record<string, unknown>
  created_at: string
}
const WHY: Record<string, string> = {
  amount_mismatch: 'Paid amount did not match the order. The order was NOT marked paid.',
  late_payment:
    'Money arrived after the order was cancelled or expired. A refund is likely needed.',
  duplicate_payment: 'A second payment arrived for an order that was already paid.',
  unknown_reference: 'A payment event arrived for a reference we do not know.',
  vendor_rejected_paid_order:
    'The vendor rejected an order that had been paid. A refund is needed.',
  refund_outcome_unknown:
    'A refund was started but its outcome is not known. Check the real outcome in Refunds before anything else happens to it.',
  refund_outcome_conflict:
    'A refund that already had a final outcome was told a different outcome. Nothing was changed; a person must look.',
}

export default async function PaymentsAdmin() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb.rpc('list_reconciliation_flags', { p_include_resolved: false })
  const flags = (data as Flag[] | null) ?? []
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Payments' }]}
        title="Payments"
        subtitle="Test mode only. Reconciliation flags need a human decision. Refunds are recorded as requests; nothing is sent to Paystack yet."
      />
      {flags.length === 0 ? (
        <EmptyState title="Nothing to reconcile">No open payment flags.</EmptyState>
      ) : (
        <div className="space-y-4">
          {flags.map((f) => (
            <Card key={f.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">{f.reason.replaceAll('_', ' ')}</Badge>
                {f.order_number && <span className="font-semibold">{f.order_number}</span>}
                <span className="text-sm text-muted">
                  {new Date(f.created_at).toLocaleString('en-NG')}
                </span>
              </div>
              <p>{WHY[f.reason] ?? f.reason}</p>
              <ResolveFlagForm flagId={f.id} />
              {f.order_id && (
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Record a refund request
                  </summary>
                  <div className="mt-3">
                    <RefundRequestForm orderId={f.order_id} />
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
