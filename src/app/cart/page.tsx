import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { describeProblems } from '@/lib/db-errors'
import { clearCartAction, setQuantityAction } from '@/server/modules/cart-and-checkout/actions'
import { getQuote } from '@/server/modules/cart-and-checkout/queries'

export const metadata: Metadata = { title: 'Your cart' }

export default async function CartPage() {
  const q = await getQuote('pickup', null)
  if (!q)
    return (
      <EmptyState title="We could not load your cart">Please try again in a moment.</EmptyState>
    )
  if (q.empty)
    return (
      <>
        <PageHeader title="Your cart" />
        <EmptyState
          title="Your cart is empty"
          action={<ButtonLink href="/vendors">Browse vendors</ButtonLink>}
        >
          Add something from an approved vendor to get started.
        </EmptyState>
      </>
    )
  const warnings = describeProblems(q.problems)
  return (
    <>
      <PageHeader
        title="Your cart"
        subtitle={q.vendor_name ? `From ${q.vendor_name}` : undefined}
      />
      {warnings.length > 0 && (
        <ul
          role="alert"
          className="mb-4 space-y-1 rounded-[var(--radius-control)] bg-warning-50 px-4 py-3 font-medium text-warning-700"
        >
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <ul className="space-y-3">
        {q.lines.map((l) => (
          <li key={l.item_id}>
            <Card className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{l.name}</p>
                  {l.options.length > 0 && (
                    <p className="text-sm text-muted">{l.options.map((o) => o.name).join(', ')}</p>
                  )}
                  <p className="text-sm text-muted">
                    <Money kobo={l.unit_price_kobo} /> each
                  </p>
                </div>
                <Money kobo={l.line_total_kobo} className="font-bold" />
              </div>
              <form action={setQuantityAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="itemId" value={l.item_id} />
                <label className="block">
                  <span className="block text-sm font-semibold">Quantity</span>
                  <input
                    name="quantity"
                    type="number"
                    min={0}
                    max={20}
                    defaultValue={l.quantity}
                    className="touch-target block w-24 rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2"
                  />
                </label>
                <Button type="submit" variant="secondary">
                  Update
                </Button>
                <button
                  type="submit"
                  name="remove"
                  value="1"
                  className="touch-target px-3 font-semibold text-danger-700 underline"
                >
                  Remove
                </button>
              </form>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="mt-5 space-y-2">
        <p className="flex justify-between">
          <span>Items</span>
          <Money kobo={q.items_total_kobo} className="font-bold" />
        </p>
        <p className="text-sm text-muted">
          The delivery fee (if you choose delivery) is added at checkout. There is no other service
          fee. Prices are checked again when you place the order.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <ButtonLink href="/checkout">Go to checkout</ButtonLink>
          <form action={clearCartAction}>
            <Button type="submit" variant="ghost">
              Empty cart
            </Button>
          </form>
          <Link href="/vendors" className="font-semibold text-brand-700 underline">
            Keep shopping
          </Link>
        </div>
      </Card>
    </>
  )
}
