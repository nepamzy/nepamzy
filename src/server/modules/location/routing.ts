import { haversineM, type LatLng } from './geo'

/**
 * Routing adapter. The application depends on this interface, not on one vendor's API.
 * Implementations here: a FAKE provider for development/tests, and a labelled straight-line fallback.
 * A real provider (route distance on the campus road network) is NOT integrated: no mapping service has been
 * approved or purchased, and no real AFIT coordinates exist yet.
 */
export type RouteEstimate = {
  distanceM: number
  durationS: number
  /** 'route' = from a routing provider; 'straight_line' = as-the-crow-flies approximation. */
  basis: 'route' | 'straight_line'
  /** Always true for the fake and the fallback: do not present these as real campus routes. */
  approximate: boolean
  source: 'fake-provider' | 'straight-line-fallback'
}

export interface RoutingProvider {
  estimate(from: LatLng, to: LatLng): Promise<RouteEstimate | null>
}

const WALK_SPEED_MPS = 4 / 3.6 // 4 km/h
const BIKE_SPEED_MPS = 12 / 3.6 // 12 km/h: PLACEHOLDER pace for a campus rider

/**
 * FAKE provider: pretends roads are 30% longer than the straight line. Deterministic. Its numbers are SYNTHETIC and
 * exist only so the UI and tests exercise the "route distance" path.
 */
export class FakeRoutingProvider implements RoutingProvider {
  async estimate(from: LatLng, to: LatLng): Promise<RouteEstimate> {
    const distanceM = Math.round(haversineM(from, to) * 1.3)
    return {
      distanceM,
      durationS: Math.round(distanceM / BIKE_SPEED_MPS),
      basis: 'route',
      approximate: true,
      source: 'fake-provider',
    }
  }
}

/** Used when no routing provider is available. Clearly an approximation. */
export function straightLineEstimate(from: LatLng, to: LatLng): RouteEstimate {
  const distanceM = Math.round(haversineM(from, to))
  return {
    distanceM,
    durationS: Math.round(distanceM / BIKE_SPEED_MPS),
    basis: 'straight_line',
    approximate: true,
    source: 'straight-line-fallback',
  }
}

export { WALK_SPEED_MPS, BIKE_SPEED_MPS }

/** The provider currently wired in. Replace with a real adapter only after owner approval of a mapping service. */
export function routingProvider(): RoutingProvider | null {
  // Synthetic data only: the fake provider is the only implementation, and it is used outside production deployments
  // exactly like in tests. In production with no approved provider we return null and callers fall back to labelled
  // straight-line estimates.
  return process.env.APP_ENV === 'production' || !process.env.APP_ENV
    ? null
    : new FakeRoutingProvider()
}

export async function estimateTrip(
  from: LatLng,
  to: LatLng,
  provider: RoutingProvider | null = routingProvider(),
): Promise<RouteEstimate> {
  if (provider) {
    try {
      const r = await provider.estimate(from, to)
      if (r) return r
    } catch {
      /* fall through to the labelled approximation */
    }
  }
  return straightLineEstimate(from, to)
}

export function describeEstimate(e: RouteEstimate): {
  distance: string
  eta: string
  note: string
} {
  const km = e.distanceM >= 1000 ? `${(e.distanceM / 1000).toFixed(1)} km` : `${e.distanceM} m`
  const mins = Math.max(1, Math.round(e.durationS / 60))
  return {
    distance: km,
    eta: `about ${mins} min`,
    note:
      e.basis === 'route'
        ? 'Estimate from a SAMPLE route service (synthetic data), not a real campus route.'
        : 'Straight-line approximation, not the actual route.',
  }
}
