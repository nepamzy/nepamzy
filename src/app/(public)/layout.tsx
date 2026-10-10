import type { ReactNode } from 'react'
import { PublicHeader } from '@/components/shells/public-header'

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 py-6">
        {children}
      </main>
    </>
  )
}
