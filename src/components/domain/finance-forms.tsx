'use client'
import { ActionForm } from '@/components/forms/action-form'
import { Input } from '@/components/ui/fields'
import { requestRefundAction, resolveFlagAction } from '@/server/modules/payments/admin-actions'

export function ResolveFlagForm({ flagId }: { flagId: string }) {
  return (
    <ActionForm action={resolveFlagAction} submitLabel="Mark resolved" pendingLabel="Saving…">
      <input type="hidden" name="flagId" value={flagId} />
      <Input label="Resolution note" name="note" required />
    </ActionForm>
  )
}

export function RefundRequestForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      action={requestRefundAction}
      submitLabel="Record refund request"
      pendingLabel="Saving…"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Input label="Amount (₦)" name="amount" inputMode="decimal" required />
      <Input label="Reason" name="reason" required />
    </ActionForm>
  )
}
