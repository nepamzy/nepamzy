import type { Metadata } from 'next'
import { HandoverForm } from '@/components/domain/handover-form'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { listOrders } from '@/server/modules/orders-and-state-machine/queries'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Confirm handover' }

export default async function Handover() {
  const vendor = await getMyVendor()
  const waiting = vendor
    ? (await listOrders({ vendorId: vendor.id })).filter(
        (o) => o.status === 'PICKUP_AWAITING_HANDOVER',
      )
    : []
  return (
    <>
      <PageHeader
        title="Confirm handover"
        subtitle="The customer shows a pickup code, then signs for the order."
      />
      {waiting.length === 0 ? (
        <EmptyState title="Nothing waiting for pickup">
          Orders you mark as ready for pickup appear here.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {waiting.map((o) => (
            <Card key={o.id} className="space-y-3">
              <h2 className="text-lg font-bold">{o.order_number}</h2>
              <HandoverForm orderId={o.id} />
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
