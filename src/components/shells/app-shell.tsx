import Link from 'next/link'
import type { ReactNode } from 'react'
import { signOutAction } from '@/server/modules/identity-and-access/actions'
import { BottomNav, SidebarNav, type NavItem } from './nav-links'
import { Button } from '@/components/ui/button'

export function AppShell({
  area,
  items,
  moreHref,
  children,
  signedInAs,
}: {
  area: string
  items: NavItem[]
  /** Page listing every destination; used by the phone bar when there are more than five. */
  moreHref?: string
  children: ReactNode
  signedInAs?: string
}) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line border-t-4 border-t-gold-400 bg-card p-4 md:block">
        <Link href="/" className="mb-6 block text-xl font-extrabold text-brand-800">
          AFIT Market
        </Link>
        <p className="mb-2 px-3 text-xs font-bold uppercase tracking-wide text-muted">{area}</p>
        <SidebarNav items={items} />
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-line border-t-4 border-t-gold-400 bg-card px-4 py-3 sm:gap-x-3">
          <Link
            href="/"
            className="text-base font-extrabold whitespace-nowrap text-brand-800 sm:text-lg md:hidden"
          >
            AFIT Market
          </Link>
          <span className="hidden text-sm font-semibold text-muted md:inline">{area}</span>
          <form action={signOutAction} className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              href="/notifications"
              className="touch-target inline-flex items-center text-sm font-semibold whitespace-nowrap text-brand-700 underline sm:text-base"
            >
              Notifications
            </Link>
            {signedInAs && (
              <span
                className="hidden max-w-48 truncate text-sm text-muted sm:inline"
                title={signedInAs}
              >
                {signedInAs}
              </span>
            )}
            <Button
              type="submit"
              variant="secondary"
              className="px-3 py-1.5 text-sm whitespace-nowrap sm:px-4 sm:text-base"
            >
              Sign out
            </Button>
          </form>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-6 pb-24 md:pb-8">
          {children}
        </main>
      </div>
      <BottomNav items={items} moreHref={moreHref} />
    </div>
  )
}
