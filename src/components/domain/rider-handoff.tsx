'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { SignaturePad } from '@/components/domain/signature-pad'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/fields'
import { lagosTime } from '@/lib/time'
import {
  riderCompleteDeliveryAction,
  riderOpenQrAction,
  type QrOpen,
} from '@/server/modules/riders/handoff-actions'

/**
 * At the door, on the RIDER's phone. Two ways to confirm: the customer signs here and then the rider signs, or the rider
 * shows a QR code and the customer scans it with their own phone. The rider cannot mark a delivery done without one of them.
 */
export function RiderHandoff({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const [mode, setMode] = useState<'choose' | 'sign' | 'qr'>('choose')
  const [customerSigned, setCustomerSigned] = useState(false)
  const [qr, setQr] = useState<QrOpen | null>(null)
  const [pending, start] = useTransition()
  const box = useRef<HTMLElement>(null)
  // the rider has just tapped "I have arrived": bring the hand-over into view so there is nothing to look for
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [])

  const openQr = () =>
    start(async () => {
      setQr(await riderOpenQrAction(orderId))
      setMode('qr')
    })

  return (
    <section
      ref={box}
      aria-labelledby={`handoff-${orderId}`}
      className="space-y-3 rounded-[var(--radius-card)] border-2 border-brand-700 p-4"
    >
      <h3 id={`handoff-${orderId}`} className="text-lg font-extrabold">
        Arrived: hand over order {orderNumber}
      </h3>
      {mode === 'choose' && (
        <>
          <p>Choose how the customer confirms they received the order.</p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => setMode('sign')}>
              Confirm with signatures
            </Button>
            <Button type="button" variant="secondary" onClick={openQr} disabled={pending}>
              {pending ? 'Making code…' : 'Confirm with QR code'}
            </Button>
          </div>
        </>
      )}
      {mode === 'sign' && (
        <ActionForm
          action={riderCompleteDeliveryAction}
          submitLabel="Confirm delivery"
          pendingLabel="Confirming…"
          variant="gold"
        >
          <input type="hidden" name="orderId" value={orderId} />
          <Input label="Customer’s name" name="recipient" required autoComplete="off" />
          <div className="space-y-1">
            <p className="text-lg font-extrabold uppercase tracking-wide">Signature for customer</p>
            <SignaturePad
              name="customer_signature"
              label="The customer signs here, with a finger"
              hint="Hand the phone to the customer. It must look like the signature they registered."
              onSignedChange={setCustomerSigned}
            />
          </div>
          {customerSigned ? (
            <div className="space-y-1">
              <p className="text-lg font-extrabold uppercase tracking-wide">Signature of rider</p>
              <SignaturePad
                name="rider_signature"
                label="Now the rider signs here"
                hint="Take the phone back and sign."
              />
            </div>
          ) : (
            <p className="text-sm text-muted">
              The rider’s signature box appears after the customer has signed.
            </p>
          )}
          <Checkbox
            label="The customer received the order and I handed it over."
            name="confirm"
            required
          />
          <Button type="button" variant="secondary" onClick={() => setMode('choose')}>
            Back
          </Button>
        </ActionForm>
      )}
      {mode === 'qr' && (
        <div className="space-y-3">
          {qr && qr.ok ? (
            <>
              <p className="font-semibold">
                Ask the customer to scan this code with their phone and confirm.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr.qr}
                alt={`QR code to confirm delivery of order ${orderNumber}`}
                data-confirm-url={qr.url}
                width={260}
                height={260}
                className="rounded-lg border border-line bg-white p-2"
              />
              <p className="text-sm text-muted">
                The code works for 10 minutes (until {lagosTime(qr.expiresAt)}). The customer must
                be signed in on their phone. This page updates when they have confirmed.
              </p>
            </>
          ) : (
            <p role="alert" className="font-medium text-danger-700">
              {qr && !qr.ok ? qr.error : 'A code could not be made.'}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={openQr} disabled={pending}>
              New code
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode('choose')}>
              Back
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
