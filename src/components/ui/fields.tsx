import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from './cn'

const control =
  'touch-target block w-full rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2.5 text-base text-ink placeholder:text-muted aria-[invalid=true]:border-danger-700'

type FieldShell = {
  label: string
  hint?: string
  error?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}
function Field({ label, hint, error, children }: FieldShell) {
  const id = useId()
  const describedBy =
    [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  )
}

type Common = { label: string; hint?: string; error?: string }
export function Input({
  label,
  hint,
  error,
  className,
  ...props
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={cn(control, className)}
          {...props}
        />
      )}
    </Field>
  )
}
export function Select({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={cn(control, className)}
          {...props}
        >
          {children}
        </select>
      )}
    </Field>
  )
}
export function Textarea({
  label,
  hint,
  error,
  className,
  ...props
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          rows={4}
          className={cn(control, className)}
          {...props}
        />
      )}
    </Field>
  )
}
export function Checkbox({
  label,
  className,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="touch-target flex cursor-pointer items-center gap-3 text-base">
      <input
        type="checkbox"
        className={cn('size-5 accent-[var(--color-brand-700)]', className)}
        {...props}
      />
      <span>{label}</span>
    </label>
  )
}
export function Radio({
  label,
  className,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="touch-target flex cursor-pointer items-center gap-3 text-base">
      <input
        type="radio"
        className={cn('size-5 accent-[var(--color-brand-700)]', className)}
        {...props}
      />
      <span>{label}</span>
    </label>
  )
}
