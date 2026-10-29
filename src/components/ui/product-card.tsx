import Link from 'next/link'
import { Badge } from './badge'
import { cn } from './cn'
import { Icon, type IconName } from './icons'
import { Money } from './money'

/** Icon for a vendor category. Product images are not stored yet (no file storage), so tiles are an honest branded placeholder. */
export function categoryIcon(slug?: string | null): IconName {
  if (!slug) return 'bag'
  if (/food|meal|kitchen|snack/.test(slug)) return 'utensils'
  if (/drink|beverage|juice/.test(slug)) return 'cup'
  if (/print|stationery|copy/.test(slug)) return 'printer'
  if (/souvenir|gift/.test(slug)) return 'gift'
  return 'bag'
}

export function NoImageTile({
  icon = 'bag',
  className,
  label,
}: {
  icon?: IconName
  className?: string
  label?: string
}) {
  return (
    <div
      role="img"
      aria-label={label ?? 'No photo yet'}
      className={cn(
        'grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-t-[var(--radius-card)] bg-gradient-to-br from-navy-900 to-navy-700 text-gold-400',
        className,
      )}
    >
      <Icon name={icon} size={44} />
    </div>
  )
}

export function ProductCard({
  href,
  name,
  vendorName,
  priceKobo,
  available,
  openNow,
  icon,
}: {
  href: string
  name: string
  vendorName: string
  priceKobo: number
  available: boolean
  openNow?: boolean
  icon?: IconName
}) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]">
      <Link href={href} tabIndex={-1} aria-hidden="true">
        <NoImageTile icon={icon} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="font-bold leading-snug text-navy-900">
          <Link href={href} className="hover:underline">
            {name}
          </Link>
        </h3>
        <p className="text-sm text-muted">{vendorName}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <Money kobo={priceKobo} className="text-lg font-extrabold text-navy-900" />
          {!available ? (
            <Badge tone="danger">Sold out</Badge>
          ) : openNow === false ? (
            <Badge tone="neutral">Closed now</Badge>
          ) : null}
        </div>
        <Link
          href={href}
          className="touch-target mt-2 inline-flex items-center justify-center rounded-[var(--radius-control)] bg-gold-400 px-3 py-2 text-sm font-bold text-ink hover:brightness-95"
        >
          {available ? 'View and add to cart' : 'View item'}
        </Link>
      </div>
    </article>
  )
}
