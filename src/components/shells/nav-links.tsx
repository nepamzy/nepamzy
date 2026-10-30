'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/components/ui/cn'
import { Icon } from '@/components/ui/icons'
import type { NavItem } from './nav-config'
import { SHELL_THEMES, type ShellTheme } from './theme'

export type { NavItem }

const isActive = (path: string, href: string, siblings: NavItem[]) => {
  if (path === href) return true
  if (href === '/' || !path.startsWith(href + '/')) return false
  // the most specific matching item wins, so /admin does not light up on /admin/payments
  return !siblings.some(
    (s) => s.href.length > href.length && (path === s.href || path.startsWith(s.href + '/')),
  )
}

/** Sidebar / drawer navigation. Each area has its own look (see theme.ts). */
export function SidebarNav({
  items,
  theme = 'light',
  onNavigate,
}: {
  items: NavItem[]
  theme?: ShellTheme
  onNavigate?: () => void
}) {
  const path = usePathname()
  const t = SHELL_THEMES[theme]
  const groups: { name?: string; items: NavItem[] }[] = []
  for (const i of items) {
    const last = groups[groups.length - 1]
    if (last && last.name === i.group) last.items.push(i)
    else groups.push({ name: i.group, items: [i] })
  }
  return (
    <nav aria-label="Main" className="space-y-4">
      {groups.map((g, gi) => (
        <div key={`${g.name ?? 'all'}-${gi}`}>
          {g.name && (
            <p className={cn('mb-1 px-3 text-xs font-bold uppercase tracking-wider', t.label)}>
              {g.name}
            </p>
          )}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = isActive(path, i.href, items)
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'touch-target flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[0.95rem] font-semibold transition-colors',
                      active ? 'bg-gold-400 text-ink' : t.link,
                    )}
                  >
                    <Icon name={i.icon} size={19} />
                    {i.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** Phone bar: at most five slots. A shell with more than five destinations shows four plus a "More" link to a page that lists every one. */
export function BottomNav({ items, moreHref }: { items: NavItem[]; moreHref?: string }) {
  const path = usePathname()
  const overflow = !!moreHref && items.length > 5
  const shown = overflow ? items.slice(0, 4) : items.slice(0, 5)
  const active = (href: string) => isActive(path, href, items)
  const moreActive = overflow && (path === moreHref || !shown.some((i) => active(i.href)))
  const slot = (href: string, icon: NavItem['icon'], label: string, on: boolean) => (
    <li key={href} className="flex-1">
      <Link
        href={href}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'touch-target flex flex-col items-center justify-center gap-0.5 border-t-4 px-1 py-1.5 text-xs font-semibold',
          on ? 'border-gold-400 text-navy-900' : 'border-transparent text-muted',
        )}
      >
        <Icon name={icon} size={22} />
        <span>{label}</span>
      </Link>
    </li>
  )
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card shadow-[0_-4px_16px_rgb(8_28_69/0.08)] md:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {shown.map((i) => slot(i.href, i.icon, i.label, active(i.href)))}
        {overflow && slot(moreHref!, 'dots', 'More', moreActive)}
      </ul>
    </nav>
  )
}
