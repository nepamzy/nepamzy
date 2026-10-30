'use client'
import { useActionState, useEffect, useRef, useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/fields'
import { checkFix } from '@/server/modules/location/geo'
import {
  ackTermsAction,
  acceptOfferAction,
  goActiveAction,
  goInactiveAction,
  issueTokenAction,
  postLocationAction,
  reportIssueAction,
  startRouteAction,
  submitRiderApplicationAction,
  type TokenState,
} from '@/server/modules/riders/actions'
import type { ActionState } from '@/server/modules/shared/action-helpers'

export function RiderApplicationForm() {
  return (
    <ActionForm
      action={submitRiderApplicationAction}
      submitLabel="Apply to deliver"
      pendingLabel="Sending…"
    >
      <Input
        label="Full name"
        name="fullName"
        required
        minLength={2}
        maxLength={80}
        autoComplete="name"
      />
      <Input
        label="Contact phone"
        name="phone"
        type="tel"
        required
        inputMode="tel"
        hint="Used only by administrators to reach you."
      />
      <Input label="How will you travel? (optional)" name="vehicle" maxLength={200} />
      <Checkbox
        label="I understand riders are reviewed and approved before they can deliver, and that I must accept the rider terms before going active."
        name="accept"
        required
      />
    </ActionForm>
  )
}

export function TermsForm({
  version,
  title,
  body,
  placeholder,
}: {
  version: string
  title: string
  body: string
  placeholder: boolean
}) {
  return (
    <ActionForm
      action={ackTermsAction}
      submitLabel="I accept the rider terms"
      pendingLabel="Saving…"
    >
      <input type="hidden" name="version" value={version} />
      {placeholder && (
        <p className="rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 font-medium text-warning-700">
          Development placeholder text. It is not approved by AFIT or counsel and must be replaced
          before real riders are onboarded.
        </p>
      )}
      <h3 className="font-bold">{title}</h3>
      <p className="whitespace-pre-line text-sm">{body}</p>
      <Checkbox
        label="I have read the rider terms, conduct rules and privacy notice."
        name="accept"
        required
      />
    </ActionForm>
  )
}

/** Browsers only show a permission prompt in response to a request, so we ask once, right after Go Active. Nothing is sent. */
function primeLocationPermission() {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return
  navigator.geolocation.getCurrentPosition(
    () => undefined,
    () => undefined,
    { maximumAge: 60_000, timeout: 10_000 },
  )
}

export function GoActiveForm() {
  async function activate(): Promise<ActionState> {
    const r = await goActiveAction()
    if (r.ok) primeLocationPermission()
    return r
  }
  return (
    <ActionForm action={activate} submitLabel="Go Active" pendingLabel="Starting…">
      <p className="text-sm">
        When you go active, your phone will ask to share your location. It is shared only while you
        carry an accepted delivery, only with the customer you are delivering to and authorised
        staff, and it stops when you go inactive.
      </p>
    </ActionForm>
  )
}

export function GoInactiveForm() {
  return (
    <ActionForm
      action={goInactiveAction}
      submitLabel="Go Inactive (stop sharing)"
      pendingLabel="Stopping…"
    >
      <p className="text-sm">
        Accepted deliveries you have not collected yet go back to the pool. If you are carrying a
        parcel you must finish or ask support.
      </p>
    </ActionForm>
  )
}

export function AcceptButton({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={acceptOfferAction} submitLabel="Accept delivery" pendingLabel="Accepting…">
      <input type="hidden" name="orderId" value={orderId} />
    </ActionForm>
  )
}

export function TokenCard({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState<TokenState, FormData>(issueTokenAction, {})
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {state.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          {state.error}
        </p>
      )}
      {state.token && (
        <div role="status" className="rounded-[var(--radius-control)] bg-brand-50 p-3">
          <p className="text-sm font-semibold">Show this code to the vendor</p>
          <p
            className="text-3xl font-bold tracking-widest"
            aria-label={`Handover code ${state.token.split('').join(' ')}`}
          >
            {state.token}
          </p>
          <p className="text-sm text-muted">Works once and expires. A new code cancels this one.</p>
        </div>
      )}
      <Button type="submit" variant="secondary" disabled={pending}>
        {state.token ? 'Show a new code' : 'Show handover code to vendor'}
      </Button>
    </form>
  )
}

export function StartRouteButton({ assignmentId }: { assignmentId: string }) {
  return (
    <ActionForm action={startRouteAction} submitLabel="Start route" pendingLabel="Starting…">
      <input type="hidden" name="assignmentId" value={assignmentId} />
    </ActionForm>
  )
}

export function ReportIssueForm({ assignmentId }: { assignmentId: string }) {
  return (
    <details>
      <summary className="cursor-pointer font-semibold">Report a problem</summary>
      <div className="mt-2">
        <ActionForm action={reportIssueAction} submitLabel="Send report" pendingLabel="Sending…">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <Select label="What is the problem?" name="reason" required defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            <option value="vendor_not_ready">Vendor not ready</option>
            <option value="recipient_unavailable">Recipient unavailable</option>
            <option value="blocked_route">Blocked route</option>
            <option value="safety_security_restriction">Safety or security restriction</option>
            <option value="gps_issue">My GPS is not working</option>
          </Select>
          <Input label="Details (optional)" name="note" maxLength={300} />
        </ActionForm>
      </div>
    </details>
  )
}

