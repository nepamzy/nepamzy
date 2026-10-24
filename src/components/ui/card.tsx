import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] sm:p-5',
        className,
      )}
      {...props}
    />
  )
}
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
export function SampleDataNote() {
  return (
    <p className="mb-4 rounded-[var(--radius-control)] border border-dashed border-line-strong bg-card px-3 py-2 text-sm text-muted">
      Sample data for design review only. Nothing on this page is real.
    </p>
  )
}
