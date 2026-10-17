import type { Metadata } from 'next'
import { ReturnReceivedForm } from '@/components/domain/support-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { listReturns } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Returns' }

export default async function VendorReturns() {
  const returns = (await listReturns()).filter((r) => r.status !== 'rejected')
  return (
    <>
      <PageHeader
        title="Returns"
        subtitle="Approved returns coming back to your shop. Confirm when the item arrives."
      />
      {returns.length === 0 ? (
        <EmptyState title="No returns">Approved returns for your shop appear here.</EmptyState>
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
              </p>
              <p>{r.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
              {r.status === 'approved' && <ReturnReceivedForm returnId={r.id} />}
              {r.vendor_condition && (
                <p className="text-sm">Recorded condition: {r.vendor_condition}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
