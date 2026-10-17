/** Pure geometry helpers. All coordinates in this project are SYNTHETIC until AFIT approves real delivery points. */
export type LatLng = { lat: number; lng: number }

const R = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle ("as the crow flies") distance in metres. Mirrors app_private.haversine_m in the database. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type FixCheck =
  { ok: true } | { ok: false; reason: 'malformed' | 'inaccurate' | 'stale' | 'implausible_time' }
export type Thresholds = { maxAccuracyM: number; maxAgeSeconds: number }

/** Client-side pre-check (the database repeats it authoritatively). Used to avoid sending hopeless fixes. */
export function checkFix(
  fix: { lat: number; lng: number; accuracyM: number; observedAtMs: number },
  nowMs: number,
  t: Thresholds,
): FixCheck {
  const finite = [fix.lat, fix.lng, fix.accuracyM, fix.observedAtMs].every(Number.isFinite)
  if (!finite || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180 || fix.accuracyM < 0)
    return { ok: false, reason: 'malformed' }
  if (fix.observedAtMs > nowMs + 30_000) return { ok: false, reason: 'implausible_time' }
  if (fix.observedAtMs < nowMs - t.maxAgeSeconds * 1000) return { ok: false, reason: 'stale' }
  if (fix.accuracyM > t.maxAccuracyM) return { ok: false, reason: 'inaccurate' }
  return { ok: true }
}

/** Mirrors the database rule for arrival: fresh, accurate, and inside the radius. Never used to complete an order. */
export function insideGeofence(
  fix: { lat: number; lng: number; accuracyM: number; observedAtMs: number },
  dest: LatLng & { radiusM: number },
  nowMs: number,
  t: { arrivalMaxAccuracyM: number; arrivalMaxAgeSeconds: number },
): boolean {
  if (fix.accuracyM > t.arrivalMaxAccuracyM) return false
  if (fix.observedAtMs < nowMs - t.arrivalMaxAgeSeconds * 1000) return false
  return haversineM(fix, dest) <= dest.radiusM
}
