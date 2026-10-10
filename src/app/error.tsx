'use client'
import { ErrorState } from '@/components/ui/states'

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16">
      <ErrorState onRetry={reset} />
    </main>
  )
}
