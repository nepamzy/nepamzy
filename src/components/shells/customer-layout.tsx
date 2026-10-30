import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { CUSTOMER_NAV, RIDER_NAV, VENDOR_NAV } from '@/components/shells/nav-config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'
import { experienceOf } from '@/server/modules/identity-and-access/policy'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

/**
 * Shared layout body for protected segments that every signed-in person may reach (account, notifications, reports).
 * The frame follows who is signed in: a shop sees the shop frame, a rider the rider frame, everyone else the customer
 * frame. Shopping-only segments (cart, orders, checkout) turn shops and riders away in the route policy instead.
 */
export async function CustomerLayout({
  prefix,
  area = 'Customer',
  children,
}: {
  prefix: string
  area?: string
  children: ReactNode
}) {
  const who = await enforceRoutePolicy(prefix)
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  const experience = experienceOf(who)
  if (experience === 'vendor') {
    const vendor = await getMyVendor()
    return (
      <AppShell
        area={vendor ? `Vendor · ${vendor.name}` : 'Vendor'}
        signedInAs={data.user?.email}
        items={VENDOR_NAV}
        moreHref="/vendor/menu"
        theme="vendor"
      >
        {children}
      </AppShell>
    )
  }
  if (experience === 'rider') {
    return (
      <AppShell area="Rider" signedInAs={data.user?.email} items={RIDER_NAV} theme="rider">
        {children}
      </AppShell>
    )
  }
  return (
    <AppShell
      area={area}
      signedInAs={data.user?.email}
      items={CUSTOMER_NAV}
      showCart
      search={{ action: '/products', placeholder: 'Search food, shops and services' }}
    >
      {children}
    </AppShell>
  )
}
