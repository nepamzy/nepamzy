'use client'
import { ActionForm } from '@/components/forms/action-form'
import { Input } from '@/components/ui/fields'
import { confirmRiderPickupAction } from '@/server/modules/riders/actions'

export function RiderPickupForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      action={confirmRiderPickupAction}
      submitLabel="Hand parcel to rider"
      pendingLabel="Checking…"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Input
        label="Code shown on the rider’s phone"
        name="token"
        autoComplete="off"
        autoCapitalize="characters"
        required
      />
    </ActionForm>
  )
}
