import Link from 'next/link'
import { cn } from './cn'

/** The AFIT Market logo (the mark on its own, for very narrow places). */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/mark.png"
      alt=""
      width={size}
      height={size}
      className="rounded-md"
      style={{ width: size, height: size }}
    />
  )
}

/**
 * The AFIT Market logo. The picture has a white background, so on the dark navy areas it sits on a white tile.
 */
export function Logo({
  href = '/',
  tone = 'dark',
  className,
  compact = false,
}: {
  href?: string
  tone?: 'dark' | 'light'
  className?: string
  /** The mark alone on very narrow phones; the full logo returns from 420px. */
  compact?: boolean
}) {
  return (
    <Link
      href={href}
      aria-label="AFIT Market home"
      className={cn(
        'inline-flex items-center whitespace-nowrap',
        tone === 'light' && 'rounded-lg bg-white px-2 py-1',
        className,
      )}
    >
      {compact && <BrandMark size={34} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-header.png"
        alt="AFIT Market"
        width={760}
        height={239}
        style={{ height: 40, width: 'auto' }}
        className={cn(compact && 'hidden min-[420px]:block')}
      />
    </Link>
  )
}
