import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { PageHeader, SampleDataNote } from '@/components/ui/card'
import { Table, Td } from '@/components/ui/table'
import { MOCK_APPLICATIONS } from '@/mocks/data'

export const metadata: Metadata = { title: 'Applications' }
export default function Applications() {
  return (
    <>
      <PageHeader title="Applications" subtitle="Approvals arrive in a later release." />
      <SampleDataNote />
      <Table caption="Sample applications" head={['Name', 'Type', 'Submitted', 'Status']}>
        {MOCK_APPLICATIONS.map((a) => (
          <tr key={a.id}><Td>{a.name}</Td><Td>{a.type}</Td><Td>{a.submitted}</Td><Td><Badge tone="warning">{a.status}</Badge></Td></tr>
        ))}
      </Table>
    </>
  )
}
