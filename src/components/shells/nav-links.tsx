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

export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card md:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {items.slice(0, 5).map((i) => {
          const active = path === i.href || (i.href !== '/' && path.startsWith(i.href + '/'))
          return (
            <li key={i.href} className="flex-1">
              <Link
                href={i.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'touch-target flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold',
                  active ? 'text-brand-800' : 'text-muted',
                )}
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  {i.icon}
                </span>
                <span>{i.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
