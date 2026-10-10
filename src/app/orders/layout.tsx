import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function OrdersLayout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/orders')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return (
    <AppShell
      area="Customer"
      signedInAs={data.user?.email}
      items={[
        { href: '/vendors', label: 'Browse', icon: '🛍' },
        { href: '/orders', label: 'Orders', icon: '📦' },
        { href: '/account', label: 'Account', icon: '👤' },
      ]}
    >
      {children}
    </AppShell>
  )
}
