import type { Metadata } from 'next'
import Link from 'next/link'
import { VendorCardView } from '@/components/domain/vendor-card'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Checkbox, Input, Select } from '@/components/ui/fields'
import { EmptyState } from '@/components/ui/states'
import { Money } from '@/components/ui/money'
import {
  PAGE_SIZE,
  allowSearch,
  browseVendors,
  listCategories,
  parseFilters,
  searchProducts,
} from '@/server/modules/vendors-and-catalogue/public'

export const metadata: Metadata = { title: 'Browse vendors' }

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
      <PageHeader title="Vendors" subtitle="Approved campus vendors" />
      <Card className="mb-5">
        <form role="search" className="grid gap-3 sm:grid-cols-[1fr_12rem_auto_auto] sm:items-end">
          <Input
            label="Search"
            name="q"
            defaultValue={f.q}
            maxLength={60}
            placeholder="Vendor or item"
          />
          <Select label="Category" name="category" defaultValue={f.category ?? ''}>
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
          <Checkbox label="Open now" name="open" value="1" defaultChecked={f.open === '1'} />
          <Button type="submit">Apply</Button>
        </form>
      </Card>
      {!allowed ? (
        <EmptyState title="Too many searches">Please wait a minute and try again.</EmptyState>
      ) : vendors === null ? (
        <EmptyState title="We could not load vendors">Please try again in a moment.</EmptyState>
      ) : (
        <div className="space-y-6">
          {vendors.length === 0 && (products?.length ?? 0) === 0 ? (
            <EmptyState title={searching ? 'No matches' : 'No vendors yet'}>
              {searching
                ? 'Try a different word, or clear the filters.'
                : 'Approved vendors will appear here.'}
            </EmptyState>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {vendors.slice(0, PAGE_SIZE).map((v) => (
                <li key={v.id}>
                  <VendorCardView v={v} />
                </li>
              ))}
            </ul>
          )}
          {searching && (products ?? []).length > 0 && (
            <section aria-labelledby="items">
              <h2 id="items" className="mb-3 text-xl font-bold">
                Matching items
              </h2>
              <ul className="space-y-2">
                {(products ?? []).slice(0, PAGE_SIZE).map((p) => (
                  <li key={p.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-2 p-3 sm:p-3">
                      <div>
                        <Link href={`/products/${p.id}`} className="font-semibold hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-sm text-muted">
                          {p.vendor_name}
                          {p.open_now ? '' : ' · closed now'}
                          {p.available ? '' : ' · sold out'}
                        </p>
                      </div>
                      <Money kobo={p.price_kobo} className="font-semibold" />
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <nav aria-label="Pages" className="flex justify-between">
            {f.page > 1 ? (
              <Link className="font-semibold text-brand-700 underline" href={qs(f.page - 1)}>
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {hasNext ? (
              <Link className="font-semibold text-brand-700 underline" href={qs(f.page + 1)}>
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
