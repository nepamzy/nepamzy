import type { Metadata } from 'next'
import { RemoveWishlistButton } from '@/components/domain/customer-forms'
import { ButtonLink } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/card'
import { ProductCard } from '@/components/ui/product-card'
import { EmptyState } from '@/components/ui/states'
import { listWishlist } from '@/server/modules/customer/queries'

export const metadata: Metadata = { title: 'Wishlist' }

export default async function WishlistPage() {
  const items = await listWishlist()
  return (
    <>
      <PageHeader
        title="Wishlist"
        subtitle="Items you saved for later"
        breadcrumbs={[{ label: 'My account', href: '/account' }, { label: 'Wishlist' }]}
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          icon="heart"
          action={
            <ButtonLink href="/products" variant="gold">
              Browse items
            </ButtonLink>
          }
        >
          Use Save to wishlist on any item to find it here later.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <li key={p.id} className="space-y-1">
              <ProductCard
                href={`/products/${p.id}`}
                name={p.name}
                vendorName={p.vendor_name}
                priceKobo={p.price_kobo}
                available={p.available}
                openNow={p.open_now}
              />
              <RemoveWishlistButton productId={p.id} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
