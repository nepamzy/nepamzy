import { describe, expect, it } from 'vitest'
import { checkFix, haversineM, insideGeofence } from './geo'
import {
  FakeRoutingProvider,
  describeEstimate,
  estimateTrip,
  straightLineEstimate,
} from './routing'

const A = { lat: 0.01, lng: 0.01 }
const T = { maxAccuracyM: 100, maxAgeSeconds: 120 }
const NOW = 1_800_000_000_000

describe('haversine', () => {
  it('is zero for the same point, symmetric, and about 111 m per 0.001 degree of latitude', () => {
    expect(haversineM(A, A)).toBe(0)
    const b = { lat: 0.011, lng: 0.01 }
    expect(haversineM(A, b)).toBeCloseTo(haversineM(b, A), 6)
    expect(haversineM(A, b)).toBeGreaterThan(110)
    expect(haversineM(A, b)).toBeLessThan(112)
  })
})

describe('fix pre-check', () => {
  const good = { lat: 0.01, lng: 0.01, accuracyM: 10, observedAtMs: NOW }
  it('accepts a fresh accurate fix', () => expect(checkFix(good, NOW, T)).toEqual({ ok: true }))
  it('rejects malformed, inaccurate, stale and future fixes', () => {
    expect(checkFix({ ...good, lat: 91 }, NOW, T)).toMatchObject({ reason: 'malformed' })
    expect(checkFix({ ...good, lng: NaN }, NOW, T)).toMatchObject({ reason: 'malformed' })
    expect(checkFix({ ...good, accuracyM: -1 }, NOW, T)).toMatchObject({ reason: 'malformed' })
    expect(checkFix({ ...good, accuracyM: 101 }, NOW, T)).toMatchObject({ reason: 'inaccurate' })
    expect(checkFix({ ...good, observedAtMs: NOW - 121_000 }, NOW, T)).toMatchObject({
      reason: 'stale',
    })
    expect(checkFix({ ...good, observedAtMs: NOW + 31_000 }, NOW, T)).toMatchObject({
      reason: 'implausible_time',
    })
  })
  it('thresholds are inclusive at the boundary', () => {
    expect(checkFix({ ...good, accuracyM: 100 }, NOW, T).ok).toBe(true)
    expect(checkFix({ ...good, observedAtMs: NOW - 120_000 }, NOW, T).ok).toBe(true)
  })
})

describe('geofence', () => {
  const dest = { ...A, radiusM: 60 }
  const t = { arrivalMaxAccuracyM: 50, arrivalMaxAgeSeconds: 30 }
  const near = { lat: 0.0103, lng: 0.01, accuracyM: 10, observedAtMs: NOW }
  it('inside radius with a fresh accurate fix', () =>
    expect(insideGeofence(near, dest, NOW, t)).toBe(true))
  it('outside radius', () =>
    expect(insideGeofence({ ...near, lat: 0.0108 }, dest, NOW, t)).toBe(false))
  it('stale or inaccurate fixes never count, even inside the radius', () => {
    expect(insideGeofence({ ...near, observedAtMs: NOW - 31_000 }, dest, NOW, t)).toBe(false)
    expect(insideGeofence({ ...near, accuracyM: 51 }, dest, NOW, t)).toBe(false)
  })
})

describe('routing adapter', () => {
  const B = { lat: 0.0, lng: 0.01 }
  it('the fake provider returns a labelled synthetic route longer than the straight line', async () => {
    const e = await new FakeRoutingProvider().estimate(A, B)
    expect(e).toMatchObject({ basis: 'route', approximate: true, source: 'fake-provider' })
    expect(e.distanceM).toBeGreaterThan(straightLineEstimate(A, B).distanceM)
  })
  it('without a provider the estimate is a straight line and says so', async () => {
    const e = await estimateTrip(A, B, null)
    expect(e).toMatchObject({
      basis: 'straight_line',
      approximate: true,
      source: 'straight-line-fallback',
    })
    expect(describeEstimate(e).note).toMatch(/approximation/i)
  })
  it('a failing provider falls back to the labelled straight line', async () => {
    const broken = {
      estimate: async () => {
        throw new Error('down')
      },
    }
    expect((await estimateTrip(A, B, broken)).basis).toBe('straight_line')
  })
  it('the fake route is never described as a real route', () => {
    const d = describeEstimate({
      distanceM: 1500,
      durationS: 400,
      basis: 'route',
      approximate: true,
      source: 'fake-provider',
    })
    expect(d.note).toMatch(/SAMPLE|synthetic/i)
    expect(d.distance).toBe('1.5 km')
  })
})
