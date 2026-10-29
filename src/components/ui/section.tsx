import type { ReactNode } from 'react'
import { cn } from './cn'

/** A titled block of a page: heading, optional description and actions, then content. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  const hid = id ? `${id}-h` : undefined
  return (
    <section aria-labelledby={hid} className={cn('mb-8', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={hid} className="text-xl font-extrabold tracking-tight text-navy-900">
            {title}
          </h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
