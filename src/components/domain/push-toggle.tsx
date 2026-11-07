'use client'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { readMuted, subscribeMuted, writeMuted } from '@/lib/sound-pref'
import { pushWords, usePush } from '@/lib/use-push'

/** "Alerts" switch (phone pop-ups) and "Mute sound" switch for this device, on the Notifications page. */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const { phase, error, turnOn, turnOff } = usePush(publicKey)
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false)
  const ios = useSyncExternalStore(
    () => () => undefined,
    () => /iPhone|iPad|iPod/.test(navigator.userAgent),
    () => false,
  )
  const on = phase === 'on'
  const busy = phase === 'working' || phase === 'checking'
  const canSwitch = on || phase === 'off' || phase === 'working'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold">Alerts on this device</h3>
        <p role="status" className="text-sm font-medium" data-testid="alerts-state">
          {pushWords(phase)}
        </p>
        {canSwitch && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              role="switch"
              className="size-6"
              checked={on}
              disabled={busy}
              aria-label="Alerts"
              onChange={() => (on ? turnOff() : turnOn())}
            />
            <span className="font-semibold">Alerts {on ? 'on' : 'off'}</span>
          </label>
        )}
        <p className="text-sm text-muted">
          You get a short pop-up when your order or job moves, even when the app is closed. It never
          shows phone numbers, codes or addresses. If the phone is off, the pop-up arrives when it
          is back on and online.
        </p>
        {ios && (
          <p className="rounded-lg bg-info-50 p-3 text-sm" data-testid="ios-note">
            <b>iPhone:</b> alerts work only after you add AFIT Market to your Home Screen. Tap the
            Share button in Safari, then “Add to Home Screen”, then “Add”. Open the app from its
            icon and come back here.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold">Sound</h3>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            role="switch"
            className="size-6"
            checked={muted}
            aria-label="Mute sound"
            onChange={(e) => writeMuted(e.target.checked)}
          />
          <span className="font-semibold">Mute sound {muted ? '(muted)' : ''}</span>
        </label>
        <p className="text-sm text-muted">
          The ding-ding sound plays only while AFIT Market is open on your screen. When the app is
          closed or the phone is locked, your phone uses its own alert sound. This choice is saved
          on this device only.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const a = new Audio('/sounds/notification.wav')
            a.play().catch(() => undefined)
          }}
        >
          Play the sound
        </Button>
      </div>
    </div>
  )
}
