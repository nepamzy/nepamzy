import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { PageHeader, SampleDataNote } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { Table, Td } from '@/components/ui/table'
import { MOCK_VENDORS } from '@/mocks/data'

export const metadata: Metadata = { title: 'Catalogue' }
export default function Catalogue() {
  const products = MOCK_VENDORS[0]?.products ?? []
  return (
    <>
      <PageHeader title="Catalogue" subtitle="Product management arrives in a later release." />
      <SampleDataNote />
      <Table caption="Sample products" head={['Product', 'Price', 'Availability']}>
        {products.map((p) => (
          <tr key={p.id}>
            <Td>{p.name}</Td>
            <Td>
              <Money kobo={p.priceKobo} />
            </Td>
            <Td>
              <Badge tone={p.available ? 'success' : 'neutral'}>
                {p.available ? 'Available' : 'Sold out'}
              </Badge>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  )
}
