import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CheckoutForm } from '@/components/domain/checkout-form'
import { PageHeader } from '@/components/ui/card'
import { Stepper } from '@/components/ui/stepper'
import { EmptyState } from '@/components/ui/states'
import { ButtonLink } from '@/components/ui/button'
import { getQuote, listDeliveryPoints } from '@/server/modules/cart-and-checkout/queries'
import { listSavedPlaces } from '@/server/modules/customer/queries'

export const metadata: Metadata = { title: 'Checkout' }

export default async function CheckoutPage() {
  const [pickup, points, places] = await Promise.all([
    getQuote('pickup', null),
    listDeliveryPoints(),
    listSavedPlaces(),
  ])
  const preferred = places.find((s) => s.is_default && s.point_active)?.delivery_point_id
  if (!pickup)
    return <EmptyState title="We could not load checkout">Please try again in a moment.</EmptyState>
  if (pickup.empty) redirect('/cart')
  const delivery = points[0] ? await getQuote('delivery', points[0].id) : null
  return (
    <>
      <PageHeader
        title="Checkout"
        subtitle={pickup.vendor_name ? `Order from ${pickup.vendor_name}` : undefined}
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Cart', href: '/cart' },
          { label: 'Checkout' },
        ]}
      />
      <Stepper steps={['Delivery', 'Payment', 'Confirmation']} current={0} />
      {/* The key is created per page view; if the form is submitted twice, the server returns the same order. */}
      <CheckoutForm
        pickup={pickup}
        delivery={delivery}
        points={points}
        defaultPoint={preferred}
        idempotencyKey={`co-${randomUUID()}`}
      />
      <p className="mt-4">
        <ButtonLink href="/cart" variant="ghost">
          ← Back to cart
        </ButtonLink>
      </p>
    </>
  )
}
