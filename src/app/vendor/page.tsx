import type { Metadata } from 'next'
import Link from 'next/link'
import { OrderStatusPill } from '@/components/domain/order-status'
import { Badge } from '@/components/ui/badge'
import { BarChart } from '@/components/ui/bar-chart'
import { Button, ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard, MetricGrid } from '@/components/ui/metric-card'
import { Money } from '@/components/ui/money'
import { Section } from '@/components/ui/section'
import { EmptyState } from '@/components/ui/states'
import { vendorReviews } from '@/server/modules/engagement/queries'
import { listOrders } from '@/server/modules/orders-and-state-machine/queries'
import { vendorSettlement } from '@/server/modules/settlement/queries'
import { setClosedAction } from '@/server/modules/vendors-and-catalogue/actions'
import {
  getMyVendor,
  getShop,
  listProducts,
} from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Vendor dashboard' }

/** Orders that need the shop to do something right now. */
const NEEDS_ACTION = ['PAID', 'VENDOR_REVIEW']
const IN_KITCHEN = ['ACCEPTED', 'PREPARING']
const READY = ['READY', 'PICKUP_AWAITING_HANDOVER', 'AWAITING_RIDER']
/** Not real sales: never paid, or cancelled. */
const NOT_SALES = ['PENDING_PAYMENT', 'CANCELLED']

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

