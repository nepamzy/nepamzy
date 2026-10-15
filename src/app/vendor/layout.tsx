import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { VENDOR_NAV } from '@/components/shells/nav-config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export default async function Layout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/vendor')
  const [{ data }, vendor] = await Promise.all([
    (await createSupabaseServerClient()).auth.getUser(),
    getMyVendor(),
  ])
  return (
    <AppShell
      area={vendor ? `Vendor · ${vendor.name}` : 'Vendor'}
      signedInAs={data.user?.email}
      items={VENDOR_NAV}
      moreHref="/vendor/menu"
    >
      {vendor?.status === 'suspended' && (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] bg-danger-50 px-4 py-3 font-semibold text-danger-700"
        >
          Your vendor account is suspended. Customers cannot see or order from you, and you cannot
          make changes. Contact support.
        </p>
      )}
      {children}
    </AppShell>
  )
}
