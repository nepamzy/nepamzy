import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { cn } from './cn'

const TONES = {
  info: ['bg-info-50 text-info-700 border-info-700/30', 'help'],
  success: ['bg-success-50 text-success-700 border-success-700/30', 'check-circle'],
  warning: ['bg-warning-50 text-warning-700 border-warning-700/30', 'alert'],
  danger: ['bg-danger-50 text-danger-700 border-danger-700/30', 'alert'],
} as const satisfies Record<string, readonly [string, IconName]>

/** Errors and warnings use role="alert"; success and information use role="status". */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
  plain,
}: {
  /** Static page notice: no live-region role, so it is not announced as a result and tests/readers find real status messages. */
  plain?: boolean
  tone?: keyof typeof TONES
  title?: string
  children?: ReactNode
  className?: string
}) {
  const [cls, icon] = TONES[tone]
  return (
    <div
      role={plain ? undefined : tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-[var(--radius-control)] border px-4 py-3', cls, className)}
    >
      <Icon name={icon} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  )
}
