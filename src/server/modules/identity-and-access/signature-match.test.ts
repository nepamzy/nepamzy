import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { SIGNATURE_MATCH_MIN, signatureSimilarity, signaturesMatch } from './signature-match'

// tiny deterministic RNG
const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
type Pt = [number, number]
function draw(
  points: Pt[],
  opts: { dx?: number; dy?: number; s?: number; jitter?: number; seed?: number; w?: number } = {},
) {
  const W = 400,
    H = 160
  const png = new PNG({ width: W, height: H })
  png.data.fill(255)
  const r = rng(opts.seed ?? 1)
  const j = opts.jitter ?? 0
  const pts = points.map(
    ([x, y]) =>
      [
        x * (opts.s ?? 1) + (opts.dx ?? 0) + (r() - 0.5) * j,
        y * (opts.s ?? 1) + (opts.dy ?? 0) + (r() - 0.5) * j,
      ] as Pt,
  )
  const stamp = (x: number, y: number) => {
    const rad = opts.w ?? 2
    for (let yy = -rad; yy <= rad; yy++)
      for (let xx = -rad; xx <= rad; xx++) {
        const X = Math.round(x + xx),
          Y = Math.round(y + yy)
        if (X >= 0 && X < W && Y >= 0 && Y < H) {
          const i = (Y * W + X) * 4
          png.data[i] = 17
          png.data[i + 1] = 17
          png.data[i + 2] = 17
          png.data[i + 3] = 255
        }
      }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k]!,
      [x1, y1] = pts[k + 1]!
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0))
    for (let t = 0; t <= n; t++) stamp(x0 + ((x1 - x0) * t) / n, y0 + ((y1 - y0) * t) / n)
  }
  return PNG.sync.write(png)
}
const curve = (f: (t: number) => Pt, n = 60): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => f(i / n))
const A = curve((t) => [40 + 300 * t, 80 + 40 * Math.sin(t * 14) * (1 - t * 0.5) - 30 * t])
const B = curve((t) => [60 + 260 * t, 40 + 80 * Math.abs(Math.sin(t * 5)) + 20 * Math.cos(t * 9)])
const C = curve((t) => [50 + 280 * t, 120 - 90 * t + 25 * Math.sin(t * 22)])
const D = curve((t) => [
  60 + 100 * Math.cos(t * 6.3) * t + 120 * t,
  80 + 60 * Math.sin(t * 6.3) * t,
])
const E = curve((t) => [40 + 320 * t, 100 + 30 * Math.sin(t * 3)])
describe('signature matching', () => {
  const sigs: Record<string, Pt[]> = { A, B, C, D, E }
  it('the same signature, drawn again shaky, smaller, larger, shifted or with a thicker pen, is accepted', () => {
    for (const [name, p] of Object.entries(sigs)) {
      const saved = draw(p, { seed: 1 })
      for (let s = 2; s < 8; s++) {
        const again = draw(p, {
          seed: s,
          jitter: 14,
          dx: (s - 4) * 8,
          dy: (s - 4) * 4,
          s: 0.8 + (s % 4) * 0.12,
          w: 2 + (s % 2),
        })
        expect(signaturesMatch(saved, again).ok, `${name} variant ${s}`).toBe(true)
      }
    }
  })
  it('a clearly different signature is refused', () => {
    for (const [a, pa] of Object.entries(sigs))
      for (const [b, pb] of Object.entries(sigs)) {
        if (a === b) continue
        const r = signaturesMatch(draw(pa, { seed: 1 }), draw(pb, { seed: 9, jitter: 10 }))
        expect(r.ok, `${a} vs ${b}`).toBe(false)
      }
  })
  it('keeps a real gap between the two (so the pass mark is not luck)', () => {
    const same: number[] = []
    const diff: number[] = []
    for (const [a, pa] of Object.entries(sigs)) {
      same.push(
        signatureSimilarity(draw(pa, { seed: 1 }), draw(pa, { seed: 3, jitter: 14, s: 0.9 }))!,
      )
      for (const [b, pb] of Object.entries(sigs))
        if (a !== b) diff.push(signatureSimilarity(draw(pa, { seed: 1 }), draw(pb, { seed: 9 }))!)
    }
    expect(Math.min(...same)).toBeGreaterThan(SIGNATURE_MATCH_MIN + 0.1)
    expect(Math.max(...diff)).toBeLessThan(SIGNATURE_MATCH_MIN - 0.05)
  })
  it('a blank or unreadable picture is reported as unreadable, not as a mismatch', () => {
    const blank = new PNG({ width: 50, height: 50 })
    blank.data.fill(255)
    expect(signaturesMatch(draw(A), PNG.sync.write(blank))).toMatchObject({
      ok: false,
      reason: 'unreadable',
    })
    expect(signaturesMatch(draw(A), new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: false,
      reason: 'unreadable',
    })
  })
})
