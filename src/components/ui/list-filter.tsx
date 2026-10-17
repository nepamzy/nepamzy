import { Button } from './button'

/** A plain GET form (works without JavaScript): status select + free-text search. Values are validated server-side. */
export function ListFilter({
  action,
  statuses,
  status,
  q,
  searchLabel = 'Search order number',
}: {
  action: string
  statuses: readonly string[]
  status?: string
  q?: string
  searchLabel?: string
}) {
  const field =
    'touch-target block w-full rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2 text-base'
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-3">
      <label className="text-sm font-semibold">
        Status
        <select name="status" defaultValue={status ?? ''} className={field}>
          <option value="">All</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold">
        {searchLabel}
        <input name="q" defaultValue={q ?? ''} maxLength={40} className={field} />
      </label>
      <Button type="submit" variant="secondary">
        Filter
      </Button>
    </form>
  )
}
