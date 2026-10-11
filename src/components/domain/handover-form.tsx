'use client'
import { ActionForm } from '@/components/forms/action-form'
import { SignaturePad } from '@/components/domain/signature-pad'
import { Input } from '@/components/ui/fields'
import { completePickupAction } from '@/server/modules/orders-and-state-machine/actions'

export function HandoverForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      action={completePickupAction}
      submitLabel="Complete handover"
      pendingLabel="Completing…"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Input
        label="Pickup code from the customer"
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        required
      />
      <Input label="Recipient name" name="recipient" autoComplete="off" required />
      <SignaturePad />
    </ActionForm>
  )
}
