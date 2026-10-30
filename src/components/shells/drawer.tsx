'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icons'
import { SidebarNav } from './nav-links'
import type { NavItem } from './nav-config'
import { Logo } from '@/components/ui/logo'
import { SHELL_THEMES, type ShellTheme } from './theme'

/** Phone navigation drawer: a native <dialog> (focus trap, Escape, inert page) opened from the header menu button. */
export function MobileDrawer({
  items,
  theme,
  area,
  children,
}: {
  items: NavItem[]
  theme: ShellTheme
  area: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  const t = SHELL_THEMES[theme]
  const navy = t.dark
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        className="touch-target -ml-2 grid place-items-center rounded-lg text-navy-900 md:hidden"
      >
        <Icon name="menu" size={24} />
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        aria-label={`${area} navigation`}
        className={`m-0 h-dvh max-h-none w-[min(20rem,86vw)] max-w-none overflow-y-auto p-4 backdrop:bg-black/50 ${navy ? t.aside : 'bg-card text-ink'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <Logo tone={navy ? 'light' : 'dark'} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className={`touch-target grid place-items-center rounded-lg ${navy ? 'text-white' : 'text-ink'}`}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <p className={`mb-3 px-3 text-xs font-bold uppercase tracking-wider ${t.label}`}>{area}</p>
        <SidebarNav items={items} theme={theme} onNavigate={() => setOpen(false)} />
        {children && <div className="mt-5 border-t border-white/10 pt-4">{children}</div>}
      </dialog>
    </>
  )
}
