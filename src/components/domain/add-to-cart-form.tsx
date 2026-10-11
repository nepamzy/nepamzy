'use client'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatNaira } from '@/lib/money'
import { addToCartAction, type CartFormState } from '@/server/modules/cart-and-checkout/actions'
import type { MenuProduct } from '@/server/modules/vendors-and-catalogue/types'

export function AddToCartForm({
  product,
  orderable,
}: {
  product: MenuProduct
  orderable: boolean
}) {
  const [state, action, pending] = useActionState<CartFormState, FormData>(addToCartAction, {})
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="productId" value={product.id} />
      {state.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          {state.error}
        </p>
      )}
      {product.options.map((g) => {
        const single = g.max === 1
        return (
          <fieldset key={g.id} className="space-y-1">
            <legend className="font-semibold">
              {g.name}{' '}
              <span className="text-sm font-normal text-muted">
                (
                {g.min > 0
                  ? `choose ${g.min === g.max ? g.min : `${g.min}-${g.max}`}`
                  : `optional, up to ${g.max}`}
                )
              </span>
            </legend>
            {g.options.map((o) => (
              <label
                key={o.id}
                className={`touch-target flex items-center gap-3 ${o.available ? 'cursor-pointer' : 'cursor-not-allowed text-muted'}`}
              >
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name={single ? `option-${g.id}` : 'option'}
                  value={o.id}
                  disabled={!o.available}
                  required={single && g.min === 1}
                  className="size-5 accent-[var(--color-brand-700)]"
                />
                <span>
                  {o.name}
                  {o.price_delta_kobo > 0 ? ` (+${formatNaira(o.price_delta_kobo)})` : ''}
                  {o.available ? '' : ' - sold out'}
                </span>
              </label>
            ))}
          </fieldset>
        )
      })}
      <label className="block max-w-32 space-y-1.5">
        <span className="block text-sm font-semibold">Quantity</span>
        <input
          name="quantity"
          type="number"
          min={1}
          max={20}
          defaultValue={1}
          required
          className="touch-target block w-full rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2.5 text-base"
        />
      </label>
      {state.conflict ? (
        <Card className="space-y-3 border-warning-700">
          <p className="font-semibold">Start a new cart with this vendor?</p>
          <p className="text-sm text-muted">Your current cart will be emptied.</p>
          <input type="hidden" name="replace" value="1" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              Replace my cart
            </Button>
            <a
              className="touch-target inline-flex items-center px-3 font-semibold underline"
              href="/cart"
            >
              Keep my cart
            </a>
          </div>
        </Card>
      ) : (
        <Button type="submit" disabled={pending || !orderable}>
          {pending ? 'Adding…' : 'Add to cart'}
        </Button>
      )}
      {!orderable && <p className="text-sm text-muted">This item cannot be ordered right now.</p>}
    </form>
  )
}
