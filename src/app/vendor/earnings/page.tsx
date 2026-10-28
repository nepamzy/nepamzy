import type { Metadata } from 'next'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard, MetricGrid } from '@/components/ui/metric-card'
import { Section } from '@/components/ui/section'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { vendorSettlement } from '@/server/modules/settlement/queries'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Earnings' }

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
const day = (v: string) => new Date(v).toLocaleDateString('en-NG')

export default async function Earnings() {
  const vendor = await getMyVendor()
  const s = vendor ? await vendorSettlement(vendor.id) : null
  if (!vendor || !s)
    return <EmptyState title="Unavailable">Your earnings could not be loaded.</EmptyState>
  const f = s.finalised
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Shop', href: '/vendor' }, { label: 'Earnings' }]}
        title="Earnings"
        subtitle="What your completed orders add up to after AFIT Market's commission."
      />
      <Alert tone="warning" plain title="Nothing has been paid out">
        {s.payout.note} These are calculated amounts only.
      </Alert>

      <div className="mt-4">
        <MetricGrid>
          <MetricCard label="Completed orders" value={f.orders} icon="check-circle" />
          <MetricCard
            label="Product sales"
            value={<Money kobo={f.gross_sales_kobo} />}
            icon="chart"
            accent="success"
          />
          <MetricCard
            label="Commission"
            value={<Money kobo={f.commission_kobo} />}
            note={`${pct(s.rates.commission_bps)} of product value`}
            icon="coins"
            accent="gold"
          />
          <MetricCard
            label="Calculated amount due"
            value={<Money kobo={f.payable_kobo} />}
            note="Not a payout. See below."
            icon="card"
          />
        </MetricGrid>
      </div>

      <Card className="mb-6 space-y-2">
        <h2 className="text-lg font-bold">How the commission works</h2>
        <p>
          AFIT Market keeps a commission of <strong>{pct(s.rates.commission_bps)}</strong> of the
          product value of each completed order (after any product discount). Delivery fees are not
          part of it. If part of an order is refunded, the commission on that part is returned to
          you. The rate in force when an order completes is saved with that order and does not
          change later.
        </p>
      </Card>

      <Section title="Completed orders (final)" id="final">
        <Card>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1">
            <dt>Orders</dt>
            <dd className="font-semibold">{f.orders}</dd>
            <dt>Product sales</dt>
            <dd className="font-semibold">
              <Money kobo={f.gross_sales_kobo} />
            </dd>
            <dt>Commission</dt>
            <dd className="font-semibold">
              − <Money kobo={f.commission_kobo} />
            </dd>
            <dt>Refunded product value</dt>
            <dd className="font-semibold">
              − <Money kobo={f.refunded_sales_kobo} />
            </dd>
            <dt>Commission returned on refunds</dt>
            <dd className="font-semibold">
              + <Money kobo={f.commission_reversed_kobo} />
            </dd>
            <dt className="font-bold">Calculated amount due to you</dt>
            <dd className="font-bold">
              <Money kobo={f.payable_kobo} />
            </dd>
            <dt className="text-sm text-muted">
              Delivery fees on these orders (not yours, not in the commission)
            </dt>
            <dd className="text-sm text-muted">
              <Money kobo={f.delivery_fees_kobo} />
            </dd>
          </dl>
        </Card>
      </Section>

      <Section title="Paid orders not yet completed (estimate)" id="pending">
        <Card>
          <p>
            {s.pending.orders} order(s) worth <Money kobo={s.pending.gross_sales_kobo} />. Estimated
            commission <Money kobo={s.pending.estimated_commission_kobo} />.{' '}
            <span className="text-muted">{s.pending.note}</span>
          </p>
        </Card>
      </Section>

      <Section
        title="Settlement history"
        description="Your most recent completed orders and how each amount was worked out."
        id="history"
      >
        <DataTable
          caption="Recent completed orders"
          rows={s.recent}
          rowKey={(o) => o.order_id}
          empty={
            <EmptyState title="No completed orders yet">
              Orders appear here once they are completed.
            </EmptyState>
          }
          columns={[
            {
              header: 'Order',
              cell: (o) => (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{o.order_number}</span>
                  <Badge tone="success">Completed {day(o.completed_at)}</Badge>
                </span>
              ),
            },
            {
              header: 'Product sales',
              align: 'right',
              cell: (o) => <Money kobo={o.gross_kobo} />,
            },
            {
              header: 'Commission',
              align: 'right',
              cell: (o) => (
                <>
                  <Money kobo={o.commission_kobo} />{' '}
                  <span className="text-muted">({pct(o.commission_bps)})</span>
                </>
              ),
            },
            {
              header: 'Refunded',
              align: 'right',
              cell: (o) =>
                o.refunded_kobo > 0 ? (
                  <>
                    <Money kobo={o.refunded_kobo} />{' '}
                    <span className="text-muted">
                      (commission returned <Money kobo={o.commission_reversed_kobo} />)
                    </span>
                  </>
                ) : (
                  <span className="text-muted">None</span>
                ),
            },
            {
              header: 'Amount due',
              align: 'right',
              cell: (o) => <Money kobo={o.payable_kobo} className="font-bold" />,
            },
          ]}
        />
      </Section>
    </>
  )
}
