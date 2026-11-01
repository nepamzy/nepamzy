import Link from 'next/link'
import { cn } from './cn'

/** The AFIT Market mark (the "A" with the swoosh and cart). Used on its own where only a logo belongs. */
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
 * The AFIT Market name as it appears in headers: the mark followed by the name written out as text (AFIT in navy,
 * Market in gold, like the logo). On the dark navy areas the mark sits on a small white tile so it stays clear.
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
  /** The mark alone on very narrow phones; the written name returns from 420px. */
  compact?: boolean
}) {
  return (
    <Link
      href={href}
      aria-label="AFIT Market home"
      className={cn('inline-flex items-center gap-2 whitespace-nowrap', className)}
    >
      <span className={cn('inline-flex rounded-lg', tone === 'light' && 'bg-white p-0.5')}>
        <BrandMark size={38} />
      </span>
      <span className={cn('flex flex-col leading-none', compact && 'hidden min-[420px]:flex')}>
        <span
          className={cn(
            'text-xl font-black tracking-tight',
            tone === 'light' ? 'text-white' : 'text-navy-900',
          )}
        >
          AFIT
        </span>
        <span
          className={cn(
            'text-xl font-black tracking-tight',
            tone === 'light' ? 'text-gold-400' : 'text-gold-700',
          )}
        >
          MARKET
        </span>
      </span>
    </Link>
  )
}
