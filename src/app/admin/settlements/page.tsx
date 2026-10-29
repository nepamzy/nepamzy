import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { adminSettlement } from '@/server/modules/settlement/queries'

export const metadata: Metadata = { title: 'Settlements' }

export default async function Settlements() {
  const s = await adminSettlement()
  if (!s)
    return <EmptyState title="Unavailable">Settlement figures could not be loaded.</EmptyState>
  const t = s.totals
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Settlements' }]}
        title="Settlements"
        subtitle={s.note}
      />
      <Card className="mb-6">
        <dl className="grid grid-cols-[1fr_auto] gap-y-1">
          <dt>Completed orders with a settlement line</dt>
          <dd className="font-semibold">{t.orders}</dd>
          <dt>Product sales</dt>
          <dd className="font-semibold">
            <Money kobo={t.gross_sales_kobo} />
          </dd>
          <dt>Vendor commission</dt>
          <dd className="font-semibold">
            <Money kobo={t.commission_kobo} />
          </dd>
          <dt className="pl-4">AFIT Market allocation</dt>
          <dd>
            <Money kobo={t.afit_allocation_kobo} />
          </dd>
          <dt className="pl-4">Paystack-cost budget (not a verified provider fee)</dt>
          <dd>
            <Money kobo={t.paystack_budget_kobo} />
          </dd>
          <dt>Commission returned on refunds</dt>
          <dd className="font-semibold">
            <Money kobo={t.commission_reversed_kobo} />
          </dd>
        </dl>
      </Card>
      <h2 className="mb-2 text-lg font-bold">By vendor</h2>
      {s.vendors.length === 0 ? (
        <EmptyState title="No settlement lines yet">
          Lines are created when an order completes.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {s.vendors.map((v) => (
            <li key={v.vendor_id}>
              <Card className="space-y-1">
                <p className="font-bold">{v.vendor_name}</p>
                <p className="text-sm">
                  {v.orders} order(s); sales <Money kobo={v.gross_sales_kobo} />; commission{' '}
                  <Money kobo={v.commission_kobo} />; calculated amount due to vendor{' '}
                  <Money kobo={v.payable_kobo} />
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
