'use client'
import { useActionState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import type { ActionState } from '@/server/modules/shared/action-helpers'

/** A form bound to a server action with an accessible success/error message area. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = 'Saving…',
  className,
  hideSubmit,
  variant,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>
  children: ReactNode
  submitLabel: string
  pendingLabel?: string
  className?: string
  hideSubmit?: boolean
  /** The main action of a screen may use the gold button. */
  variant?: 'primary' | 'gold'
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState)
  return (
    <form action={formAction} className={cn('space-y-4', className)}>
      {state.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700"
        >
          {state.message}
        </p>
      )}
      {children}
      {!hideSubmit && (
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      )}
    </form>
  )
}
