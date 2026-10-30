import type { ReactNode } from 'react'
import { AppShell } from '@/components/shells/app-shell'
import { RIDER_NAV } from '@/components/shells/nav-config'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

export default async function Layout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/rider')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return (
    <AppShell area="Rider" signedInAs={data.user?.email} items={RIDER_NAV} theme="rider">
      {children}
    </AppShell>
  )
}
