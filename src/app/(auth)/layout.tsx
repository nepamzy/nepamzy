import type { ReactNode } from 'react'
import { PublicHeader } from '@/components/shells/public-header'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-md px-4 py-8">{children}</main>
    </>
  )
}
