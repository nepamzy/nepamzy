import Link from 'next/link'
import type { ReactNode } from 'react'
import { signOutAction } from '@/server/modules/identity-and-access/actions'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { isPrivilegedRole } from '@/server/modules/identity-and-access/policy'
import { cartItemCount } from '@/server/modules/cart-and-checkout/queries'
import { unreadCount } from '@/server/modules/engagement/queries'
import { Icon } from '@/components/ui/icons'
import { Logo } from '@/components/ui/logo'
import { SearchField } from '@/components/ui/search-field'
import { MobileDrawer } from './drawer'
import { Menu } from './menu'
import { ModeBar, ModePill, ModeSwitch } from './mode-switch'
import type { NavItem } from './nav-config'
import { BottomNav, SidebarNav } from './nav-links'
import { SHELL_THEMES, type ShellTheme } from './theme'

const initials = (email?: string) => (email?.trim()[0] ?? '?').toUpperCase()

function Badge({ n, label }: { n: number; label: string }) {
  if (n <= 0) return null
  return (
    <span
      aria-label={label}
      className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-danger-700 px-1 text-[0.7rem] font-bold leading-5 text-white"
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}

/**
 * The signed-in frame for every role: sidebar (desktop), header with search / cart / notifications / account menu,
 * navigation drawer and bottom bar (phone). Administration uses the navy look; the other areas use the light look.
 * Nothing here grants access: every area still enforces its own policy.
 */
export async function AppShell({
  area,
  items,
  moreHref,
  children,
  signedInAs,
  theme = 'light',
  search,
  showCart = false,
}: {
  area: string
  items: NavItem[]
  /** Page listing every destination; used by the phone bar when there are more than five. */
  moreHref?: string
  children: ReactNode
  signedInAs?: string
  theme?: ShellTheme
  /** Where the header search sends people (customer areas). Omitted where no real search exists. */
  search?: { action: string; placeholder: string }
  showCart?: boolean
}) {
  const who = await loadPrincipal()
  const staff = who.roles.some(isPrivilegedRole)
  const [unread, cart] = await Promise.all([unreadCount(), showCart ? cartItemCount() : 0])
  const t = SHELL_THEMES[theme]
  const navy = t.dark
  const email = signedInAs
  const areaName = area.replace(/^(Vendor|Rider)\s*·?\s*/, '')
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside
        className={`hidden md:flex md:flex-col ${t.aside} sticky top-0 h-dvh overflow-y-auto p-4`}
      >
        <Logo tone={navy ? 'light' : 'dark'} className="mb-5" />
        <p className={`mb-3 px-3 text-xs font-bold uppercase tracking-wider ${t.label}`}>{area}</p>
        <div className="flex-1">
          <SidebarNav items={items} theme={theme} />
        </div>
        {staff && (
          <div className={`mt-4 border-t pt-4 ${t.divider}`}>
            <ModeSwitch who={who} dark={navy} />
          </div>
        )}
      </aside>
      <div className="min-w-0">
        <header
          className={`sticky top-0 z-30 flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3 border-b border-line border-t-4 ${t.topBar} bg-card/95 px-4 py-2.5 backdrop-blur`}
        >
          <MobileDrawer items={items} theme={theme} area={area}>
            {staff && <ModeSwitch who={who} dark={navy} />}
          </MobileDrawer>
          <Logo className="md:hidden" compact />
          {t.chip ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${t.chip}`}
              data-testid="area-chip"
            >
              <Icon name={theme === 'vendor' ? 'store' : 'bike'} size={16} />
              {t.chipLabel}
              {areaName && <span className="hidden sm:inline"> · {areaName}</span>}
            </span>
          ) : (
            <span className="hidden text-sm font-semibold text-muted md:inline">{area}</span>
          )}
          {search && (
            <SearchField
              action={search.action}
              placeholder={search.placeholder}
              label="Search the marketplace"
              className="hidden max-w-md flex-1 md:block"
            />
          )}
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ModePill who={who} />
            {showCart && (
              <Link
                href="/cart"
                aria-label={cart > 0 ? `Cart, ${cart} items` : 'Cart'}
                className="touch-target relative grid place-items-center rounded-full text-navy-900 hover:bg-brand-50"
              >
                <Icon name="cart" size={22} />
                <Badge n={cart} label={`${cart} items in your cart`} />
              </Link>
            )}
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              className="touch-target relative grid place-items-center rounded-full text-navy-900 hover:bg-brand-50"
            >
              <Icon name="bell" size={22} />
              <Badge n={unread} label={`${unread} unread notifications`} />
            </Link>
            <Menu
              label="Account menu"
              summary={
                <>
                  <span
                    aria-hidden="true"
                    className="grid size-9 place-items-center rounded-full bg-navy-900 text-sm font-bold text-white"
                  >
                    {initials(email)}
                  </span>
                  <Icon name="chevron-down" size={16} className="hidden sm:block" />
                </>
              }
            >
              {email && (
                <p className="truncate px-3 py-2 text-sm text-muted" title={email}>
                  Signed in as <span className="font-semibold text-ink">{email}</span>
                </p>
              )}
              <ul>
                <li>
                  <Link
                    href="/account"
                    className="touch-target flex items-center gap-2 rounded-lg px-3 py-2 font-semibold hover:bg-brand-50"
                  >
                    <Icon name="user" size={18} /> My account
                  </Link>
                </li>
                <li>
                  <Link
                    href="/account/security"
                    className="touch-target flex items-center gap-2 rounded-lg px-3 py-2 font-semibold hover:bg-brand-50"
                  >
                    <Icon name="shield" size={18} /> Security
                  </Link>
                </li>
              </ul>
              {staff && (
                <div className="my-2 border-t border-line px-1 pt-3">
                  <ModeSwitch who={who} />
                </div>
              )}
              <form action={signOutAction} className="mt-1 border-t border-line pt-1">
                <button
                  type="submit"
                  className="touch-target flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-danger-700 hover:bg-danger-50"
                >
                  <Icon name="logout" size={18} /> Sign out
                </button>
              </form>
            </Menu>
          </div>
        </header>
        <ModeBar who={who} />
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 pb-24 md:pb-10">
          {children}
        </main>
      </div>
      <BottomNav items={items} moreHref={moreHref} />
    </div>
  )
}
