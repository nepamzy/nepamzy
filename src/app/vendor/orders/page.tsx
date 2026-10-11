import type { Metadata } from 'next'
import Link from 'next/link'
import { OrderStatusPill } from '@/components/domain/order-status'
import { PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { Table, Td } from '@/components/ui/table'
import { listOrders } from '@/server/modules/orders-and-state-machine/queries'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Vendor orders' }

export default async function VendorOrders() {
  const vendor = await getMyVendor()
  const orders = vendor ? await listOrders({ vendorId: vendor.id }) : []
  return (
    <>
      <PageHeader title="Orders" subtitle="Read-only for now. Accepting and preparing orders arrives in the next release." />
      {orders.length === 0 ? <EmptyState title="No orders yet">New orders will appear here.</EmptyState> : (
        <Table caption="Orders for your shop" head={['Order', 'Type', 'Items', 'Placed', 'Status']}>
          {orders.map((o) => (
            <tr key={o.id}>
              <Td><span className="font-semibold">{o.order_number}</span></Td><Td>{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</Td>
              <Td><Money kobo={o.items_total_kobo} /></Td><Td>{new Date(o.created_at).toLocaleString('en-NG')}</Td><Td><OrderStatusPill code={o.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 text-xs text-muted"><Link href="/vendor" className="underline">Back to dashboard</Link></p>
    </>
  )
}
