import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icons'
import { NoImageTile, ProductCard, categoryIcon } from '@/components/ui/product-card'
import { Section } from '@/components/ui/section'
import { EmptyState } from '@/components/ui/states'
import { ReportReviewForm } from '@/components/domain/engagement-forms'
import { Pager } from '@/components/ui/pager'
import { pageParam, vendorReviews } from '@/server/modules/engagement/queries'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { WEEKDAYS, hoursByDay } from '@/server/modules/vendors-and-catalogue/hours'
import { getMenu } from '@/server/modules/vendors-and-catalogue/public'

export const metadata: Metadata = { title: 'Vendor' }

export default async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ rpage?: string }>
}) {
  const slug = (await params).slug
  const rpage = pageParam((await searchParams).rpage)
  const menu = await getMenu(slug)
  if (!menu) notFound()
  const { vendor, products, hours } = menu
  const bySection = new Map<string, typeof products>()
  for (const p of products)
    bySection.set(p.section ?? 'Menu', [...(bySection.get(p.section ?? 'Menu') ?? []), p])
  const byDay = hoursByDay(hours)
  const reviews = await vendorReviews(slug, rpage)
  const signedIn = Boolean((await (await createSupabaseServerClient()).auth.getUser()).data.user)
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Shops', href: '/vendors' },
          { label: vendor.name },
        ]}
      />
      <div className="mb-6 overflow-hidden rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)]">
        <NoImageTile
          icon={categoryIcon(null)}
          className="aspect-[16/4] rounded-none"
          label="No banner photo yet"
        />
        <div className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">{vendor.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
              {vendor.category && <span>{vendor.category}</span>}
              <span className="inline-flex items-center gap-1">
                <Icon name="clock" size={16} /> Ready in about {vendor.prep_minutes} min
              </span>
              {reviews && reviews.count > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="star" size={16} className="text-accent-600" />
                  {((reviews.average_tenths ?? 0) / 10).toFixed(1)} ({reviews.count})
                </span>
              )}
            </p>
            {vendor.description && <p className="mt-2 max-w-2xl">{vendor.description}</p>}
            {vendor.pickup_location_text && (
              <p className="mt-2 inline-flex items-center gap-1 text-sm">
                <Icon name="pin" size={16} /> Pickup: {vendor.pickup_location_text}
              </p>
            )}
          </div>
          <Badge tone={vendor.open_now ? 'success' : 'neutral'}>
            {vendor.open_now ? 'Open now' : 'Closed now'}
          </Badge>
        </div>
      </div>
      {!vendor.open_now && (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 font-medium text-warning-700"
        >
          {vendor.temporarily_closed
            ? 'This vendor has paused orders for now.'
            : 'This vendor is closed at the moment. You can browse, but orders open when it reopens.'}
        </p>
      )}
      {products.length === 0 ? (
        <EmptyState title="No items yet" icon="package">
          This shop has not added any items yet.
        </EmptyState>
      ) : (
        [...bySection.entries()].map(([section, items]) => (
          <Section key={section} title={section} id={`s-${section.replace(/\W+/g, '-')}`}>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {items.map((p) => (
                <li key={p.id}>
                  <ProductCard
                    href={`/products/${p.id}`}
                    name={p.name}
                    vendorName={vendor.name}
                    priceKobo={p.price_kobo}
                    available={p.available}
                    openNow={vendor.open_now}
                  />
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}
      <section aria-labelledby="reviews" className="mt-8">
        <h2 id="reviews" className="mb-2 text-lg font-bold">
          Reviews
        </h2>
        {!reviews || reviews.count === 0 ? (
          <p className="text-muted">
            No reviews yet. Only customers with a finished order can review.
          </p>
        ) : (
          <>
            <p className="mb-3">
              <strong>{((reviews.average_tenths ?? 0) / 10).toFixed(1)} out of 5</strong> from{' '}
              {reviews.count} {reviews.count === 1 ? 'review' : 'reviews'}
            </p>
            <ul className="space-y-3">
              {reviews.reviews.map((r) => (
                <li key={r.id}>
                  <Card className="space-y-1 p-3 sm:p-3">
                    <p aria-label={`${r.rating} out of 5`}>{'★'.repeat(r.rating)}</p>
                    {r.comment && <p>{r.comment}</p>}
                    <p className="text-xs text-muted">
                      {new Date(r.created_at).toLocaleDateString('en-NG')}
                    </p>
                    {signedIn && <ReportReviewForm reviewId={r.id} />}
                  </Card>
                </li>
              ))}
            </ul>
            <Pager
              basePath={`/vendors/${slug}`}
              page={rpage}
              pageKey="rpage"
              hasMore={rpage * 10 < reviews.count}
            />
          </>
        )}
      </section>
      <section aria-labelledby="hours" className="mt-8">
        <h2 id="hours" className="mb-2 text-lg font-bold">
          Opening hours
        </h2>
        {hours.length === 0 ? (
          <p className="text-muted">Opening hours have not been set.</p>
        ) : (
          <dl className="grid max-w-sm grid-cols-[7rem_1fr] gap-y-1 text-sm">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className="contents">
                <dt className="font-semibold">{d}</dt>
                <dd>{byDay[i]?.map((r) => `${r.from}–${r.to}`).join(', ') ?? 'Closed'}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-xs text-muted">Times are in Nigeria time (WAT).</p>
      </section>
    </>
  )
}
