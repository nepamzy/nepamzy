import { lagosDate } from '@/lib/time'
import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard, MetricGrid } from '@/components/ui/metric-card'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { pageParam, vendorReviews } from '@/server/modules/engagement/queries'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Customer reviews' }

/**
 * REAL data: the published reviews customers left for this shop (the same ones the public shop page shows).
 * Reviews are never edited or deleted here; reporting a review is done by support staff, not by the shop.
 */
export default async function VendorReviews({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const page = pageParam((await searchParams).page)
  const vendor = await getMyVendor()
  const r = vendor ? await vendorReviews(vendor.slug, page) : null
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Shop', href: '/vendor' }, { label: 'Reviews' }]}
        title="Customer reviews"
        subtitle="What customers said after their order. Reviews cannot be changed by the shop."
      />
      {!r ? (
        <EmptyState title="We could not load your reviews" icon="alert">
          Please try again in a moment.
        </EmptyState>
      ) : (
        <>
          <MetricGrid>
            <MetricCard
              label="Average rating"
              value={
                r.count === 0 ? 'None yet' : `${((r.average_tenths ?? 0) / 10).toFixed(1)} / 5`
              }
              icon="star"
              accent="gold"
            />
            <MetricCard label="Published reviews" value={r.count} icon="clipboard" />
          </MetricGrid>
          <DataTable
            caption="Published reviews"
            rows={r.reviews}
            rowKey={(x) => x.id}
            empty={
              <EmptyState title="No reviews yet" icon="star">
                Customers can leave a review after a completed order.
              </EmptyState>
            }
            columns={[
              {
                header: 'Rating',
                cell: (x) => (
                  <span className="font-bold">
                    {x.rating} / 5<span className="sr-only"> stars</span>
                  </span>
                ),
              },
              {
                header: 'Comment',
                cell: (x) => x.comment ?? <span className="text-muted">No comment</span>,
              },
              { header: 'Date', cell: (x) => lagosDate(x.created_at) },
            ]}
          />
          <Pager basePath="/vendor/reviews" page={page} hasMore={page * 10 < r.count} />
        </>
      )}
    </>
  )
}
