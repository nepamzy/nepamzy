'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
} from '@/server/modules/engagement/actions'

const CHANGE = 'afit-push-change'
export type PushPhase = 'checking' | 'unsupported' | 'blocked' | 'off' | 'on' | 'working' | 'signin'

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Phone alerts (Web Push) for this device. Permission is only ever asked inside turnOn(), after a tap. */
export function usePush(publicKey: string | null) {
  const [phase, setPhase] = useState<PushPhase>('checking')
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const detect = async () => {
      if (
        !publicKey ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        return live && setPhase('unsupported')
      if (Notification.permission === 'denied') return live && setPhase('blocked')
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (live) setPhase(sub && Notification.permission === 'granted' ? 'on' : 'off')
      } catch {
        if (live) setPhase('off')
      }
    }
    void detect()
    // the top bar and the Notifications page share one device: keep them in step
    const onChange = () => void detect()
    window.addEventListener(CHANGE, onChange)
    return () => {
      live = false
      window.removeEventListener(CHANGE, onChange)
    }
  }, [publicKey])

  const turnOn = useCallback(async () => {
    if (!publicKey) return
    setError('')
    setPhase('working')
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        setPhase(Notification.permission === 'denied' ? 'blocked' : 'off')
        return
      }
      const reg =
        (await navigator.serviceWorker.getRegistration('/sw.js')) ??
        (await navigator.serviceWorker.register('/sw.js'))
      await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }))
      const j = sub.toJSON()
      const r = await savePushSubscriptionAction({
        endpoint: j.endpoint,
        p256dh: j.keys?.p256dh,
        auth: j.keys?.auth,
      })
      if (r.ok) {
        setPhase('on')
        window.dispatchEvent(new Event(CHANGE))
        return
      }
      await sub.unsubscribe().catch(() => undefined)
      if (/sign in/i.test(r.error ?? '')) return setPhase('signin')
      setError(r.error ?? 'Could not turn on alerts.')
      setPhase('off')
    } catch {
      setError('Could not turn on alerts on this device.')
      setPhase('off')
    }
  }, [publicKey])

  const turnOff = useCallback(async () => {
    setError('')
    setPhase('working')
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint)
        await sub.unsubscribe()
      }
      setPhase('off')
      window.dispatchEvent(new Event(CHANGE))
    } catch {
      setError('Could not turn off alerts.')
      setPhase('on')
    }
  }, [])

  return { phase, error, turnOn, turnOff }
}

/** Plain-words state for the current phase. */
export function pushWords(phase: PushPhase): string {
  switch (phase) {
    case 'on':
      return 'Phone alerts are on'
    case 'off':
      return 'Phone alerts are off'
    case 'blocked':
      return 'Your phone has blocked alerts for this site. Open phone settings, then Site settings, to allow them.'
    case 'unsupported':
      return 'This browser cannot show phone alerts. On an iPhone, add AFIT Market to your Home Screen first.'
    case 'signin':
      return 'Please sign in first, then turn on alerts.'
    case 'working':
      return 'One moment…'
    default:
      return 'Checking this device…'
  }
}
