'use client'
import { ConfirmAction } from '@/components/ui/confirm-action'
import { setContactStatusAction } from '@/server/modules/engagement/actions'
import { setProductVisibilityAction, setUserSuspendedAction } from '@/server/modules/admin/actions'

export function SuspendUserButton({ userId, suspended }: { userId: string; suspended: boolean }) {
  return suspended ? (
    <ConfirmAction
      action={setUserSuspendedAction}
      fields={{ userId, suspend: '0' }}
      label="Reinstate account"
      title="Reinstate this account?"
      description="The person will be able to sign in again. The reason is recorded in the audit log."
      confirmLabel="Reinstate"
      reasonLabel="Reason"
    />
  ) : (
    <ConfirmAction
      action={setUserSuspendedAction}
      fields={{ userId, suspend: '1' }}
      label="Suspend account"
      title="Suspend this account?"
      description="The person cannot sign in and their open sessions end immediately. Their orders and records stay. The reason is recorded in the audit log."
      confirmLabel="Suspend"
      danger
      reasonLabel="Reason"
    />
  )
}

export function ProductVisibilityButton({
  productId,
  status,
}: {
  productId: string
  status: string
}) {
  if (status === 'archived') return <span className="text-sm text-muted">Archived by the shop</span>
  return status === 'hidden' ? (
    <ConfirmAction
      action={setProductVisibilityAction}
      fields={{ productId, hide: '0' }}
      label="Show again"
      title="Show this item again?"
      description="It will appear in the marketplace and can be added to carts again. The reason is recorded."
      confirmLabel="Show item"
      reasonLabel="Reason"
    />
  ) : (
    <ConfirmAction
      action={setProductVisibilityAction}
      fields={{ productId, hide: '1' }}
      label="Hide"
      title="Hide this item?"
      description="It disappears from every public page and nobody can add it to a cart. The shop cannot change or archive it while it is hidden. The reason is recorded."
      confirmLabel="Hide item"
      danger
      reasonLabel="Reason"
    />
  )
}

export function ContactStatusButtons({ id, status }: { id: string; status: string }) {
  return (
    <span className="inline-flex flex-wrap gap-2">
      {status === 'new' && (
        <ConfirmAction
          action={setContactStatusAction}
          fields={{ id, status: 'read' }}
          label="Mark read"
          title="Mark as read?"
          description="This only records that someone has seen the message."
          confirmLabel="Mark read"
        />
      )}
      {status !== 'closed' && (
        <ConfirmAction
          action={setContactStatusAction}
          fields={{ id, status: 'closed' }}
          label="Close"
          title="Close this message?"
          description="Close it once you have replied by email or no reply is needed."
          confirmLabel="Close message"
        />
      )}
    </span>
  )
}
