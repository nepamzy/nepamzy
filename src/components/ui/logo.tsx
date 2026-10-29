import Link from 'next/link'
import { cn } from './cn'

/**
 * The AFIT Market wordmark with a simple geometric "A" mark. This is our own provisional mark: it is NOT the AFIT crest,
 * not approved branding, and carries no official insignia.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--color-navy-900)" />
      <path d="M16 6 6.5 25h4.2l1.7-3.6h7.2l1.7 3.6h4.2z" fill="white" />
      <path d="M16 12.2 13.6 17.4h4.8z" fill="var(--color-navy-900)" />
      <path
        d="M4 27.5c6-1.2 18-1.2 24 0"
        stroke="var(--color-gold-400)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

export function Logo({
  href = '/',
  tone = 'dark',
  className,
  compact = false,
}: {
  href?: string
  tone?: 'dark' | 'light'
  className?: string
  /** Mark only on very narrow phones; the full name returns from 420px. */
  compact?: boolean
}) {
  return (
    <Link
      href={href}
      aria-label="AFIT Market home"
      className={cn('inline-flex items-center gap-2 whitespace-nowrap', className)}
    >
      <BrandMark />
      <span
        className={cn(
          'text-lg font-extrabold tracking-tight',
          compact && 'hidden min-[420px]:inline',
          tone === 'light' ? 'text-white' : 'text-navy-900',
        )}
      >
        AFIT <span className={tone === 'light' ? 'text-gold-400' : 'text-brand-600'}>Market</span>
      </span>
    </Link>
  )
}
