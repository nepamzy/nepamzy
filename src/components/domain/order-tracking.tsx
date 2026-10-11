'use client'
import { useEffect, useState } from 'react'

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
  not_in_transit: 'Live tracking starts after the vendor hands your parcel to the rider.',
  no_active_assignment: 'No rider is carrying your order right now.',
  rider_not_sharing: 'The rider is not sharing a location at the moment.',
  no_location_yet: 'Waiting for the rider’s first location update…',
}

/** Polls a protected server route (no direct database access, no Realtime) every 10 seconds. */
export function OrderTracking({ orderId }: { orderId: string }) {
  const [t, setT] = useState<Tracking | null>(null)
  const [err, setErr] = useState(false)
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
    const id = setInterval(load, 10_000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [orderId])

  if (err && !t) return <p role="status">Tracking is unavailable right now.</p>
  if (!t) return <p role="status">Loading tracking…</p>
  if (!t.tracking) return <p role="status">{WHY[t.reason] ?? 'Tracking is unavailable.'}</p>

  const { rider, destination } = t
  // A tiny SYNTHETIC map: plots the rider and the delivery point relative to each other. Not a real AFIT map.
  const pts = [
    rider,
    ...(destination.lat != null && destination.lng != null
      ? [{ lat: destination.lat, lng: destination.lng }]
      : []),
  ]
  const lats = pts.map((p) => p.lat)
  const lngs = pts.map((p) => p.lng)
  const pad = 0.0005
  const minLat = Math.min(...lats) - pad
  const maxLat = Math.max(...lats) + pad
  const minLng = Math.min(...lngs) - pad
  const maxLng = Math.max(...lngs) + pad
  const x = (lng: number) => 10 + ((lng - minLng) / (maxLng - minLng || 1)) * 280
  const y = (lat: number) => 190 - ((lat - minLat) / (maxLat - minLat || 1)) * 180
  return (
    <div className="space-y-2" aria-live="polite">
      <svg
        viewBox="0 0 300 200"
        className="w-full max-w-md rounded-[var(--radius-control)] border border-line bg-brand-50"
        role="img"
        aria-label="Sample map showing the rider and your delivery point"
      >
        {destination.lat != null && destination.lng != null && (
          <circle
            cx={x(destination.lng)}
            cy={y(destination.lat)}
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        )}
        <circle cx={x(rider.lng)} cy={y(rider.lat)} r="6" fill={rider.stale ? '#999' : '#0a7'} />
        <text x="8" y="14" fontSize="9">
          SAMPLE MAP: synthetic data, not AFIT
        </text>
      </svg>
      <p>
        <strong>Rider:</strong>{' '}
        {rider.stale ? `last seen ${rider.age_seconds}s ago (location is out of date)` : 'live'}
        {destination.label ? ` · Destination: ${destination.label}` : ''}
      </p>
      {rider.stale && (
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
      {destination.synthetic && (
        <p className="text-xs text-muted">
          Delivery points in this version are fictional placeholders.
        </p>
      )}
    </div>
  )
}
