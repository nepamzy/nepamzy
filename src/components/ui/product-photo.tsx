import { cn } from './cn'

/** A product's photo. A product without one gets the branded tile from the same address, so this never fails. */
export function ProductPhoto({
  productId,
  className,
  label,
}: {
  productId: string
  icon?: string
  className?: string
  label?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/products/${productId}/image`}
      alt={label ?? ''}
      loading="lazy"
      className={cn(
        'aspect-[4/3] w-full overflow-hidden rounded-t-[var(--radius-card)] bg-surface object-cover',
        className,
      )}
    />
  )
}
