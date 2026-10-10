import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader, SampleDataNote } from '@/components/ui/card'
import { MOCK_VENDORS } from '@/mocks/data'

export const metadata: Metadata = { title: 'Browse vendors' }

export default function Vendors() {
  return (
    <>
      <PageHeader title="Vendors" subtitle="Approved campus vendors" />
      <SampleDataNote />
      <ul className="grid gap-4 sm:grid-cols-2">
        {MOCK_VENDORS.map((v) => (
          <li key={v.id}>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-bold"><Link className="hover:underline" href={`/vendors/${v.id}`}>{v.name}</Link></h2>
                <Badge tone={v.open ? 'success' : 'neutral'}>{v.open ? 'Open' : 'Closed'}</Badge>
              </div>
              <p className="mt-1 text-muted">{v.category} · {v.eta} · ★ {v.rating}</p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}
