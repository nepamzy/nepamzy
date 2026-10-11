'use client'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/fields'
import { Money } from '@/components/ui/money'
import { placeOrderAction, type CheckoutState } from '@/server/modules/cart-and-checkout/actions'
import type { DeliveryPoint, Quote } from '@/server/modules/cart-and-checkout/queries'

export function CheckoutForm({
  pickup,
  delivery,
  points,
  idempotencyKey,
}: {
  pickup: Quote
  delivery: Quote | null
  points: DeliveryPoint[]
  idempotencyKey: string
}) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(placeOrderAction, {})
  const canDeliver = Boolean(delivery) && points.length > 0
  const [mode, setMode] = useState<'pickup' | 'delivery'>('pickup')
  const q = mode === 'delivery' && delivery ? delivery : pickup
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          {state.error}
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-lg font-bold">How do you want to get it?</legend>
        <label className="touch-target flex cursor-pointer items-center gap-3">
          <input
            type="radio"
            name="fulfilment"
            value="pickup"
            checked={mode === 'pickup'}
            onChange={() => setMode('pickup')}
            className="size-5 accent-[var(--color-brand-700)]"
          />
          <span>
            Pickup <span className="text-muted">(free)</span>
          </span>
        </label>
        <label
          className={`touch-target flex items-center gap-3 ${canDeliver ? 'cursor-pointer' : 'text-muted'}`}
        >
          <input
            type="radio"
            name="fulfilment"
            value="delivery"
            disabled={!canDeliver}
            checked={mode === 'delivery'}
            onChange={() => setMode('delivery')}
            className="size-5 accent-[var(--color-brand-700)]"
          />
          <span>
            Delivery{' '}
            {canDeliver && delivery ? (
              <span className="text-muted">
                (+
                <Money kobo={delivery.delivery_fee_kobo} />)
              </span>
            ) : (
              <span>(no delivery points are open yet)</span>
            )}
          </span>
        </label>
      </fieldset>
      {mode === 'pickup' && (
        <Card>
          <p className="font-semibold">Collect from</p>
          <p>{pickup.vendor_name}</p>
          <p className="text-sm text-muted">
            You will show a code at the vendor to collect. (Pickup codes arrive in a later release.)
          </p>
        </Card>
      )}
      {mode === 'delivery' && (
        <Select
          label="Delivery point"
          name="point"
          required
          defaultValue={points[0]?.id}
          hint="Delivery goes only to approved points. Riders are not available yet, so test orders cannot be delivered."
        >
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      )}
      <Card className="space-y-2" aria-labelledby="summary">
        <h2 id="summary" className="text-lg font-bold">
          Summary
        </h2>
        <ul className="space-y-1 text-sm">
          {q.lines.map((l) => (
            <li key={l.item_id} className="flex justify-between gap-2">
              <span>
                {l.quantity} × {l.name}
                {l.options.length ? ` (${l.options.map((o) => o.name).join(', ')})` : ''}
              </span>
              <Money kobo={l.line_total_kobo} />
            </li>
          ))}
        </ul>
        <hr className="border-line" />
        <dl className="space-y-1">
          <div className="flex justify-between">
            <dt>Items</dt>
            <dd>
              <Money kobo={q.items_total_kobo} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Delivery</dt>
            <dd>
              <Money kobo={q.delivery_fee_kobo} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Service fee</dt>
            <dd>
              <Money kobo={q.platform_fee_kobo} />
            </dd>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <dt>Total</dt>
            <dd data-testid="checkout-total">
              <Money kobo={q.total_kobo} />
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          The final amount is calculated again by our server when you place the order.
        </p>
      </Card>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Placing order…' : 'Place order'}
      </Button>
      <p className="text-sm text-muted">
        You pay on the next screen. In this test version payment is a clearly-marked test and no
        real money is taken.
      </p>
    </form>
  )
}
