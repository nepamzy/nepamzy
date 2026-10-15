'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/components/ui/cn'

export type NavItem = { href: string; label: string; icon: string }

export function SidebarNav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  return (
    <nav aria-label="Main" className="space-y-1">
      {items.map((i) => {
        const active = path === i.href || (i.href !== '/' && path.startsWith(i.href + '/'))
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'touch-target flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 font-semibold',
              active ? 'bg-brand-700 text-white' : 'text-ink hover:bg-brand-50',
            )}
          >
            <span aria-hidden="true">{i.icon}</span>
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Phone bar: at most five slots. A shell with more than five destinations shows four plus a "More" link to a page that lists every one. */
export function BottomNav({ items, moreHref }: { items: NavItem[]; moreHref?: string }) {
  const path = usePathname()
  const overflow = !!moreHref && items.length > 5
  const shown = overflow ? items.slice(0, 4) : items.slice(0, 5)
  const isActive = (href: string) => path === href || (href !== '/' && path.startsWith(href + '/'))
  const moreActive = overflow && (path === moreHref || !shown.some((i) => isActive(i.href)))
  const slot = (href: string, icon: string, label: string, active: boolean) => (
    <li key={href} className="flex-1">
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'touch-target flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold',
          active ? 'text-brand-800' : 'text-muted',
        )}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          {icon}
        </span>
        <span>{label}</span>
      </Link>
    </li>
  )
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card md:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {shown.map((i) => slot(i.href, i.icon, i.label, isActive(i.href)))}
        {overflow && slot(moreHref!, '⋯', 'More', moreActive)}
      </ul>
    </nav>
  )
}
