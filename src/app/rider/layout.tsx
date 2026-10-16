import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

export default async function Layout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/rider')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return (
    <AppShell
      area="Rider"
      signedInAs={data.user?.email}
      items={[
        { href: '/rider', label: 'Home', icon: '🏍' },
        { href: '/rider/jobs', label: 'Jobs', icon: '📋' },
        { href: '/rider/payments', label: 'Payments', icon: '💳' },
        { href: '/rider/profile', label: 'Profile', icon: '👤' },
        { href: '/account', label: 'Account', icon: '🔐' },
      ]}
    >
      {children}
    </AppShell>
  )
}
