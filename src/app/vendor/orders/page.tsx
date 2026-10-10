import type { Metadata } from 'next'
import { OrderStatusPill } from '@/components/domain/order-status'
import { PageHeader, SampleDataNote } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { Table, Td } from '@/components/ui/table'
import { MOCK_ORDERS } from '@/mocks/data'

export const metadata: Metadata = { title: 'Vendor orders' }
export default function VendorOrders() {
  return (
    <>
      <PageHeader title="Orders" />
      <SampleDataNote />
      <Table caption="Sample vendor orders" head={['Order', 'Type', 'Total', 'Status']}>
        {MOCK_ORDERS.map((o) => (
          <tr key={o.id}>
            <Td>{o.id}</Td>
            <Td>{o.mode}</Td>
            <Td>
              <Money kobo={o.totalKobo} />
            </Td>
            <Td>
              <OrderStatusPill code={o.status} />
            </Td>
          </tr>
        ))}
      </Table>
    </>
  )
}
