import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

export default async function Layout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/admin')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return (
    <AppShell
      area="Administration"
      signedInAs={data.user?.email}
      items={[
        { href: '/admin', label: 'Home', icon: '🏠' },
        { href: '/admin/applications', label: 'Applications', icon: '📝' },
        { href: '/admin/audit', label: 'Audit', icon: '🧾' },
        { href: '/admin/roles', label: 'Roles', icon: '🔑' },
        { href: '/account', label: 'Account', icon: '👤' },
      ]}
    >
      {children}
    </AppShell>
  )
}
