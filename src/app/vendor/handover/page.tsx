import type { Metadata } from 'next'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/fields'

export const metadata: Metadata = { title: 'Confirm handover' }
export default function Handover() {
  return (
    <>
      <PageHeader title="Confirm handover" subtitle="Scan the customer’s code or type it in." />
      <Card className="space-y-4">
        <p className="rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 font-medium text-warning-700">
          Preview only. Handover checking is not built yet, so this form does nothing.
        </p>
        <Input
          label="Pickup code"
          name="code"
          disabled
          placeholder="e.g. 7K3-9QX"
          hint="Camera scanning and code checking arrive in a later release."
        />
        <Button disabled>Find order</Button>
      </Card>
    </>
  )
}
