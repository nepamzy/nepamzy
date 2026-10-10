import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Rider profile' }
export default function RiderProfile() {
  return (
    <>
      <PageHeader title="Rider profile" />
      <Card>
        <p className="text-muted">Rider onboarding and approval arrive in a later release.</p>
      </Card>
    </>
  )
}
