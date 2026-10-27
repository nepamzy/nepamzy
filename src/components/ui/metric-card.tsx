import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { cn } from './cn'

const ACCENT = {
  brand: 'bg-brand-50 text-brand-700',
  gold: 'bg-accent-50 text-accent-700',
  success: 'bg-success-50 text-success-700',
  danger: 'bg-danger-50 text-danger-700',
} as const

/** A headline number. `value` must come from real data; `note` explains the figure (period, scope) and is never a made-up trend. */
export function MetricCard({
  label,
  value,
  note,
  icon,
  accent = 'brand',
  href,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  icon?: IconName
  accent?: keyof typeof ACCENT
  href?: string
}) {
  const body = (
    <div className="flex items-start gap-3">
      {icon && (
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', ACCENT[accent])}>
          <Icon name={icon} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-muted">{label}</p>
        <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink">{value}</p>
        {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
      </div>
    </div>
  )
  const cls =
    'block rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)]'
  return href ? (
    <Link href={href} className={cn(cls, 'transition-shadow hover:shadow-[var(--shadow-pop)]')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}
