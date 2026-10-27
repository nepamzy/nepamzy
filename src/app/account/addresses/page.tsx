import type { Metadata } from 'next'
import { DeletePlaceButton, PlaceForm } from '@/components/domain/customer-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Section } from '@/components/ui/section'
import { EmptyState } from '@/components/ui/states'
import { listDeliveryPoints } from '@/server/modules/cart-and-checkout/queries'
import { listSavedPlaces } from '@/server/modules/customer/queries'

export const metadata: Metadata = { title: 'Saved places' }

export default async function AddressesPage() {
  const [places, points] = await Promise.all([listSavedPlaces(), listDeliveryPoints()])
  return (
    <>
      <PageHeader
        title="Saved places"
        subtitle="Delivery goes only to approved delivery points. Save the ones you use often."
        breadcrumbs={[{ label: 'My account', href: '/account' }, { label: 'Saved places' }]}
      />
      <Section title="Your places" id="places">
        {places.length === 0 ? (
          <EmptyState title="No saved places yet" icon="pin">
            Save a delivery point with a name you will recognise. Your default is chosen for you at
            checkout.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {places.map((s) => (
              <li key={s.id}>
                <Card className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-extrabold text-navy-900">{s.label}</p>
                      <p className="text-sm text-muted">{s.delivery_point}</p>
                    </div>
                    {s.is_default && <Badge tone="brand">Default</Badge>}
                  </div>
                  {!s.point_active && (
                    <p role="status" className="text-sm font-semibold text-warning-700">
                      This delivery point is not open right now.
                    </p>
                  )}
                  {points.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-bold text-brand-700">
                        Edit
                      </summary>
                      <div className="mt-3">
                        <PlaceForm points={points} place={s} />
                      </div>
                    </details>
                  )}
                  <DeletePlaceButton id={s.id} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {places.length < 5 && (
        <Section title="Add a place" id="add">
          {points.length === 0 ? (
            <EmptyState title="No delivery points are open yet" icon="pin">
              An administrator adds approved delivery points. You can save places once there is one.
            </EmptyState>
          ) : (
            <Card className="max-w-lg">
              <PlaceForm points={points} />
            </Card>
          )}
        </Section>
      )}
    </>
  )
}
