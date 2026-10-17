'use client'
import { useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { SignaturePad } from '@/components/domain/signature-pad'
import { Input } from '@/components/ui/fields'
import { completePickupAction } from '@/server/modules/orders-and-state-machine/actions'

export function HandoverForm({
  orderId,
  typedEnabled,
}: {
  orderId: string
  typedEnabled: boolean
}) {
  const [typedMode, setTypedMode] = useState(false)
  return (
    <ActionForm
      action={completePickupAction}
      submitLabel="Complete handover"
      pendingLabel="Completing…"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="method" value={typedMode ? 'typed' : 'drawn'} />
      <Input
        label="Pickup code from the customer"
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        required
      />
      <Input label="Recipient name" name="recipient" autoComplete="off" required />
      {typedMode ? (
        <Input
          label="Typed acknowledgement (recipient types their full name)"
          name="typed"
          autoComplete="off"
          hint="This is recorded as a typed acknowledgement, not a drawn signature."
          required
        />
      ) : (
        <SignaturePad />
      )}
      {typedEnabled ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={typedMode}
            onChange={(e) => setTypedMode(e.target.checked)}
          />
          The recipient cannot draw a signature (record a typed acknowledgement instead)
        </label>
      ) : (
        <p className="text-sm text-muted">
          If the recipient cannot draw, do not complete the handover here: contact support. (A typed
          acknowledgement is switched off until the owner decides.)
        </p>
      )}
    </ActionForm>
  )
}
