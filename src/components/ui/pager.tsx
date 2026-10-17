import Link from 'next/link'

/** Previous / next links for server-paginated lists. `hasMore` comes from fetching one more row than shown, or a known total. */
export function Pager({
  basePath,
  page,
  hasMore,
  params = {},
  pageKey = 'page',
}: {
  basePath: string
  page: number
  hasMore: boolean
  params?: Record<string, string | undefined>
  pageKey?: string
}) {
  const href = (p: number) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
    if (p > 1) q.set(pageKey, String(p))
    const s = q.toString()
    return s ? `${basePath}?${s}` : basePath
  }
  if (page <= 1 && !hasMore) return null
  const cls =
    'touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong px-4 font-semibold hover:bg-brand-50'
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link className={cls} href={href(page - 1)}>
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted">Page {page}</span>
      {hasMore ? (
        <Link className={cls} href={href(page + 1)}>
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}
