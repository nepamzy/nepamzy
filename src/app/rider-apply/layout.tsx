import type { ReactNode } from 'react'
import { CustomerLayout } from '@/components/shells/customer-layout'

export default async function Layout({ children }: { children: ReactNode }) {
  return <CustomerLayout prefix="/rider-apply">{children}</CustomerLayout>
}
