import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

export default async function Layout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/vendor')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return (
    <AppShell
      area="Vendor"
      signedInAs={data.user?.email}
      items={[
        { href: '/vendor', label: 'Home', icon: '🏠' },
        { href: '/vendor/orders', label: 'Orders', icon: '📋' },
        { href: '/vendor/catalogue', label: 'Catalogue', icon: '🍽' },
        { href: '/vendor/handover', label: 'Handover', icon: '🤝' },
        { href: '/account', label: 'Account', icon: '👤' },
      ]}
    >
      {children}
    </AppShell>
  )
}
