import type { Metadata } from 'next'
import Link from 'next/link'
import { VendorOrderActions } from '@/components/domain/vendor-order-actions'
import { OrderStatusPill } from '@/components/domain/order-status'
import { PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { Table, Td } from '@/components/ui/table'
import { listItemsForOrders, listOrders } from '@/server/modules/orders-and-state-machine/queries'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Vendor orders' }

export default async function VendorOrders() {
  const vendor = await getMyVendor()
  const orders = vendor ? await listOrders({ vendorId: vendor.id }) : []
  const items = await listItemsForOrders(orders.map((o) => o.id))
  return (
    <>
      <PageHeader title="Orders" subtitle="Accept paid orders, prepare them and mark them ready." />
      {orders.length === 0 ? (
        <EmptyState title="No orders yet">New orders will appear here.</EmptyState>
      ) : (
        <Table
          caption="Orders for your shop"
          head={['Order', 'Type', 'Items', 'Placed', 'Status', 'Next step']}
        >
          {orders.map((o) => (
            <tr key={o.id}>
              <Td>
                <span className="font-semibold">{o.order_number}</span>
              </Td>
              <Td>{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</Td>
              <Td>
                <ul className="space-y-0.5 text-sm">
                  {(items.get(o.id) ?? []).map((i) => (
                    <li key={i.id}>
                      {i.quantity} × {i.product_name}
                      {i.options.length > 0 && ` (${i.options.map((x) => x.name).join(', ')})`}
                    </li>
                  ))}
                </ul>
                <Money kobo={o.items_total_kobo} className="font-semibold" />
              </Td>
              <Td>{new Date(o.created_at).toLocaleString('en-NG')}</Td>
              <Td>
                <OrderStatusPill code={o.status} />
              </Td>
              <Td>
                <VendorOrderActions orderId={o.id} status={o.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 text-xs text-muted">
        <Link href="/vendor" className="underline">
          Back to dashboard
        </Link>
      </p>
    </>
  )
}
