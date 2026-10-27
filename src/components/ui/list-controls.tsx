import Link from 'next/link'
import { Button } from './button'
import { cn } from './cn'

/** Tabs that are plain links, so each state is a shareable URL and works without JavaScript. */
export function LinkTabs({
  tabs,
  active,
  label,
}: {
  tabs: { key: string; label: string; href: string }[]
  active: string
  label: string
}) {
  return (
    <nav aria-label={label} className="mb-4 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? 'true' : undefined}
          className={cn(
            'touch-target inline-flex items-center rounded-full border px-4 text-sm font-bold',
            active === t.key
              ? 'border-navy-900 bg-navy-900 text-white'
              : 'border-line-strong bg-card text-navy-900 hover:bg-brand-50',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

/** A search box plus optional hidden fields (such as the current tab), as a plain GET form. */
export function SearchBar({
  action,
  q,
  label,
  placeholder,
  hidden = {},
}: {
  action: string
  q: string
  label: string
  placeholder: string
  hidden?: Record<string, string | undefined>
}) {
  return (
    <form
      action={action}
      method="get"
      role="search"
      className="mb-4 flex flex-wrap items-end gap-2"
    >
      <label className="min-w-0 flex-1 text-sm font-semibold">
        {label}
        <input
          name="q"
          defaultValue={q}
          maxLength={80}
          placeholder={placeholder}
          className="touch-target mt-1 block w-full rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2 text-base font-normal"
        />
      </label>
      {Object.entries(hidden).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  )
}
