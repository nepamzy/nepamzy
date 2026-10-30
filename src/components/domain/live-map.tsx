'use client'
import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

export type MapPin = {
  id: 'rider' | 'customer' | 'destination' | 'me'
  lat: number
  lng: number
  label: string
  /** Last update is old: the pin is drawn faded. */
  stale?: boolean
}

const CLASS: Record<MapPin['id'], string> = {
  rider: 'afit-pin afit-pin-rider',
  customer: 'afit-pin afit-pin-customer',
  me: 'afit-pin afit-pin-customer',
  destination: 'afit-pin afit-pin-destination',
}
const TEXT: Record<MapPin['id'], string> = { rider: 'R', customer: 'C', me: 'Me', destination: '⚑' }

/**
 * Satellite map (Esri World Imagery tiles + place labels) with a pin for each person or place. Pins move as the props
 * change; the view re-fits only when a pin appears or disappears, so a person who zooms in is not pulled back.
 */
export function LiveMap({
  pins,
  label,
  height = 280,
}: {
  pins: MapPin[]
  label: string
  height?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const state = useRef<{
    map: import('leaflet').Map
    L: typeof import('leaflet')
    markers: Map<string, import('leaflet').Marker>
    fitted: string
  } | null>(null)
  const latest = useRef(pins)

  const sync = () => {
    const s = state.current
    if (!s) return
    const { L, map, markers } = s
    const now = latest.current
    for (const [id, m] of markers)
      if (!now.some((p) => p.id === id)) {
        m.remove()
        markers.delete(id)
      }
    for (const p of now) {
      const icon = L.divIcon({
        className: '',
        html: `<span class="${CLASS[p.id]}${p.stale ? ' afit-pin-stale' : ''}">${TEXT[p.id]}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
      const m = markers.get(p.id)
      if (m) {
        m.setLatLng([p.lat, p.lng])
        m.setIcon(icon)
      } else {
        const created = L.marker([p.lat, p.lng], { icon, title: p.label, keyboard: false }).addTo(
          map,
        )
        markers.set(p.id, created)
      }
    }
    const key = now
      .map((p) => p.id)
      .sort()
      .join(',')
    if (key !== s.fitted && now.length) {
      s.fitted = key
      if (now.length === 1) map.setView([now[0]!.lat, now[0]!.lng], 17)
      else
        map.fitBounds(L.latLngBounds(now.map((p) => [p.lat, p.lng] as [number, number])), {
          padding: [40, 40],
          maxZoom: 18,
        })
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !box.current) return
      const first = latest.current[0]
      const map = L.map(box.current, {
        center: first ? [first.lat, first.lng] : [0, 0],
        zoom: first ? 16 : 2,
        attributionControl: false,
      })
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Esri' },
      ).addTo(map)
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19 },
      ).addTo(map)
      state.current = { map, L, markers: new Map(), fitted: '' }
      sync()
    })()
    return () => {
      cancelled = true
      state.current?.map.remove()
      state.current = null
    }
  }, [])

  useEffect(() => {
    latest.current = pins
    sync()
  })

  return (
    <div>
      <div
        ref={box}
        role="region"
        aria-label={label}
        style={{ height }}
        className="afit-map w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-navy-950"
      />
      <p className="mt-1 text-xs text-muted">
        Satellite imagery © Esri and its data providers. Delivery points in this version are
        placeholders.
      </p>
    </div>
  )
}
