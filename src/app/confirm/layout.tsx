import type { ReactNode } from 'react'
import { CustomerLayout } from '@/components/shells/customer-layout'

export default async function ConfirmLayout({ children }: { children: ReactNode }) {
  return (
    <CustomerLayout prefix="/confirm" area="Confirm delivery">
      {children}
    </CustomerLayout>
  )
}
