import type { ReactNode } from 'react'
import { enforceRoutePolicy } from '@/server/modules/identity-and-access/guard'

export default async function Layout({ children }: { children: ReactNode }) {
  await enforceRoutePolicy('/admin/delivery-fee-payments')
  return children
}