export default async function VendorHome() {
  const vendor = await getMyVendor()
  if (!vendor)
    return (
      <EmptyState title="No vendor account yet">
        You have the vendor role but no shop is linked to this account. Contact support.
      </EmptyState>
    )
  const [orders, products, shop, settlement, reviews] = await Promise.all([
    listOrders({ vendorId: vendor.id, limit: 1000 }),
    listProducts(vendor.id),
    getShop(vendor.id),
    vendorSettlement(vendor.id),
    vendorReviews(vendor.slug),
  ])
  const closed = shop.vendor?.temporarily_closed ?? false
  const approved = vendor.status === 'approved'

  const today = dayKey(new Date())
  const sales = orders.filter((o) => !NOT_SALES.includes(o.status))
  const todays = sales.filter((o) => dayKey(new Date(o.created_at)) === today)
  const count = (codes: string[]) => orders.filter((o) => codes.includes(o.status)).length

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - (13 - i))
    return d
  })
  const chart = days.map((d) => ({
    label: d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
    value: sales.filter((o) => dayKey(new Date(o.created_at)) === dayKey(d)).length,
  }))
  const sevenDaysAgo = days[7]!.getTime()
  const lastSevenSales = sales
    .filter((o) => sevenDaysAgo <= new Date(o.created_at).getTime())
    .reduce((n, o) => n + o.items_total_kobo, 0)
  const unavailable = products.filter((p) => !p.is_available).length

  const queues: [string, number, string][] = [
    ['New paid orders to accept', count(NEEDS_ACTION), '/vendor/orders'],
    ['Being prepared', count(IN_KITCHEN), '/vendor/orders'],
    ['Ready for collection or a rider', count(READY), '/vendor/handover'],
    ['Return requests', count(['RETURN_REQUESTED', 'RETURN_IN_PROGRESS']), '/vendor/returns'],
  ]

  return (
    <>
      <PageHeader
        title={vendor.name}
        subtitle="Your shop at a glance. Every figure comes from your real orders."
        actions={
          <>
            <Badge tone={approved ? 'success' : 'danger'}>
              {approved ? 'Approved' : 'Suspended'}
            </Badge>
            <ButtonLink href="/vendor/catalogue/new" variant="gold">
              Add an item
            </ButtonLink>
          </>
        }
      />

      <MetricGrid>
        <MetricCard
          label="Orders today"
          value={<span data-testid="paid-count">{todays.length}</span>}
          note={`${sales.length} paid orders in total`}
          icon="package"
        />
        <MetricCard
          label="Waiting for you"
          value={count(NEEDS_ACTION)}
          note="Paid orders to accept"
          icon="clipboard"
          accent="gold"
          href="/vendor/orders"
        />
        <MetricCard
          label="Sales, last 7 days"
          value={<Money kobo={lastSevenSales} />}
          note="Product value before commission"
          icon="chart"
          accent="success"
        />
        <MetricCard
          label="Calculated amount due"
          value={<Money kobo={settlement?.finalised.payable_kobo ?? 0} />}
          note="Completed orders after commission. Nothing is paid out yet."
          icon="coins"
          href="/vendor/earnings"
        />
      </MetricGrid>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-2 text-lg font-extrabold text-navy-900">Orders, last 14 days</h2>
          <BarChart data={chart} label="Paid orders per day, last 14 days" />
        </Card>
        <Card className="space-y-3">
          <h2 className="text-lg font-extrabold text-navy-900">Shop status</h2>
          <p>
            {!approved
              ? 'Your shop is suspended. Customers cannot order.'
              : closed
                ? 'You have paused orders. Customers can see your shop but cannot order.'
                : 'You are taking orders during your opening hours.'}
          </p>
          <form action={setClosedAction} className="space-y-2">
            <input type="hidden" name="vendorId" value={vendor.id} />
            <input type="hidden" name="closed" value={closed ? '0' : '1'} />
            <Button type="submit" variant="secondary" disabled={!approved}>
              {closed ? 'Resume orders' : 'Pause orders'}
            </Button>
            <p className="text-sm text-muted">
              {closed
                ? 'Customers will be able to order again during your opening hours.'
                : 'Customers cannot start new orders until you resume. Orders already paid are not affected.'}
            </p>
          </form>
          <p className="text-sm text-muted">
            {products.length} items on your menu
            {unavailable > 0 ? `, ${unavailable} marked unavailable` : ''}.{' '}
            <Link className="font-semibold text-brand-700 underline" href="/vendor/catalogue">
              Manage catalogue
            </Link>
          </p>
          <p className="text-sm text-muted">
            {reviews && reviews.count > 0
              ? `Customer rating ${((reviews.average_tenths ?? 0) / 10).toFixed(1)} out of 5 from ${reviews.count} review${reviews.count === 1 ? '' : 's'}. `
              : 'No customer reviews yet. '}
            <Link className="font-semibold text-brand-700 underline" href="/vendor/reviews">
              See reviews
            </Link>
          </p>
        </Card>
      </div>

      <Section
        title="Needs attention"
        description="The work that is waiting for your shop."
        id="queues"
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {queues.map(([label, n, href]) => (
            <li key={label}>
              <Link
                href={href}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-pop)]"
              >
                <span className="text-sm font-semibold text-muted">{label}</span>
                <span
                  className={`text-2xl font-extrabold ${n > 0 ? 'text-navy-900' : 'text-muted'}`}
                >
                  {n}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Recent orders"
        id="recent"
        actions={
          <Link href="/vendor/orders" className="text-sm font-bold text-brand-700 underline">
            View all
          </Link>
        }
      >
        <DataTable
          caption="Your most recent paid orders"
          rows={sales.slice(0, 6)}
          rowKey={(o) => o.id}
          empty={
            <EmptyState title="No paid orders yet">
              When a customer pays, the order appears here and in Orders.
            </EmptyState>
          }
          columns={[
            {
              header: 'Order',
              cell: (o) => <span className="font-semibold">{o.order_number}</span>,
            },
            { header: 'Type', cell: (o) => (o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup') },
            {
              header: 'Items total',
              align: 'right',
              cell: (o) => <Money kobo={o.items_total_kobo} />,
            },
            { header: 'Status', cell: (o) => <OrderStatusPill code={o.status} /> },
            { header: 'Placed', cell: (o) => new Date(o.created_at).toLocaleString('en-NG') },
          ]}
        />
      </Section>
    </>
  )
}
