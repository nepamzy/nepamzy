'use client'
import { useState, useTransition } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { SignaturePad } from '@/components/domain/signature-pad'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/fields'
import { Money } from '@/components/ui/money'
import {
  beginDeliveryProofAction,
  completeDeliveryAction,
} from '@/server/modules/orders-and-state-machine/actions'

type Item = { id: string; name: string; quantity: number; lineKobo: number }

/**
 * The recipient's own confirmation of a delivery. Order summary first, then a drawn signature. The rider has no
 * equivalent control anywhere. If the recipient cannot sign they are told to contact support; nothing completes by itself.
 */
export function DeliveryProofPanel({
  orderId,
  orderNumber,
  vendorName,
  deliverTo,
  totalKobo,
  items,
  helpHref,
}: {
  orderId: string
  orderNumber: string
  vendorName: string
  deliverTo: string
  totalKobo: number
  items: Item[]
  helpHref: string
}) {
  const [session, setSession] = useState<{ token: string; expiresAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const begin = () =>
    start(async () => {
      setError(null)
      const r = await beginDeliveryProofAction(orderId)
      if (r.ok) setSession({ token: r.token, expiresAt: r.expiresAt })
      else setError(r.error)
    })

  return (
    <section aria-labelledby="proof-h" className="space-y-3">
      <h2 id="proof-h" className="text-lg font-bold">
        Your rider has arrived: confirm you received your order
      </h2>
      {!session ? (
        <>
          <p>
            Check that you have your order, then confirm receipt. You will see a summary and sign
            with your finger. Do not confirm if you have not received everything.
          </p>
          {error && (
            <p role="alert" className="font-medium text-danger-700">
              {error}
            </p>
          )}
          <Button type="button" onClick={begin} disabled={pending}>
            {pending ? 'Starting…' : 'Confirm receipt'}
          </Button>
        </>
      ) : (
        <ActionForm
          action={completeDeliveryAction}
          submitLabel="Confirm and sign"
          pendingLabel="Confirming…"
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="token" value={session.token} />
          <div className="rounded-[var(--radius-control)] border border-line bg-card p-3">
            <p className="font-semibold">
              Order {orderNumber} · {vendorName}
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span>
                    {i.quantity} × {i.name}
                  </span>
                  <Money kobo={i.lineKobo} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              <strong>Delivered to:</strong> {deliverTo}
            </p>
            <p className="text-sm">
              <strong>Total:</strong> <Money kobo={totalKobo} />
            </p>
          </div>
          <Input
            label="Your name (the person receiving the order)"
            name="recipient"
            required
            autoComplete="name"
          />
          <SignaturePad label="Your signature" />
          <Checkbox
            label="I confirm I received this order. I understand this ends the delivery."
            name="confirm"
            required
          />
          <p className="text-sm text-muted">
            This confirmation expires at{' '}
            {new Date(session.expiresAt).toLocaleTimeString('en-NG', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            . If it expires, choose Confirm receipt again.
          </p>
        </ActionForm>
      )}
      <p className="text-sm">
        Cannot sign, or something is missing or wrong? Do not confirm.{' '}
        <a className="font-semibold text-brand-700 underline" href={helpHref}>
          Get help from support
        </a>
        . The order will not be completed for you.
      </p>
    </section>
  )
}
