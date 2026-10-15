import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
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
        title="Earnings"
        subtitle="What your completed orders add up to after AFIT Market's commission."
      />
      <p
        role="note"
        className="mb-4 rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 text-warning-700"
      >
        <strong>Nothing has been paid out.</strong> {s.payout.note} These are calculated amounts
        only.
      </p>

      <Card className="mb-4 space-y-2">
        <h2 className="text-lg font-bold">How the commission works</h2>
        <p>
          AFIT Market keeps a commission of <strong>{pct(s.rates.commission_bps)}</strong> of the
          product value of each completed order (after any product discount). Delivery fees are not
          part of it. If part of an order is refunded, the commission on that part is returned to
          you. The rate in force when an order completes is saved with that order and does not
          change later.
        </p>
      </Card>

      <h2 className="mb-2 text-lg font-bold">Completed orders (final)</h2>
      <Card className="mb-4">
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

      <h2 className="mb-2 text-lg font-bold">Paid orders not yet completed (estimate)</h2>
      <Card className="mb-6">
        <p>
          {s.pending.orders} order(s) worth <Money kobo={s.pending.gross_sales_kobo} />. Estimated
          commission <Money kobo={s.pending.estimated_commission_kobo} />.{' '}
          <span className="text-muted">{s.pending.note}</span>
        </p>
      </Card>

      <h2 className="mb-2 text-lg font-bold">Recent completed orders</h2>
      {s.recent.length === 0 ? (
        <EmptyState title="No completed orders yet">
          Orders appear here once they are completed.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {s.recent.map((o) => (
            <li key={o.order_id}>
              <Card className="space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{o.order_number}</span>
                  <Badge tone="success">Completed {day(o.completed_at)}</Badge>
                </p>
                <p className="text-sm">
                  Product sales <Money kobo={o.gross_kobo} />; commission {pct(o.commission_bps)} ={' '}
                  <Money kobo={o.commission_kobo} />
                  {o.refunded_kobo > 0 && (
                    <>
                      ; refunded <Money kobo={o.refunded_kobo} /> (commission returned{' '}
                      <Money kobo={o.commission_reversed_kobo} />)
                    </>
                  )}
                  .
                </p>
                <p className="font-semibold">
                  Calculated amount due: <Money kobo={o.payable_kobo} />
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
