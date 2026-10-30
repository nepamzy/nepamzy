import type { ReactNode } from 'react'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

/** Customer-only part of the account: a shop or a rider is sent back to their own area. */
export default async function Layout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/account/receipts')
  return children
}
