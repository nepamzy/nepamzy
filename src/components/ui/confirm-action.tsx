'use client'
import { useActionState, useEffect, useRef, useState } from 'react'
import { Button } from './button'
import type { ActionState } from '@/server/modules/shared/action-helpers'

/**
 * A button that asks for confirmation before running a server action, optionally collecting a reason.
 * Success is shown only after the server confirms it; errors stay inside the dialog so nothing is lost silently.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  reasonLabel,
  reasonName = 'reason',
  variant,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>
  fields?: Record<string, string>
  label: string
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  /** When set, a required reason field is shown (and sent as `reasonName`). */
  reasonLabel?: string
  reasonName?: string
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold'
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await action(prev, fd)
    if (next.ok) setOpen(false)
    return next
  }, {} as ActionState)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    <>
      <Button
        type="button"
        variant={variant ?? (danger ? 'danger' : 'secondary')}
        className="px-3 py-1.5 text-sm"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {state.ok && state.message && (
        <span role="status" className="ml-2 text-sm font-semibold text-success-700">
          {state.message}
        </span>
      )}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby="confirm-title"
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-card p-5 text-ink shadow-xl backdrop:bg-black/50"
      >
        <form action={formAction} className="space-y-4">
          <h2 id="confirm-title" className="text-lg font-extrabold text-navy-900">
            {title}
          </h2>
          <p className="text-muted">{description}</p>
          {Object.entries(fields ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {reasonLabel && (
            <label className="block text-sm font-semibold">
              {reasonLabel}
              <textarea
                name={reasonName}
                required
                minLength={5}
                maxLength={300}
                rows={3}
                className="mt-1 block w-full rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2 text-base font-normal"
              />
            </label>
          )}
          {state.error && (
            <p
              role="alert"
              className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
            >
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={pending}>
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
