'use client'
import { useEffect } from 'react'

/** Registers the minimal offline-fallback service worker (public/sw.js). It never caches account pages. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    }
  }, [])
  return null
}
