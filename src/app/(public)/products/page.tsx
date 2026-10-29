import type { Metadata } from 'next'
import Link from 'next/link'
import { ShopFilters } from '@/components/domain/shop-filters'
import { Icon } from '@/components/ui/icons'
import { PageHeader } from '@/components/ui/card'
import { ProductCard, categoryIcon } from '@/components/ui/product-card'
import { EmptyState } from '@/components/ui/states'
import {
  PAGE_SIZE,
  allowSearch,
  browseProducts,
  listCategories,
  parseFilters,
} from '@/server/modules/vendors-and-catalogue/public'
import { cn } from '@/components/ui/cn'

export const metadata: Metadata = { title: 'Items' }

export default async function Products({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const f = parseFilters(await searchParams)
  const cats = await listCategories()
  const allowed = f.q === '' || (await allowSearch())
  const rows = allowed ? await browseProducts(f) : null
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const base = {
      q: f.q,
      category: f.category,
      open: f.open,
      maxn: f.max ? String(Math.round(f.max / 100)) : '',
      sort: f.sort === 'recommended' ? '' : f.sort,
      ...over,
    }
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v)
    const s = p.toString()
    return `/products${s ? `?${s}` : ''}`
  }
  const hasNext = (rows?.length ?? 0) > PAGE_SIZE
  const chip = (active: boolean) =>
    cn(
      'touch-target inline-flex items-center rounded-full border px-4 text-sm font-bold',
      active
        ? 'border-navy-900 bg-navy-900 text-white'
        : 'border-line-strong bg-card text-navy-900 hover:bg-brand-50',
    )
  return (
    <>
      <PageHeader
        title="Items"
        subtitle="Everything from approved campus shops"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Items' }]}
      />
      <nav aria-label="Categories" className="mb-4 flex flex-wrap gap-2">
        <Link
          href={href({ category: undefined, page: undefined })}
          className={chip(!f.category)}
          aria-current={!f.category ? 'true' : undefined}
        >
          All
        </Link>
        {cats.map((c) => (
          <Link
            key={c.id}
            href={href({ category: c.slug })}
            className={chip(f.category === c.slug)}
            aria-current={f.category === c.slug ? 'true' : undefined}
          >
            <Icon name={categoryIcon(c.slug)} size={16} className="mr-1.5" />
            {c.name}
          </Link>
        ))}
      </nav>
      <ShopFilters action="/products" filters={f} categories={cats} />
      {!allowed ? (
        <EmptyState title="Too many searches" icon="clock">
          Please wait a minute and try again.
        </EmptyState>
      ) : rows === null ? (
        <EmptyState title="We could not load items" icon="alert">
          Please try again in a moment.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title={f.q || f.category || f.max ? 'No items match' : 'No items yet'}
          icon="search"
          action={
            <Link href="/products" className="font-bold text-brand-700 hover:underline">
              Clear filters
            </Link>
          }
        >
          {f.q || f.category || f.max
            ? 'Try different words, a higher price limit, or another category.'
            : 'Items appear here as soon as approved shops add them.'}
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            Showing {Math.min(rows.length, PAGE_SIZE)} items on page {f.page}
          </p>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {rows.slice(0, PAGE_SIZE).map((p) => (
              <li key={p.id}>
                <ProductCard
                  href={`/products/${p.id}`}
                  name={p.name}
                  vendorName={p.vendor_name}
                  priceKobo={p.price_kobo}
                  available={p.available}
                  openNow={p.open_now}
                  icon={categoryIcon(p.category_slug)}
                />
              </li>
            ))}
          </ul>
          <nav aria-label="Pages" className="mt-6 flex items-center justify-between">
            {f.page > 1 ? (
              <Link
                className="touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-card px-4 font-bold hover:bg-brand-50"
                href={href({ page: String(f.page - 1) })}
              >
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-muted">Page {f.page}</span>
            {hasNext ? (
              <Link
                className="touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-card px-4 font-bold hover:bg-brand-50"
                href={href({ page: String(f.page + 1) })}
              >
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </>
  )
}
