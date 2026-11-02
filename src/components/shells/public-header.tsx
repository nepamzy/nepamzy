import Link from 'next/link'
import { signOutAction } from '@/server/modules/identity-and-access/actions'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { experienceOf, homeFor } from '@/server/modules/identity-and-access/policy'
import { cartItemCount } from '@/server/modules/cart-and-checkout/queries'
import { ButtonLink } from '@/components/ui/button'
import { Icon } from '@/components/ui/icons'
import { SearchField } from '@/components/ui/search-field'
import { Menu } from './menu'
import { StaffTapLogo } from './staff-tap-logo'

export async function PublicHeader() {
  const who = await loadPrincipal()
  const experience = experienceOf(who)
  const shopping = experience === 'customer'
  const cart = who.authenticated && shopping ? await cartItemCount() : 0
  return (
    <header className="sticky top-0 z-30 border-b border-line border-t-4 border-t-gold-400 bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <StaffTapLogo />
        <SearchField
          action="/products"
          placeholder="Search food, shops and services"
          label="Search the marketplace"
          className="order-last w-full md:order-none md:max-w-lg md:flex-1"
        />
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-2">
          {[
            ['/products', 'Items'],
            ['/vendors', 'Shops'],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              className="touch-target hidden items-center px-3 font-semibold text-navy-900 hover:underline sm:inline-flex"
            >
              {label}
            </Link>
          ))}
          {who.authenticated ? (
            <>
              {shopping && (
                <Link
                  href="/cart"
                  aria-label={cart > 0 ? `Cart, ${cart} items` : 'Cart'}
                  className="touch-target relative grid place-items-center rounded-full text-navy-900 hover:bg-brand-50"
                >
                  <Icon name="cart" size={22} />
                  {cart > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-danger-700 px-1 text-[0.7rem] font-bold leading-5 text-white"
                    >
                      {cart > 99 ? '99+' : cart}
                    </span>
                  )}
                </Link>
              )}
              <Menu
                label="Account menu"
                summary={
                  <>
                    <span
                      aria-hidden="true"
                      className="grid size-9 place-items-center rounded-full bg-navy-900 text-sm font-bold text-white"
                    >
                      <Icon name="user" size={18} />
                    </span>
                    <span className="hidden font-semibold text-navy-900 sm:inline">My account</span>
                    <Icon name="chevron-down" size={16} />
                  </>
                }
              >
                <ul>
                  {(experience === 'admin'
                    ? [
                        ['/admin', 'Overview', 'home'],
                        ['/account', 'My account', 'user'],
                        ['/notifications', 'Notifications', 'bell'],
                        ['/account/security', 'Security', 'shield'],
                      ]
                    : shopping
                      ? [
                          ['/account', 'My account', 'user'],
                          ['/orders', 'My orders', 'package'],
                          ['/notifications', 'Notifications', 'bell'],
                          ['/account/security', 'Security', 'shield'],
                        ]
                      : [
                          [
                            homeFor(experience),
                            experience === 'vendor' ? 'My shop' : 'My deliveries',
                            experience === 'vendor' ? 'store' : 'truck',
                          ],
                          [
                            '/account',
                            experience === 'vendor' ? 'Shop account' : 'Rider account',
                            'user',
                          ],
                          ['/notifications', 'Notifications', 'bell'],
                          ['/account/security', 'Security', 'shield'],
                        ]
                  ).map(([href, label, icon]) => (
                    <li key={href}>
                      <Link
                        href={href!}
                        className="touch-target flex items-center gap-2 rounded-lg px-3 py-2 font-semibold hover:bg-brand-50"
                      >
                        <Icon name={icon as 'user'} size={18} /> {label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <form action={signOutAction} className="mt-1 border-t border-line pt-1">
                  <button
                    type="submit"
                    className="touch-target flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-danger-700 hover:bg-danger-50"
                  >
                    <Icon name="logout" size={18} /> Sign out
                  </button>
                </form>
              </Menu>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="touch-target inline-flex items-center px-3 font-semibold text-navy-900 hover:underline"
              >
                Sign in
              </Link>
              <ButtonLink href="/signup" variant="gold">
                Create account
              </ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
