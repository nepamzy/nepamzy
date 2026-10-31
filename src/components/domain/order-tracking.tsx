'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  postCustomerLocationAction,
  stopCustomerLocationAction,
} from '@/server/modules/location/customer-actions'
import { LiveMap, type MapPin } from './live-map'

type Tracking =
  | { tracking: false; reason: string; status?: string }
  | {
      tracking: true
      status: string
      rider: { lat: number; lng: number; accuracy_m: number; age_seconds: number; stale: boolean }
      destination: {
        label: string | null
        lat: number | null
        lng: number | null
        radius_m?: number
        synthetic: boolean
      }
      arrival_detected: boolean
      estimate?: { distance: string; eta: string; note: string } | null
    }

const WHY: Record<string, string> = {
  not_in_transit: 'Live tracking starts as soon as a rider accepts your order.',
  no_active_assignment: 'No rider is carrying your order right now.',
  rider_not_sharing: 'The rider is not sharing a location at the moment.',
  no_location_yet: 'Waiting for the rider’s first location update…',
}

/** Polls a protected server route (no direct database access, no Realtime) every 15 seconds. */
export function OrderTracking({ orderId, mapKey }: { orderId: string; mapKey?: string | null }) {
  const [t, setT] = useState<Tracking | null>(null)
  const [err, setErr] = useState(false)
  const share = useShareLocation(orderId)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch(`/api/orders/${orderId}/tracking`, { cache: 'no-store' })
        if (!r.ok) throw new Error(String(r.status))
        if (!stop) {
          setT((await r.json()) as Tracking)
          setErr(false)
        }
      } catch {
        if (!stop) setErr(true)
      }
    }
    void load()
    const id = setInterval(load, 15_000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [orderId])

  const pins: MapPin[] = []
  if (t && t.tracking)
    pins.push({
      id: 'rider',
      lat: t.rider.lat,
      lng: t.rider.lng,
      label: 'Your rider',
      stale: t.rider.stale,
    })
  const dest = t && 'destination' in t ? t.destination : undefined
  if (dest && dest.lat != null && dest.lng != null)
    pins.push({
      id: 'destination',
      lat: dest.lat,
      lng: dest.lng,
      label: dest.label ?? 'Delivery point',
    })
  if (share.me) pins.push({ id: 'me', lat: share.me.lat, lng: share.me.lng, label: 'You' })

  const body = !t ? (
    <p role="status">{err ? 'Tracking is unavailable right now.' : 'Loading tracking…'}</p>
  ) : !t.tracking ? (
    <p role="status">{WHY[t.reason] ?? 'Tracking is unavailable.'}</p>
  ) : (
    <>
      <p>
        <strong>Rider:</strong>{' '}
        {t.rider.stale ? `last seen ${t.rider.age_seconds}s ago (location is out of date)` : 'live'}
        {t.destination.label ? ` · Destination: ${t.destination.label}` : ''}
      </p>
      {t.rider.stale && (
        <p className="font-medium text-warning-700">
          We have not had a recent update from the rider. This is not a problem with your order.
        </p>
      )}
      {t.arrival_detected && (
        <p className="font-semibold">
          The rider has reached your delivery point. You will confirm receipt with your pickup code
          and signature.
        </p>
      )}
      {t.estimate && (
        <p>
          <strong>{t.estimate.distance}</strong>, {t.estimate.eta}.{' '}
          <span className="text-sm text-muted">{t.estimate.note}</span>
        </p>
      )}
    </>
  )

  return (
    <div className="space-y-3" aria-live="polite">
      {pins.length > 0 && (
        <LiveMap
          pins={pins}
          mapKey={mapKey}
          label="Live map showing your rider and your delivery point"
        />
      )}
      {body}
      <div className="rounded-[var(--radius-control)] border border-line p-3">
        <p className="font-semibold">Show your rider where you are</p>
        <p className="mb-2 text-sm text-muted">
          Optional. Only your rider sees it, only while they are on this delivery, and it stops by
          itself when the order is finished.
        </p>
        {share.on ? (
          <Button type="button" variant="secondary" onClick={share.stop}>
            Stop sharing my location
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={share.start}>
            Share my location with my rider
          </Button>
        )}
        {share.note && (
          <p role="status" className="mt-2 text-sm">
            {share.note}
          </p>
        )}
      </div>
    </div>
  )
}

/** The customer's own position, sent only while they have switched sharing on. */
function useShareLocation(orderId: string) {
  const [on, setOn] = useState(false)
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const watch = useRef<number | null>(null)
  const lastSent = useRef(0)

  const halt = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    watch.current = null
  }
  const remember = (v: 'on' | 'off') => {
    try {
      localStorage.setItem('afit-share-location', v)
    } catch {
      /* private window: the choice just is not remembered */
    }
  }
  const stop = () => {
    remember('off')
    halt()
    setOn(false)
    setMe(null)
    setNote('Sharing stopped.')
    void stopCustomerLocationAction(orderId)
  }
  const start = () => {
    remember('on')
    if (!('geolocation' in navigator)) {
      setNote('This browser cannot share location.')
      return
    }
    setNote('Waiting for your location…')
    setOn(true)
    watch.current = navigator.geolocation.watchPosition(
      async (pos) => {
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        const now = Date.now()
        if (now - lastSent.current < 8000) return
        lastSent.current = now
        const r = await postCustomerLocationAction(orderId, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        })
        if (r.accepted) setNote('Your rider can see where you are.')
        else if (r.reason === 'no_active_delivery')
          setNote('Waiting for a rider to take this delivery.')
        else if (r.reason === 'inaccurate') setNote('Your location is not accurate enough yet.')
      },
      (err) => {
        halt()
        setOn(false)
        setNote(
          err.code === 1
            ? 'Location permission was denied. Allow location for this site to share it.'
            : 'We could not get your location.',
        )
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    )
  }
  // Already allowed on this device and not switched off: start by itself, so the rider can find the customer from the
  // moment the order is accepted without the customer having to tap anything.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (localStorage.getItem('afit-share-location') === 'off') return
        const perm = await navigator.permissions?.query({ name: 'geolocation' })
        if (!cancelled && perm?.state === 'granted') start()
      } catch {
        /* no permissions API: the customer taps the button instead */
      }
    })()
    return () => {
      cancelled = true
      halt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { on, me, note, start, stop }
}
