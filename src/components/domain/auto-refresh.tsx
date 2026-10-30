'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Re-reads the page from the server every few seconds while it is visible, so status text never lags behind the order.
 * Client state (open forms, drawn signatures) is kept: only the server-rendered parts are refreshed.
 */
export function AutoRefresh({ everySeconds = 15 }: { everySeconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, everySeconds * 1000)
    return () => clearInterval(id)
  }, [router, everySeconds])
  return null
}
