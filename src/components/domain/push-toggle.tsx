'use client'
import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
} from '@/server/modules/engagement/actions'

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

type Phase = 'checking' | 'unsupported' | 'blocked' | 'off' | 'on'

/** Turns pop-up notifications on or off for this device (Web Push). Needs the browser's permission. */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()

  useEffect(() => {
    let live = true
    ;(async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        return live && setPhase('unsupported')
      if (Notification.permission === 'denied') return live && setPhase('blocked')
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        const sub = await reg.pushManager.getSubscription()
        if (live) setPhase(sub ? 'on' : 'off')
      } catch {
        if (live) setPhase('unsupported')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const turnOn = () =>
    start(async () => {
      setMsg('')
      try {
        if ((await Notification.requestPermission()) !== 'granted') {
          setPhase('blocked')
          return
        }
        const reg = await navigator.serviceWorker.ready
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
        if (r.ok) setPhase('on')
        else {
          await sub.unsubscribe().catch(() => undefined)
          setMsg(r.error ?? 'Could not turn on pop-ups.')
        }
      } catch {
        setMsg('Could not turn on pop-ups on this device.')
      }
    })

  const turnOff = () =>
    start(async () => {
      setMsg('')
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await removePushSubscriptionAction(sub.endpoint)
          await sub.unsubscribe()
        }
        setPhase('off')
      } catch {
        setMsg('Could not turn off pop-ups.')
      }
    })

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Pop-up notifications on this device</h3>
      {phase === 'checking' && <p className="text-sm text-muted">Checking this device…</p>}
      {phase === 'unsupported' && (
        <p className="text-sm text-muted">
          This browser cannot show pop-ups. On an iPhone, add AFIT Market to your Home Screen first,
          then come back here.
        </p>
      )}
      {phase === 'blocked' && (
        <p className="text-sm text-muted">
          Pop-ups are blocked for this site. Allow notifications in your browser settings, then
          reload this page.
        </p>
      )}
      {phase === 'off' && (
        <>
          <p className="text-sm text-muted">
            Get a pop-up on your phone or computer when your order moves, even when AFIT Market is
            closed.
          </p>
          <Button type="button" onClick={turnOn} disabled={pending}>
            {pending ? 'Turning on…' : 'Turn on pop-ups'}
          </Button>
        </>
      )}
      {phase === 'on' && (
        <>
          <p role="status" className="text-sm font-medium text-success-700">
            Pop-ups are on for this device.
          </p>
          <Button type="button" variant="secondary" onClick={turnOff} disabled={pending}>
            {pending ? 'Turning off…' : 'Turn off pop-ups'}
          </Button>
        </>
      )}
      {msg && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {msg}
        </p>
      )}
    </div>
  )
}
