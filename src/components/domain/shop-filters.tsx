import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icons'
import type { BrowseFilters } from '@/server/modules/vendors-and-catalogue/public'
import type { Category } from '@/server/modules/vendors-and-catalogue/types'

const SORTS: [BrowseFilters['sort'], string][] = [
  ['recommended', 'Open shops first'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['name', 'Name A to Z'],
  ['newest', 'Newest'],
]
const field =
  'touch-target block w-full rounded-[var(--radius-control)] border border-line-strong bg-card px-3 py-2 text-base'

/**
 * Search, category, price, open-now and sort as a plain GET form: it works without JavaScript and keeps every choice in the URL.
 * On phones the filters sit inside a disclosure so the results stay near the top.
 */
export function ShopFilters({
  action,
  filters,
  categories,
  showSort = true,
  showPrice = true,
}: {
  action: string
  filters: BrowseFilters
  categories: Category[]
  showSort?: boolean
  showPrice?: boolean
}) {
  return (
    <details
      className="group mb-5 rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)] md:open:block"
      open
    >
      <summary className="touch-target flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-bold text-navy-900 md:hidden [&::-webkit-details-marker]:hidden">
        <Icon name="filter" size={18} /> Search and filters
      </summary>
      <form
        action={action}
        method="get"
        role="search"
        className="grid gap-3 p-4 pt-0 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end md:pt-4"
      >
        <label className="text-sm font-semibold">
          Search
          <input
            name="q"
            defaultValue={filters.q}
            maxLength={60}
            placeholder="Shop or item"
            className={field}
          />
        </label>
        <label className="text-sm font-semibold">
          Category
          <select name="category" defaultValue={filters.category ?? ''} className={field}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {showSort && (
          <label className="text-sm font-semibold">
            Sort by
            <select name="sort" defaultValue={filters.sort} className={field}>
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {showPrice && (
          <label className="text-sm font-semibold">
            Highest price (naira)
            <input
              name="maxn"
              inputMode="numeric"
              defaultValue={filters.max ? String(Math.round(filters.max / 100)) : ''}
              placeholder="No limit"
              className={field}
            />
          </label>
        )}
        <label className="touch-target flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            name="open"
            value="1"
            defaultChecked={filters.open === '1'}
            className="size-5"
          />
          Open now only
        </label>
        <Button type="submit" variant="gold">
          Apply
        </Button>
      </form>
    </details>
  )
}
