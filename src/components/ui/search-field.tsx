import { Icon } from './icons'
import { cn } from './cn'

/** A plain GET form: works without JavaScript, keeps the query in the URL, and always has a visible label for screen readers. */
export function SearchField({
  action,
  name = 'q',
  defaultValue,
  placeholder = 'Search',
  label = 'Search',
  className,
  hidden,
}: {
  action: string
  name?: string
  defaultValue?: string
  placeholder?: string
  label?: string
  className?: string
  /** Extra query values to carry along, e.g. the current sort. */
  hidden?: Record<string, string>
}) {
  return (
    <form action={action} method="get" role="search" className={cn('relative', className)}>
      <label htmlFor={`sf-${action}-${name}`} className="sr-only">
        {label}
      </label>
      <Icon
        name="search"
        size={18}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        id={`sf-${action}-${name}`}
        name={name}
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={100}
        autoComplete="off"
        className="h-11 w-full rounded-full border border-line-strong bg-card pl-10 pr-24 text-base text-ink placeholder:text-muted"
      />
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        className="absolute right-1 top-1 h-9 rounded-full bg-gold-400 px-4 text-sm font-bold text-ink hover:brightness-95"
      >
        Search
      </button>
    </form>
  )
}
