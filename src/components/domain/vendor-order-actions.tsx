'use client'
import { ActionForm } from '@/components/forms/action-form'
import { Input } from '@/components/ui/fields'
import { vendorOrderAction } from '@/server/modules/orders-and-state-machine/actions'

const NEXT: Record<string, { action: string; label: string } | undefined> = {
  PAID: { action: 'accept', label: 'Accept order' },
  ACCEPTED: { action: 'start_preparing', label: 'Start preparing' },
  PREPARING: { action: 'mark_ready', label: 'Mark ready' },
}

export function VendorOrderActions({ orderId, status }: { orderId: string; status: string }) {
  const next = NEXT[status]
  if (!next) return <span className="text-sm text-muted">No action needed</span>
  return (
    <div className="space-y-3">
      <ActionForm action={vendorOrderAction} submitLabel={next.label} pendingLabel="Updating…">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="action" value={next.action} />
      </ActionForm>
      {status === 'PAID' && (
        <ActionForm action={vendorOrderAction} submitLabel="Reject order" pendingLabel="Rejecting…">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="action" value="reject" />
          <Input label="Reason (the customer will see this)" name="reason" required />
        </ActionForm>
      )}
    </div>
  )
}
