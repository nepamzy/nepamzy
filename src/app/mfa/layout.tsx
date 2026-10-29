import type { ReactNode } from 'react'
import { AuthFrame } from '@/components/shells/auth-frame'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

export default async function MfaLayout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/mfa')
  return <AuthFrame>{children}</AuthFrame>
}
