import type { Metadata, Viewport } from 'next'
import { connection } from 'next/server'
import type { ReactNode } from 'react'
import { OfflineBanner } from '@/components/ui/states'
import { RegisterServiceWorker } from '@/components/register-sw'
import { ToastProvider } from '@/components/ui/toast'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'AFIT Market', template: '%s | AFIT Market' },
  description: 'Order from vendors for pickup or delivery.',
  manifest: '/manifest.webmanifest',
  applicationName: 'AFIT Market',
  robots: { index: false, follow: false }, // pre-launch: not for search engines
}
export const viewport: Viewport = { themeColor: '#0b5551', width: 'device-width', initialScale: 1 }

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection() // CSP nonces require per-request (dynamic) rendering
  return (
    <html lang="en-NG">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2"
        >
          Skip to main content
        </a>
        <OfflineBanner />
        <RegisterServiceWorker />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
