import type { Metadata } from 'next'
import Link from 'next/link'
import { ShopFilters } from '@/components/domain/shop-filters'
import { VendorCardView } from '@/components/domain/vendor-card'
import { PageHeader } from '@/components/ui/card'
import { ProductCard, categoryIcon } from '@/components/ui/product-card'
import { Section } from '@/components/ui/section'
import { EmptyState } from '@/components/ui/states'
import {
  PAGE_SIZE,
  allowSearch,
  browseVendors,
  listCategories,
  parseFilters,
  searchProducts,
} from '@/server/modules/vendors-and-catalogue/public'

export const metadata: Metadata = { title: 'Shops' }

export default async function Vendors({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const f = parseFilters(await searchParams)
  const cats = await listCategories()
  const searching = f.q !== ''
  const allowed = !searching || (await allowSearch())
  const [vendors, products] = allowed
    ? await Promise.all([browseVendors(f), searchProducts(f)])
    : [null, null]
  const qs = (page: number) => {
    const p = new URLSearchParams()
    if (f.q) p.set('q', f.q)
    if (f.category) p.set('category', f.category)
    if (f.open) p.set('open', '1')
    if (f.max) p.set('max', String(f.max))
    if (page > 1) p.set('page', String(page))
    const s = p.toString()
    return `/vendors${s ? `?${s}` : ''}`
  }
  const hasNext = (vendors?.length ?? 0) > PAGE_SIZE || (products?.length ?? 0) > PAGE_SIZE
  return (
    <>
      <PageHeader
        title="Shops"
        subtitle="Approved campus vendors"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Shops' }]}
      />
      <ShopFilters
        action="/vendors"
        filters={f}
        categories={cats}
        showSort={false}
        showPrice={false}
      />
      {!allowed ? (
        <EmptyState title="Too many searches" icon="clock">
          Please wait a minute and try again.
        </EmptyState>
      ) : vendors === null ? (
        <EmptyState title="We could not load vendors" icon="alert">
          Please try again in a moment.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {vendors.length === 0 && (products?.length ?? 0) === 0 ? (
            <EmptyState title={searching ? 'No matches' : 'No vendors yet'} icon="store">
              {searching
                ? 'Try a different word, or clear the filters.'
                : 'Approved vendors will appear here.'}
            </EmptyState>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {vendors.slice(0, PAGE_SIZE).map((v) => (
                <li key={v.id}>
                  <VendorCardView v={v} />
                </li>
              ))}
            </ul>
          )}
          {searching && (products ?? []).length > 0 && (
            <Section title="Matching items" id="items">
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {(products ?? []).slice(0, PAGE_SIZE).map((p) => (
                  <li key={p.id}>
                    <ProductCard
                      href={`/products/${p.id}`}
                      name={p.name}
                      vendorName={p.vendor_name}
                      priceKobo={p.price_kobo}
                      available={p.available}
                      openNow={p.open_now}
                      icon={categoryIcon(null)}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <nav aria-label="Pages" className="flex justify-between">
            {f.page > 1 ? (
              <Link className="font-bold text-brand-700 underline" href={qs(f.page - 1)}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {hasNext ? (
              <Link className="font-bold text-brand-700 underline" href={qs(f.page + 1)}>
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>
      )}
    </>
  )
}
