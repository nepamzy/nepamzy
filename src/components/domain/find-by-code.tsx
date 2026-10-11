'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import {
  findPickupByCodeAction,
  type PickupLookup,
} from '@/server/modules/orders-and-state-machine/actions'

/** Types the customer's code to find which waiting order it belongs to. Finding an order never completes it. */
export function FindByCode() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<PickupLookup | null>(null)
  const [pending, start] = useTransition()
  return (
    <section
      aria-labelledby="fbc"
      className="mb-6 space-y-3 rounded-[var(--radius-card)] border border-line p-4"
    >
      <h3 id="fbc" className="font-bold">
        Find an order by its code
      </h3>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => setResult(await findPickupByCodeAction(code)))
        }}
      >
        <Input
          label="Code the customer shows you"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
        />
        <Button type="submit" variant="secondary" disabled={pending || code.trim().length < 4}>
          {pending ? 'Looking…' : 'Find order'}
        </Button>
      </form>
      {result && (
        <div role="status" className="text-sm">
          {result.found ? (
            <>
              <p className="font-semibold">
                Order {result.orderNumber}:{' '}
                {result.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
              </p>
              <p>
                <a
                  className="font-semibold text-brand-700 underline"
                  href={`#order-${result.orderId}`}
                >
                  Go to this order to complete the handover
                </a>{' '}
                (the customer must still sign).
              </p>
            </>
          ) : (
            <p className="font-medium text-danger-700">{result.message}</p>
          )}
        </div>
      )}
    </section>
  )
}
