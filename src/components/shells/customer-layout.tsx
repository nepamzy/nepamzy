import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { CUSTOMER_NAV } from '@/components/shells/nav-config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

/** Shared layout body for customer-facing protected segments (each segment still calls its own guard). */
export async function CustomerLayout({
  prefix,
  area = 'Customer',
  children,
}: {
  prefix: string
  area?: string
  children: ReactNode
}) {
  await enforceRoutePolicy(prefix)
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return (
    <AppShell
      area={area}
      signedInAs={data.user?.email}
      items={CUSTOMER_NAV}
      showCart
      search={{ action: '/vendors', placeholder: 'Search food, shops and services' }}
    >
      {children}
    </AppShell>
  )
}
