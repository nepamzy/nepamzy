import type { Metadata } from 'next'
import { Card, PageHeader, SampleDataNote } from '@/components/ui/card'
import { Money } from '@/components/ui/money'

export const metadata: Metadata = { title: 'Vendor dashboard' }
export default function VendorHome() {
  return (
    <>
      <PageHeader title="Vendor dashboard" />
      <SampleDataNote />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">New orders</p>
          <p className="text-3xl font-bold">3</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Being prepared</p>
          <p className="text-3xl font-bold">2</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Sales today</p>
          <p className="text-3xl font-bold">
            <Money kobo={1850000} />
          </p>
        </Card>
      </div>
    </>
  )
}
