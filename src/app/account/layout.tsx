import type { ReactNode } from 'react'
import { CustomerLayout } from '@/components/shells/customer-layout'

export default async function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <CustomerLayout prefix="/account" area="My account">
      {children}
    </CustomerLayout>
  )
}
