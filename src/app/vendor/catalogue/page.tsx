import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button, ButtonLink } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard, MetricGrid } from '@/components/ui/metric-card'
import { NoImageTile } from '@/components/ui/product-card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import {
  archiveProductAction,
  toggleAvailabilityAction,
} from '@/server/modules/vendors-and-catalogue/actions'
import { getMyVendor, listProducts } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Catalogue' }

export default async function Catalogue() {
  const vendor = await getMyVendor()
  if (!vendor) return <EmptyState title="No vendor account yet" />
  const products = await listProducts(vendor.id)
  const onSale = products.filter((p) => p.is_available && p.stock_quantity !== 0).length
  const approved = vendor.status === 'approved'
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Shop', href: '/vendor' }, { label: 'Catalogue' }]}
        title="Catalogue"
        subtitle="Your menu as customers see it"
        actions={
          approved ? (
            <ButtonLink href="/vendor/catalogue/new" variant="gold">
              Add an item
            </ButtonLink>
          ) : undefined
        }
      />
      <MetricGrid>
        <MetricCard label="Items on your menu" value={products.length} icon="package" />
        <MetricCard label="On sale now" value={onSale} icon="check-circle" accent="success" />
        <MetricCard
          label="Sold out or hidden"
          value={products.length - onSale}
          icon="alert"
          accent="gold"
        />
      </MetricGrid>
      <Alert tone="info" plain title="Photos">
        Item photos are not available yet because file storage has not been set up. Customers see a
        simple placeholder tile for each item.
      </Alert>
      <div className="mt-4">
        <DataTable
          caption="Your catalogue"
          rows={products}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              title="Your menu is empty"
              action={<ButtonLink href="/vendor/catalogue/new">Add your first item</ButtonLink>}
            >
              Customers can only see items you add here.
            </EmptyState>
          }
          columns={[
            {
              header: 'Item',
              cell: (p) => (
                <span className="flex items-center gap-3">
                  <NoImageTile icon="bag" className="aspect-square! w-10! shrink-0 rounded-lg" />
                  <span className="min-w-0">
                    <Link
                      href={`/vendor/catalogue/${p.id}`}
                      className="font-semibold hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="block text-sm text-muted">
                      {[
                        p.section,
                        p.stock_quantity === null
                          ? 'Unlimited stock'
                          : `${p.stock_quantity} in stock`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              header: 'Price',
              align: 'right',
              cell: (p) => <Money kobo={p.price_kobo} className="font-semibold" />,
            },
            {
              header: 'Status',
              cell: (p) => (
                <Badge tone={p.is_available && p.stock_quantity !== 0 ? 'success' : 'neutral'}>
                  {p.is_available && p.stock_quantity !== 0 ? 'On sale' : 'Sold out'}
                </Badge>
              ),
            },
            {
              header: 'Actions',
              cell: (p) => (
                <span className="flex flex-wrap items-center gap-2">
                  <form action={toggleAvailabilityAction}>
                    <input type="hidden" name="productId" value={p.id} />
                    <input type="hidden" name="available" value={p.is_available ? '0' : '1'} />
                    <Button type="submit" variant="secondary" disabled={!approved}>
                      {p.is_available ? 'Mark sold out' : 'Put back on sale'}
                    </Button>
                  </form>
                  <form action={archiveProductAction}>
                    <input type="hidden" name="productId" value={p.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      disabled={!approved}
                      aria-label={`Remove ${p.name} from menu`}
                    >
                      Remove
                    </Button>
                  </form>
                </span>
              ),
            },
          ]}
        />
      </div>
    </>
  )
}
