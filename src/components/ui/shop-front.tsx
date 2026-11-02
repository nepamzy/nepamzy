import { artKind, shopFrontSvg } from '@/lib/art/scenes'
import { cn } from './cn'

/**
 * The picture shown for a shop: a striped-awning shop front whose window matches what it sells. Decorative.
 * The markup comes from a fixed template in src/lib/art/scenes.ts (only a kind from a short list varies), never from user input.
 */
export function ShopFront({
  categorySlug,
  name,
  className,
}: {
  categorySlug?: string | null
  name?: string
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('w-full overflow-hidden [&>svg]:size-full', className)}
      dangerouslySetInnerHTML={{ __html: shopFrontSvg(artKind(name ?? '', categorySlug)) }}
    />
  )
}
