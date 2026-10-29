import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui/card'
import { Icon } from '@/components/ui/icons'
import type { NavItem } from './nav-config'

/** Every destination of a shell as plain links. Showing a link never grants access: each page still enforces its own policy. */
export function NavMenu({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <>
      <PageHeader title={title} subtitle="Every section you can open from here." />
      <Card>
        <nav aria-label={title}>
          <ul>
            {items.map((i) => (
              <li key={i.href} className="border-b border-line last:border-b-0">
                <Link
                  href={i.href}
                  className="touch-target flex items-center gap-3 px-2 py-3 text-base font-semibold text-ink hover:bg-brand-50"
                >
                  <Icon name={i.icon} />
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Card>
    </>
  )
}
