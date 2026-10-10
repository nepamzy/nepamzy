import type { ReactNode } from 'react'
import { PublicHeader } from '@/components/shells/public-header'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

export default async function MfaLayout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/mfa')
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-md px-4 py-8">
        {children}
      </main>
    </>
  )
}