type LiveState = 'idle' | 'starting' | 'sharing' | 'denied' | 'unsupported' | 'paused'

/**
 * Shares the rider's position ONLY while `enabled` (active shift + an accepted delivery). Mounted nowhere else, so
 * no geolocation call happens before Go Active. Positions go to a server action, never straight to Supabase.
 */
export function LocationSharing({
  enabled,
  minIntervalSeconds,
  maxAccuracyM,
  maxAgeSeconds,
}: {
  enabled: boolean
  minIntervalSeconds: number
  maxAccuracyM: number
  maxAgeSeconds: number
}) {
  const [live, setLive] = useState<LiveState>('idle')
  const [last, setLast] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const lastSent = useRef(0)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!('geolocation' in navigator)) {
      queueMicrotask(() => setLive('unsupported'))
      return
    }
    let cancelled = false
    let watchId: number | null = null
    let restart: ReturnType<typeof setTimeout> | null = null
    let lastPositionAt = 0
    const onPosition = async (pos: GeolocationPosition) => {
      lastPositionAt = Date.now()
      const now = Date.now()
      if (now - lastSent.current < minIntervalSeconds * 1000) return
      const fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        observedAtMs: pos.timestamp,
      }
      const pre = checkFix(fix, now, { maxAccuracyM, maxAgeSeconds })
      if (!pre.ok) {
        setNote(
          pre.reason === 'inaccurate'
            ? 'Waiting for a more accurate GPS signal…'
            : 'Waiting for a fresh GPS reading…',
        )
        return
      }
      lastSent.current = now
      const r = await postLocationAction(fix)
      if (cancelled) return
      if (r.accepted) {
        setLive('sharing')
        setNote(null)
        setLast(new Date().toLocaleTimeString('en-NG'))
      } else if (r.reason === 'tracking_not_active') {
        setLive('paused')
      } else {
        setNote('The last position was not accepted. Still trying.')
      }
    }
    const start = () => {
      // Ask for one reading straight away: some phones and browsers send nothing from a watch until the rider moves.
      navigator.geolocation.getCurrentPosition(onPosition, () => undefined, {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000,
      })
      watchId = navigator.geolocation.watchPosition(
        onPosition,
        (err) => {
          if (err.code === 1) {
            setLive('denied')
            return
          }
          const errAt = Date.now()
          setNote('Waiting for a GPS reading… If this lasts, you can report a GPS problem below.')
          // Timeouts (3) are normal when the phone has not moved; "unavailable" (2) is often momentary and a reading
          // usually follows. If no reading arrives shortly after either, start a fresh watch so updates keep flowing.
          const delay = err.code === 3 ? 1000 : 4000
          if (restart) clearTimeout(restart)
          restart = setTimeout(() => {
            if (cancelled || lastPositionAt > errAt) return
            if (watchId !== null) navigator.geolocation.clearWatch(watchId)
            start()
          }, delay)
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
      )
    }
    start()
    const wl = (
      navigator as Navigator & {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
      }
    ).wakeLock
    const acquire = () =>
      wl
        ?.request('screen')
        .then((l) => (wakeLock.current = l))
        .catch(() => undefined)
    void acquire()
    const onVisible = () => document.visibilityState === 'visible' && void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      if (restart) clearTimeout(restart)
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      document.removeEventListener('visibilitychange', onVisible)
      void wakeLock.current?.release().catch(() => undefined)
    }
  }, [enabled, minIntervalSeconds, maxAccuracyM, maxAgeSeconds])

  const starting = live === 'idle' || live === 'starting'
  const on = enabled && (live === 'sharing' || starting)
  return (
    <div
      aria-live="polite"
      className="space-y-1 rounded-[var(--radius-control)] border border-line p-3"
    >
      <p className="font-semibold">Location sharing is {on ? 'ON' : 'OFF'}</p>
      {!enabled && (
        <p className="text-sm text-muted">
          It is off because you have no accepted delivery, or you are inactive.
        </p>
      )}
      {enabled && live === 'sharing' && (
        <p className="text-sm">Last position sent at {last}. Keep this screen open and unlocked.</p>
      )}
      {enabled && starting && <p className="text-sm">Waiting for your first GPS reading…</p>}
      {live === 'denied' && (
        <p className="text-sm font-medium text-danger-700">
          Location permission was denied, so the customer cannot see you. Allow location for this
          site in your browser settings, or report a GPS problem.
        </p>
      )}
      {live === 'unsupported' && (
        <p className="text-sm font-medium text-danger-700">This browser cannot share location.</p>
      )}
      {live === 'paused' && <p className="text-sm">Sharing paused: no active delivery.</p>}
      {note && <p className="text-sm text-muted">{note}</p>}
      <p className="text-xs text-muted">
        Phones may stop sharing when the screen locks or this app is in the background. Keep it open
        while delivering.
      </p>
    </div>
  )
}
