#!/usr/bin/env node
// LOCAL job runner and checker. Calls the protected job endpoints of a locally running app (default http://127.0.0.1:3000)
// with JOBS_SECRET from the environment or .env.local. It is a stand-in for the scheduler the owner has not chosen yet:
// it proves the endpoints can be driven on a cadence, never overlap themselves, and that the health check notices trouble.
// It contacts nothing but the URL you give it; use it only against a local app.
//
//   node scripts/run-jobs.mjs once            run every job once, then print the health verdict (exit 1 on any failure/problem)
//   node scripts/run-jobs.mjs loop [seconds]  run on the proposed cadence until stopped (default tick 60 s)
//   node scripts/run-jobs.mjs check           only print the health verdict (exit 1 when unhealthy)
import { readFileSync } from 'node:fs'

const BASE = process.env.JOBS_BASE_URL ?? 'http://127.0.0.1:3000'
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE) && process.env.JOBS_ALLOW_REMOTE !== 'yes') {
  console.error(`refusing to call ${BASE}: this runner is for the LOCAL app (set JOBS_ALLOW_REMOTE=yes only with owner approval)`)
  process.exit(2)
}
function secret() {
  if (process.env.JOBS_SECRET) return process.env.JOBS_SECRET
  try {
    const m = readFileSync('.env.local', 'utf8').match(/^JOBS_SECRET=(.+)$/m)
    if (m) return m[1].trim()
  } catch {}
  console.error('JOBS_SECRET is not set')
  process.exit(2)
}
const auth = { authorization: `Bearer ${secret()}` }

// Proposed cadences (seconds). A proposal for the owner, not a decision.
const JOBS = [
  { name: 'process-notifications', every: 60 },
  { name: 'expire-orders', every: 300 },
  { name: 'purge-location', every: 3600 },
]
const inFlight = new Set()

async function run(name) {
  if (inFlight.has(name)) return { name, skipped: 'previous run still in progress' } // never overlap with itself
  inFlight.add(name)
  try {
    const res = await fetch(`${BASE}/api/jobs/${name}`, { method: 'POST', headers: auth, signal: AbortSignal.timeout(60_000) })
    const body = await res.json().catch(() => ({}))
    return { name, status: res.status, ok: res.ok, result: body }
  } catch (e) {
    return { name, ok: false, error: String(e?.message ?? e).slice(0, 120) }
  } finally {
    inFlight.delete(name)
  }
}
async function check() {
  const res = await fetch(`${BASE}/api/jobs/health`, { headers: auth, signal: AbortSignal.timeout(30_000) })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ...body }
}
const line = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }))

const mode = process.argv[2] ?? 'once'
if (mode === 'check') {
  const h = await check()
  line({ health: h })
  process.exit(h.ok ? 0 : 1)
} else if (mode === 'once') {
  let bad = false
  for (const j of JOBS) {
    const r = await run(j.name)
    line(r)
    if (!r.ok) bad = true
  }
  const h = await check()
  line({ health: h })
  process.exit(bad || !h.ok ? 1 : 0)
} else if (mode === 'loop') {
  const tick = Number(process.argv[3] ?? 60)
  const last = new Map()
  for (;;) {
    const now = Date.now()
    for (const j of JOBS) {
      if (now - (last.get(j.name) ?? 0) >= j.every * 1000) {
        last.set(j.name, now)
        run(j.name).then(line)
      }
    }
    await new Promise((r) => setTimeout(r, tick * 1000))
  }
} else {
  console.error('usage: run-jobs.mjs once | loop [seconds] | check')
  process.exit(2)
}
