'use client'
import { useEffect } from 'react'
import { readMuted } from '@/lib/sound-pref'

const LAST_KEY = 'afit.sound.last'
const POLL_MS = 30000

function lastPlayed(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}
function remember(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    /* ignore */
  }
}

/**
 * Plays /sounds/notification.wav once for each new notification while the app is open (same sound for every role).
 * Browsers only allow sound after the person has touched the page, so the first touch "unlocks" it and play() errors
 * are swallowed. Each notification id plays at most once per device (shared across tabs through local storage), whether
 * it arrives by push message or by the 30-second check. Muted devices stay silent.
 */
export function NotificationSound() {
  useEffect(() => {
    let unlocked = false
    let audio: HTMLAudioElement | null = null
    let stopped = false
    let primed = false // first poll only records the newest id; it never plays for old items

    const get = () => {
      if (!audio) {
        audio = new Audio('/sounds/notification.wav')
        audio.preload = 'auto'
      }
      return audio
    }
    const unlock = () => {
      unlocked = true
      get()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock, { once: false })
    window.addEventListener('keydown', unlock, { once: false })

    const ring = (id: string | null) => {
      if (id) {
        if (lastPlayed() === id) return // already played here (or in another tab)
        remember(id)
      }
      if (!unlocked || readMuted()) return
      const a = get()
      a.currentTime = 0
      a.play().catch(() => undefined)
    }

    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string | null } | null
      if (d?.type === 'afit-notification') ring(typeof d.id === 'string' ? d.id : null)
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onMessage)

    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        try {
          const r = await fetch('/api/notifications/latest', { cache: 'no-store' })
          if (r.status === 401) return // signed out: stop checking until the next page load
          const j = (await r.json()) as { id?: string | null }
          if (j.id) {
            if (!primed) {
              remember(j.id) // already waiting when the page opened: stay silent
            } else ring(j.id)
          }
          primed = true
        } catch {
          /* offline: try again later */
        }
      }
      timer = setTimeout(poll, POLL_MS)
    }
    void poll()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      if ('serviceWorker' in navigator)
        navigator.serviceWorker.removeEventListener('message', onMessage)
    }
  }, [])
  return null
}
