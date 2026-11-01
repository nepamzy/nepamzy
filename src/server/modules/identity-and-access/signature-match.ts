import { PNG } from 'pngjs'

/**
 * Compares two drawn signatures by SHAPE. It is deliberately forgiving: the same person never signs exactly the same
 * way twice, on a different phone, at a different size or speed. It only has to tell "clearly a different signature"
 * from "plausibly the same one"; it is not forensic verification and never proves who someone is.
 *
 * Both pictures are cropped to their ink, scaled to a small fixed grid (so size and position do not matter), and
 * compared by how much of each one's ink lies near the other's.
 */
const GW = 64
const GH = 32
/** Share of each signature's ink that must lie near the other's. Chosen from the spread in signature-match.test.ts. */
/** How many grid cells (of 64 x 32) still count as "near": small, so a different shape does not pass by overlapping. */
const NEAR = 1
export const SIGNATURE_MATCH_MIN = 0.6

type Grid = Uint8Array

function inkGrid(png: Uint8Array): Grid | null {
  let img: PNG
  try {
    img = PNG.sync.read(Buffer.from(png))
  } catch {
    return null
  }
  const { width: w, height: h, data } = img
  const ink = new Uint8Array(w * h)
  let minX = w
  let maxX = -1
  let minY = h
  let maxY = -1
  let count = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum = (data[i]! + data[i + 1]! + data[i + 2]!) / 3
      if (data[i + 3]! > 100 && lum < 140) {
        ink[y * w + x] = 1
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  if (count < 40 || maxX < minX || maxY < minY) return null
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  // fit the ink box into the grid, keeping its proportions, centred
  const scale = Math.min(GW / bw, GH / bh)
  const tw = Math.max(1, Math.round(bw * scale))
  const th = Math.max(1, Math.round(bh * scale))
  const ox = Math.floor((GW - tw) / 2)
  const oy = Math.floor((GH - th) / 2)
  const grid = new Uint8Array(GW * GH)
  for (let gy = 0; gy < th; gy++)
    for (let gx = 0; gx < tw; gx++) {
      // source rectangle of this cell; any ink inside it counts
      const x0 = minX + Math.floor((gx * bw) / tw)
      const x1 = minX + Math.max(Math.floor(((gx + 1) * bw) / tw), Math.floor((gx * bw) / tw) + 1)
      const y0 = minY + Math.floor((gy * bh) / th)
      const y1 = minY + Math.max(Math.floor(((gy + 1) * bh) / th), Math.floor((gy * bh) / th) + 1)
      let hit = 0
      for (let y = y0; y < y1 && !hit; y++)
        for (let x = x0; x < x1; x++)
          if (ink[y * w + x]) {
            hit = 1
            break
          }
      if (hit) grid[(oy + gy) * GW + ox + gx] = 1
    }
  return grid
}

const dilate = (g: Grid, r: number): Grid => {
  const out = new Uint8Array(g.length)
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      if (!g[y * GW + x]) continue
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < GW && ny >= 0 && ny < GH) out[ny * GW + nx] = 1
        }
    }
  return out
}

const coverage = (a: Grid, nearB: Grid) => {
  let total = 0
  let hit = 0
  for (let i = 0; i < a.length; i++)
    if (a[i]) {
      total++
      if (nearB[i]) hit++
    }
  return total === 0 ? 0 : hit / total
}

/** 0..1: how alike the two signatures are in shape. Null when either picture has too little ink to compare. */
export function signatureSimilarity(a: Uint8Array, b: Uint8Array): number | null {
  const ga = inkGrid(a)
  const gb = inkGrid(b)
  if (!ga || !gb) return null
  const da = dilate(ga, NEAR)
  const db = dilate(gb, NEAR)
  return (coverage(ga, db) + coverage(gb, da)) / 2
}

export type MatchResult =
  { ok: true; score: number } | { ok: false; reason: 'different' | 'unreadable'; score?: number }

/** Decides whether a new signature is plausibly the one that was saved when the account was made. */
export function signaturesMatch(saved: Uint8Array, now: Uint8Array): MatchResult {
  const s = signatureSimilarity(saved, now)
  if (s === null) return { ok: false, reason: 'unreadable' }
  return s >= SIGNATURE_MATCH_MIN
    ? { ok: true, score: s }
    : { ok: false, reason: 'different', score: s }
}
