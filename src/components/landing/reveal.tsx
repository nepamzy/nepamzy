'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/components/ui/cn'

/**
 * Fades a block in as it scrolls into view. The content is fully visible until the page has started its scripts, so it is
 * never hidden for people without them.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'plain' | 'armed' | 'in'>('plain')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const r = el.getBoundingClientRect()
    if (r.top < window.innerHeight * 0.9) return // already on screen: leave it be
    setState('armed')
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('in')
          io.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className={cn(state !== 'plain' && 'afit-reveal', className)}
      data-in={state === 'in' ? '1' : undefined}
      style={state === 'in' && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
