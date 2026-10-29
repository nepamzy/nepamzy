import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icons'
import { NoImageTile, categoryIcon } from '@/components/ui/product-card'
import type { VendorCard } from '@/server/modules/vendors-and-catalogue/types'

export function VendorCardView({ v }: { v: VendorCard }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]">
      <Link href={`/vendors/${v.slug}`} tabIndex={-1} aria-hidden="true">
        <NoImageTile icon={categoryIcon(v.category_slug)} className="aspect-[16/7]" />
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-extrabold leading-snug text-navy-900">
            <Link className="hover:underline" href={`/vendors/${v.slug}`}>
              {v.name}
            </Link>
          </h2>
          <Badge tone={v.open_now ? 'success' : 'neutral'}>
            {v.open_now ? 'Open now' : 'Closed now'}
          </Badge>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
          {v.category_name && <span>{v.category_name}</span>}
          <span className="inline-flex items-center gap-1">
            <Icon name="clock" size={14} /> About {v.prep_minutes} min
          </span>
        </p>
        {v.description && <p className="line-clamp-2 text-sm">{v.description}</p>}
        <Link
          href={`/vendors/${v.slug}`}
          className="mt-auto pt-2 text-sm font-bold text-brand-700 hover:underline"
        >
          Visit shop →
        </Link>
      </div>
    </article>
  )
}
