'use client'
import { useEffect, useState } from 'react'
import { LiveMap, type MapPin } from './live-map'

type JobMap =
  | { active: false }
  | {
      active: true
      destination: { label: string | null; lat: number | null; lng: number | null }
      rider: { lat: number; lng: number; age_seconds: number } | null
      customer: { lat: number; lng: number; age_seconds: number; stale: boolean } | null
    }

/** The rider's map for one delivery: themselves, the delivery point, and the customer if they chose to share. */
export function RiderJobMap({
  assignmentId,
  mapKey,
}: {
  assignmentId: string
  mapKey?: string | null
}) {
  const [m, setM] = useState<JobMap | null>(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch(`/api/rider/jobs/${assignmentId}/map`, { cache: 'no-store' })
        if (r.ok && !stop) setM((await r.json()) as JobMap)
      } catch {
        /* the next poll tries again */
      }
    }
    void load()
    const id = setInterval(load, 8_000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [assignmentId])

  if (!m || !m.active) return null
  const pins: MapPin[] = []
  if (m.rider) pins.push({ id: 'rider', lat: m.rider.lat, lng: m.rider.lng, label: 'You' })
  if (m.destination.lat != null && m.destination.lng != null)
    pins.push({
      id: 'destination',
      lat: m.destination.lat,
      lng: m.destination.lng,
      label: m.destination.label ?? 'Delivery point',
    })
  if (m.customer)
    pins.push({
      id: 'customer',
      lat: m.customer.lat,
      lng: m.customer.lng,
      label: 'Customer',
      stale: m.customer.stale,
    })
  if (pins.length === 0) return null
  return (
    <div className="space-y-1">
      <LiveMap pins={pins} mapKey={mapKey} label="Map of your delivery" height={240} />
      <p className="text-sm">
        {m.customer
          ? m.customer.stale
            ? `The customer shared their location ${m.customer.age_seconds}s ago (out of date).`
            : 'The customer is sharing where they are (blue pin).'
          : 'The customer has not shared their location. Head for the red flag.'}
      </p>
    </div>
  )
}
