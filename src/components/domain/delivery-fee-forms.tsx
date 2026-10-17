'use client'
import { useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/fields'
import {
  openDeliveryFeeAction,
  reportDeliveryFeeAction,
  resolveDeliveryFeeDisputeAction,
  respondDeliveryFeeAction,
  saveRiderBankDetailsAction,
  voidDeliveryFeeReceiptAction,
} from '@/server/modules/delivery-fee/actions'

/** Copies the account number only; the number is already on screen for the signed-in customer. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      >
        {label}
      </Button>
      <span role="status" className="text-sm text-muted">
        {copied ? 'Copied.' : ''}
      </span>
    </>
  )
}

export function RiderBankForm({
  defaults,
}: {
  defaults?: { bank_name: string; account_name: string }
}) {
  return (
    <ActionForm
      action={saveRiderBankDetailsAction}
      submitLabel="Save bank details"
      pendingLabel="Saving…"
    >
      <Input
        label="Bank name"
        name="bank_name"
        required
        maxLength={60}
        defaultValue={defaults?.bank_name}
      />
      <Input
        label="Account number"
        name="account_number"
        required
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{10}"
        maxLength={10}
        hint="10 digits. Shown only to a customer who owes you a delivery fee, and to you."
      />
      <Input
        label="Account name"
        name="account_name"
        required
        maxLength={80}
        defaultValue={defaults?.account_name}
      />
    </ActionForm>
  )
}

export function OpenDeliveryFeeForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      action={openDeliveryFeeAction}
      submitLabel="Show payment details"
      pendingLabel="Opening…"
    >
      <input type="hidden" name="orderId" value={orderId} />
    </ActionForm>
  )
}

export function ReportTransferForm({ paymentId }: { paymentId: string }) {
  return (
    <ActionForm
      action={reportDeliveryFeeAction}
      submitLabel="I have made this transfer"
      pendingLabel="Saving…"
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      <Textarea
        label="Note for the rider (optional)"
        name="note"
        maxLength={300}
        hint="For example the time of the transfer. Do not include card or login details."
      />
    </ActionForm>
  )
}

export function RiderRespondForm({ paymentId }: { paymentId: string }) {
  return (
    <div className="space-y-4">
      <ActionForm
        action={respondDeliveryFeeAction}
        submitLabel="Yes, I received this amount"
        pendingLabel="Saving…"
      >
        <input type="hidden" name="paymentId" value={paymentId} />
        <input type="hidden" name="decision" value="confirm" />
      </ActionForm>
      <ActionForm
        action={respondDeliveryFeeAction}
        submitLabel="No, I did not receive it"
        pendingLabel="Saving…"
      >
        <input type="hidden" name="paymentId" value={paymentId} />
        <input type="hidden" name="decision" value="dispute" />
        <Textarea
          label="Why are you disputing it?"
          name="note"
          required
          minLength={5}
          maxLength={300}
          hint="Required. An administrator will read this."
        />
      </ActionForm>
    </div>
  )
}

export function ResolveDisputeForm({ paymentId }: { paymentId: string }) {
  return (
    <div className="space-y-4">
      {(['received', 'not_received'] as const).map((outcome) => (
        <ActionForm
          key={outcome}
          action={resolveDeliveryFeeDisputeAction}
          submitLabel={
            outcome === 'received' ? 'Decide: it was received' : 'Decide: it was not received'
          }
          pendingLabel="Saving…"
        >
          <input type="hidden" name="paymentId" value={paymentId} />
          <input type="hidden" name="outcome" value={outcome} />
          <Textarea
            label="Reason (required, recorded)"
            name="reason"
            required
            minLength={10}
            maxLength={500}
          />
        </ActionForm>
      ))}
    </div>
  )
}

export function VoidReceiptForm({ receiptId }: { receiptId: string }) {
  return (
    <ActionForm
      action={voidDeliveryFeeReceiptAction}
      submitLabel="Void this receipt"
      pendingLabel="Saving…"
    >
      <input type="hidden" name="receiptId" value={receiptId} />
      <Textarea
        label="Reason (required, recorded)"
        name="reason"
        required
        minLength={10}
        maxLength={500}
      />
    </ActionForm>
  )
}
