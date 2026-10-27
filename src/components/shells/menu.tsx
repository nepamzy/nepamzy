'use client'
import { useEffect, useRef, type ReactNode } from 'react'

/** A <details> dropdown that also closes on outside click and Escape (keyboard and screen-reader behaviour stay native). */
export function Menu({
  summary,
  label,
  children,
  align = 'right',
}: {
  summary: ReactNode
  label: string
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) {
        ref.current.open = false
        ref.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [])
  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={label}
        className="touch-target flex cursor-pointer list-none items-center gap-2 rounded-full [&::-webkit-details-marker]:hidden"
      >
        {summary}
      </summary>
      <div
        className={`absolute z-50 mt-2 w-72 rounded-[var(--radius-card)] border border-line bg-card p-2 shadow-[var(--shadow-pop)] ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        {children}
      </div>
    </details>
  )
}
