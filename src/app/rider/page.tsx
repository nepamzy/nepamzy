import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Rider home' }
export default function RiderHome() {
  return (
    <>
      <PageHeader title="Rider home" />
      <Card className="space-y-4">
        <p className="flex items-center gap-2 text-lg font-semibold">
          Status: <Badge>Off duty</Badge>
        </p>
        <p>
          Location sharing is <strong>OFF</strong>. This app never collects your location until you
          choose <strong>Go Active</strong>.
        </p>
        <div className="rounded-[var(--radius-control)] bg-brand-50 p-3 text-sm">
          <p className="font-semibold">What Go Active will mean (when delivery opens):</p>
          <ul className="mt-1 list-disc pl-5">
            <li>Your phone’s location is shared while you are active and have delivery work.</li>
            <li>Only the customer you are delivering to, and authorised staff, can see it.</li>
            <li>It stops when you go inactive or have no active deliveries.</li>
          </ul>
        </div>
        <p className="rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 font-medium text-warning-700">
          Preview only. No location is collected in this version.
        </p>
        <Button disabled>Go Active (not available yet)</Button>
      </Card>
    </>
  )
}
