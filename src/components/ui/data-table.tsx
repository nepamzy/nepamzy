import type { ReactNode } from 'react'
import { cn } from './cn'

export type Column<T> = {
  header: string
  cell: (row: T) => ReactNode
  /** Right-align numbers and money. */
  align?: 'right'
  /** Hide on the phone card view (use sparingly). */
  hideOnPhone?: boolean
}

/**
 * A table on tablets and desktops; on phones every row becomes a labelled card so nothing is cramped or hidden off-screen.
 * Keep `rowKey` stable. Put row actions in the last column.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
}) {
  if (rows.length === 0 && empty) return <>{empty}</>
  return (
    <>
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)] md:block"
      >
        <table className="w-full text-left text-[0.95rem]">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-navy-900 text-sm text-white">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className={cn(
                    'px-4 py-3 font-semibold whitespace-nowrap',
                    c.align === 'right' && 'text-right',
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line [&>tr:hover]:bg-brand-50/60">
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right')}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            className="rounded-[var(--radius-card)] border border-line bg-card p-3 shadow-[var(--shadow-card)]"
          >
            <dl className="space-y-1.5">
              {columns
                .filter((c) => !c.hideOnPhone)
                .map((c) => (
                  <div key={c.header} className="flex items-start justify-between gap-3">
                    <dt className="text-sm font-semibold text-muted">{c.header}</dt>
                    <dd className="min-w-0 text-right">{c.cell(r)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
