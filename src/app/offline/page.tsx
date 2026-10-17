import type { Metadata } from 'next'
import { RetryButton } from '@/components/ui/states'
import { Card } from '@/components/ui/card'

export const metadata: Metadata = { title: 'You are offline' }
export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16">
      <Card className="text-center">
        <h1 className="text-xl font-bold">You are offline</h1>
        <p className="mt-2 text-muted">
          Check your connection. Anything you already opened may still be available. We will not
          place or change orders while you are offline.
        </p>
        <div className="mt-4 flex justify-center">
          <RetryButton label="Reconnect and retry" />
        </div>
      </Card>
    </main>
  )
}
