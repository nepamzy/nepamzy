import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { listOrders } from '@/server/modules/orders-and-state-machine/queries'
import { setClosedAction } from '@/server/modules/vendors-and-catalogue/actions'
import {
  getMyVendor,
  getShop,
  listProducts,
} from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Vendor dashboard' }

export default async function VendorHome() {
  const vendor = await getMyVendor()
  if (!vendor)
    return (
      <EmptyState title="No vendor account yet">
        You have the vendor role but no shop is linked to this account. Contact support.
      </EmptyState>
    )
  const [orders, products, shop] = await Promise.all([
    listOrders({ vendorId: vendor.id, limit: 200 }),
    listProducts(vendor.id),
    getShop(vendor.id),
  ])
  const paid = orders.filter((o) => o.status === 'PAID')
  const unpaid = orders.filter((o) => o.status === 'PENDING_PAYMENT')
  const closed = shop.vendor?.temporarily_closed ?? false
  return (
    <>
      <PageHeader
        title={vendor.name}
        subtitle="Vendor dashboard"
        actions={
          <Badge tone={vendor.status === 'approved' ? 'success' : 'danger'}>
            {vendor.status === 'approved' ? 'Approved' : 'Suspended'}
          </Badge>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Paid orders</p>
          <p className="text-3xl font-bold" data-testid="paid-count">
            {paid.length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Waiting for payment</p>
          <p className="text-3xl font-bold">{unpaid.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Paid total</p>
          <p className="text-3xl font-bold">
            <Money kobo={paid.reduce((n, o) => n + o.items_total_kobo, 0)} />
          </p>
        </Card>
      </div>
      <Card className="mt-5 space-y-3">
        <p>
          <span className="font-semibold">Items on your menu:</span> {products.length}.{' '}
          <Link className="font-semibold text-brand-700 underline" href="/vendor/catalogue">
            Manage catalogue
          </Link>
        </p>
        <form action={setClosedAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="vendorId" value={vendor.id} />
          <input type="hidden" name="closed" value={closed ? '0' : '1'} />
          <span>
            {closed
              ? 'You have paused orders.'
              : 'You are taking orders during your opening hours.'}
          </span>
          <Button type="submit" variant="secondary" disabled={vendor.status !== 'approved'}>
            {closed ? 'Resume orders' : 'Pause orders'}
          </Button>
        </form>
        <p className="text-sm text-muted">
          Manage incoming orders on the Orders page: accept, prepare and mark them ready. Use
          Handover to confirm collection and Returns to respond to return requests.
        </p>
      </Card>
    </>
  )
}
