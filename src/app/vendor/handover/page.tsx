import type { Metadata } from 'next'
import { RiderPickupForm } from '@/components/domain/rider-pickup-form'
import { HandoverForm } from '@/components/domain/handover-form'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { typedSignatureEnabled } from '@/server/modules/orders-and-state-machine/actions'
import { listPendingRiderPickups } from '@/server/modules/riders/queries'
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
  const typedEnabled = await typedSignatureEnabled()
  const riderPickups = vendor ? await listPendingRiderPickups() : []
  return (
    <>
      <PageHeader
        title="Confirm handover"
        subtitle="The customer shows a pickup code, then signs for the order."
      />
      {riderPickups.length > 0 && (
        <section aria-labelledby="rp" className="mb-8 space-y-4">
          <h2 id="rp" className="text-lg font-bold">
            Rider collecting a delivery
          </h2>
          {riderPickups.map((p) => (
            <Card key={p.order_id} className="space-y-3">
              <p className="font-bold">{p.order_number}</p>
              <p>
                Assigned rider: <strong>{p.rider_name}</strong>. Only hand the parcel over if this
                person shows you the code on their phone.
              </p>
              <RiderPickupForm orderId={p.order_id} />
            </Card>
          ))}
        </section>
      )}
      <h2 className="mb-3 text-lg font-bold">Customer pickups</h2>
      {waiting.length === 0 ? (
        <EmptyState title="Nothing waiting for pickup">
          Orders you mark as ready for pickup appear here.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {waiting.map((o) => (
            <Card key={o.id} className="space-y-3">
              <h2 className="text-lg font-bold">{o.order_number}</h2>
              <HandoverForm orderId={o.id} typedEnabled={typedEnabled} />
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
