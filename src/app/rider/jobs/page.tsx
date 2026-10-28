import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AcceptButton,
  LocationSharing,
  ReportIssueForm,
  StartRouteButton,
  TokenCard,
} from '@/components/domain/rider-controls'
import { OrderStatusPill } from '@/components/domain/order-status'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import {
  getAssignments,
  getMyRider,
  getOffers,
  locationSettings,
} from '@/server/modules/riders/queries'

export const metadata: Metadata = { title: 'Jobs' }

export default async function Jobs() {
  const me = await getMyRider()
  if (!me)
    return (
      <EmptyState title="Your rider account is not available">Contact an administrator.</EmptyState>
    )
  if (!me.active)
    return (
      <>
        <PageHeader
          breadcrumbs={[{ label: 'Rider', href: '/rider' }, { label: 'Jobs' }]}
          title="Jobs"
        />
        <EmptyState title="You are off duty">
          Go active from{' '}
          <Link className="font-semibold underline" href="/rider">
            Rider home
          </Link>{' '}
          to see delivery offers.
        </EmptyState>
      </>
    )
  const [assignments, offers, s] = await Promise.all([
    getAssignments(),
    getOffers(),
    locationSettings(),
  ])
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Rider', href: '/rider' }, { label: 'Jobs' }]}
        title="Jobs"
        subtitle={`${assignments.length} of 5 active deliveries`}
      />
      <div className="mb-5">
        <LocationSharing
          enabled={assignments.length > 0}
          minIntervalSeconds={Math.max(s.minIntervalSeconds, 5)}
          maxAccuracyM={s.maxAccuracyM}
          maxAgeSeconds={s.maxAgeSeconds}
        />
      </div>

      <section aria-labelledby="mine" className="mb-6 space-y-3">
        <h2 id="mine" className="text-lg font-bold">
          My deliveries
        </h2>
        {assignments.length === 0 ? (
          <EmptyState title="No accepted deliveries">Accept an offer below.</EmptyState>
        ) : (
          assignments.map((a) => (
            <Card key={a.assignment_id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">
                  #{a.sequence} · {a.order_number}
                </span>
                <OrderStatusPill code={a.order_status} />
              </div>
              <p>
                <strong>Collect from:</strong> {a.vendor_name}
                {a.pickup ? ` · ${a.pickup}` : ''}
              </p>
              <p>
                <strong>Deliver to:</strong> {a.deliver_to}{' '}
                <span className="text-xs text-muted">(sample point)</span>
              </p>
              {a.status === 'accepted' && <TokenCard assignmentId={a.assignment_id} />}
              {a.status === 'picked_up' && <StartRouteButton assignmentId={a.assignment_id} />}
              {a.status === 'en_route' && !a.arrival_detected_at && (
                <p className="text-sm text-muted">
                  On the way. Arrival is detected automatically from your GPS; there is no button
                  for it.
                </p>
              )}
              {a.arrival_detected_at && (
                <p className="font-semibold">
                  Arrival detected. Now the recipient confirms receipt in their own app and signs.
                  {a.order_status === 'AWAITING_RECIPIENT_PROOF' &&
                    ' They have started: wait for them to finish.'}{' '}
                  This app cannot mark the order delivered for you; if the recipient is not there,
                  report it below.
                </p>
              )}
              <ReportIssueForm assignmentId={a.assignment_id} />
            </Card>
          ))
        )}
      </section>

      <section aria-labelledby="offers" className="space-y-3">
        <h2 id="offers" className="text-lg font-bold">
          Delivery offers
        </h2>
        {offers.length === 0 ? (
          <EmptyState title="No offers right now">
            New deliveries appear here when a vendor marks an order ready.
          </EmptyState>
        ) : (
          offers.map((o) => (
            <Card key={o.order_id} className="space-y-2">
              <p className="font-bold">{o.order_number}</p>
              <p>
                <strong>Collect from:</strong> {o.vendor_name}
                {o.pickup ? ` · ${o.pickup}` : ''}
              </p>
              <p>
                <strong>Deliver to:</strong> {o.deliver_to}
              </p>
              <AcceptButton orderId={o.order_id} />
            </Card>
          ))
        )}
      </section>
    </>
  )
}
