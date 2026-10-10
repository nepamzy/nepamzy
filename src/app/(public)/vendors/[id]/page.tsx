import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader, SampleDataNote } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { MOCK_VENDORS } from '@/mocks/data'

export const metadata: Metadata = { title: 'Vendor' }

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const vendor = MOCK_VENDORS.find((v) => v.id === id)
  if (!vendor) notFound()
  return (
    <>
      <p className="mb-2"><Link href="/vendors" className="font-semibold text-brand-700 underline">← All vendors</Link></p>
      <PageHeader title={vendor.name} subtitle={`${vendor.category} · ${vendor.eta}`} />
      <SampleDataNote />
      <ul className="space-y-3">
        {vendor.products.map((p) => (
          <li key={p.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{p.name}</p>
                <Money kobo={p.priceKobo} className="text-muted" />
              </div>
              {p.available ? <ButtonLink href="/orders" variant="secondary">Order</ButtonLink> : <Badge>Sold out</Badge>}
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">Placing orders needs an account with a second sign-in step. Ordering is not open yet.</p>
    </>
  )
}
