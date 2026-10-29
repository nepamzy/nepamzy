import type { ReactNode } from 'react'
import { PublicFooter } from '@/components/shells/public-footer'
import { PublicHeader } from '@/components/shells/public-header'

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
