'use client'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Icon } from '@/components/ui/icons'
import { Select } from '@/components/ui/fields'
import { Money } from '@/components/ui/money'
import { placeOrderAction, type CheckoutState } from '@/server/modules/cart-and-checkout/actions'
import type { DeliveryPoint, Quote } from '@/server/modules/cart-and-checkout/queries'

export function CheckoutForm({
  pickup,
  delivery,
  points,
  defaultPoint,
  idempotencyKey,
}: {
  pickup: Quote
  delivery: Quote | null
  points: DeliveryPoint[]
  /** The customer's saved default place, when it is still an open delivery point. */
  defaultPoint?: string
  idempotencyKey: string
}) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(placeOrderAction, {})
  const canDeliver = Boolean(delivery) && points.length > 0
  const [mode, setMode] = useState<'pickup' | 'delivery'>('pickup')
  const q = mode === 'delivery' && delivery ? delivery : pickup
  const optionCls = (on: boolean, disabled = false) =>
    `touch-target flex items-start gap-3 rounded-[var(--radius-card)] border-2 p-4 ${disabled ? 'cursor-not-allowed border-line text-muted' : on ? 'cursor-pointer border-navy-900 bg-brand-50' : 'cursor-pointer border-line bg-card hover:border-line-strong'}`
  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="space-y-5">
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        <fieldset className="space-y-3">
          <legend className="mb-1 text-lg font-extrabold text-navy-900">
            1. How do you want to get it?
          </legend>
          <label className={optionCls(mode === 'pickup')}>
            <input
              type="radio"
              name="fulfilment"
              value="pickup"
              checked={mode === 'pickup'}
              onChange={() => setMode('pickup')}
              className="mt-1 size-5 accent-[var(--color-brand-700)]"
            />
            <span>
              <span className="flex items-center gap-2 font-bold text-navy-900">
                <Icon name="store" size={18} /> Pickup{' '}
                <span className="font-normal text-muted">(free)</span>
              </span>
              <span className="block text-sm text-muted">
                Collect from {pickup.vendor_name}. You will show a pickup code at the shop.
              </span>
            </span>
          </label>
          <label className={optionCls(mode === 'delivery', !canDeliver)}>
            <input
              type="radio"
              name="fulfilment"
              value="delivery"
              disabled={!canDeliver}
              checked={mode === 'delivery'}
              onChange={() => setMode('delivery')}
              className="mt-1 size-5 accent-[var(--color-brand-700)]"
            />
            <span>
              <span className="flex items-center gap-2 font-bold text-navy-900">
                <Icon name="truck" size={18} /> Delivery{' '}
                {canDeliver && delivery ? (
                  <span className="font-normal text-muted">
                    (+
                    <Money kobo={delivery.delivery_fee_kobo} />)
                  </span>
                ) : null}
              </span>
              <span className="block text-sm text-muted">
                {canDeliver
                  ? 'A rider brings it to an approved delivery point.'
                  : 'No delivery points are open yet.'}
              </span>
            </span>
          </label>
        </fieldset>
        {mode === 'delivery' && (
          <Select
            label="Delivery point"
            name="point"
            required
            defaultValue={defaultPoint ?? points[0]?.id}
            hint="Delivery goes only to approved points. In this test version the points are fictional samples."
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        )}
        <p className="rounded-[var(--radius-control)] bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <Icon name="lock" size={14} className="mr-1 inline" />
          You pay on the next screen. In this test version payment is a clearly-marked test and no
          real money is taken.
        </p>
      </div>
      <aside
        className="h-fit space-y-2 rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)] lg:sticky lg:top-24"
        aria-labelledby="summary"
      >
        <h2 id="summary" className="text-lg font-extrabold text-navy-900">
          Order summary
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
          <div className="flex justify-between gap-3">
            <dt>
              Delivery
              {q.delivery_fee_collection === 'direct_to_rider' &&
                ' (you pay this to your rider by bank transfer after delivery; it is not part of the payment below)'}
            </dt>
            <dd>
              <Money kobo={q.delivery_fee_kobo} />
            </dd>
          </div>
          <div className="flex justify-between text-lg font-extrabold text-navy-900">
            <dt>
              {q.delivery_fee_collection === 'direct_to_rider'
                ? 'Total to pay online now'
                : 'Total'}
            </dt>
            <dd data-testid="checkout-total">
              <Money kobo={q.total_kobo} />
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          The final amount is calculated again by our server when you place the order.
        </p>
        <Button type="submit" variant="gold" disabled={pending} className="w-full">
          {pending ? 'Placing order…' : 'Place order'}
        </Button>
      </aside>
    </form>
  )
}
