import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AAL2, PNG, pool, purge } from './helpers'
import { completeDelivery, journeyToArrival, mkShop, proofBegin } from './rider-helpers'

/**
 * Concurrency proofs for delivery completion (Phase 9): however many times and however simultaneously the recipient's
 * request is replayed, exactly ONE completion is written.
 *
 * Layers (see docs/database.md):
 *   L1 order-row lock (app_private.lock_order_row)           - serialises the requests; later ones see COMPLETED
 *   L2 assignment-row lock + status re-check                  - the assignment is no longer active after the first commit
 *   L3 proof-session row lock + `used_at is null` re-check    - the one-time token is consumed once
 *   L4 handover_evidence primary key (order_id)               - a second evidence row cannot exist
 *   L5 conditional status update in app_private.step_order    - the order can leave AWAITING_RECIPIENT_PROOF once
 * Control-removal tests REMOVE layers one at a time, holding every racer at a barrier (app_private.test_seam) so all of
 * them have passed their checks before any writes, and finish by removing ALL layers to show the test notices.
 */
afterAll(async () => {
  await pool.end()
})

const KEY = 4242002
const created = { users: [] as string[], vendors: [] as string[], points: [] as string[] }
const saved: (string | (() => Promise<void>))[] = []

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback').catch(() => undefined)
    throw e
  } finally {
    c.release()
  }
}

async function fixture() {
  return tx(async (c) => {
    const shop = await mkShop(c)
    const x = await journeyToArrival(c, { shop })
    const { token } = await proofBegin(c, AAL2(x.cust), x.order)
    created.users.push(shop.owner, x.cust, x.r.id)
    created.vendors.push(shop.vendor)
    created.points.push(shop.point)
    return { order: x.order, cust: x.cust, token }
  })
}

const attempt = (f: { order: string; cust: string; token: string }) =>
  tx((c) => completeDelivery(c, AAL2(f.cust), f.order, f.token, PNG())).then(
    (r) => ({ kind: r.ok ? ('ok' as const) : ('refused' as const), reason: r.reason }),
    (e: Error) => ({ kind: 'error' as const, reason: e.message }),
  )

const counts = async (order: string) => ({
  evidence: Number(
    (
      await pool.query(`select count(*)::int n from public.handover_evidence where order_id=$1`, [
        order,
      ])
    ).rows[0].n,
  ),
  completed: Number(
    (
      await pool.query(
        `select count(*)::int n from public.order_status_history where order_id=$1 and to_status='COMPLETED'`,
        [order],
      )
    ).rows[0].n,
  ),
})

// ---- mutation helpers ---------------------------------------------------------------------
const funcDef = async (sig: string) =>
  (await pool.query(`select pg_get_functiondef($1::regprocedure) d`, [sig])).rows[0].d as string
async function removeOrderLock() {
  saved.push(await funcDef('app_private.lock_order_row(uuid)'))
  await pool.query(
    `create or replace function app_private.lock_order_row(p_order uuid) returns void language sql security definer set search_path='' as $$ select 1 $$`,
  )
}
async function mutateComplete(replacements: [string, string][]) {
  const def = await funcDef('public.complete_delivery(uuid,text,text,bytea,text)')
  saved.push(def)
  let m = def
  for (const [from, to] of replacements) {
    if (!m.includes(from)) throw new Error(`mutation target not found: ${from}`)
    m = m.replace(from, to)
  }
  await pool.query(m)
}
const NO_ASSIGNMENT_LOCK: [string, string] = [
  "where order_id = p_order and status in ('accepted', 'picked_up', 'en_route') for update;",
  "where order_id = p_order and status in ('accepted', 'picked_up', 'en_route');",
]
const NO_SESSION_LOCK: [string, string] = [
  'used_at is null and invalidated_at is null for update;',
  'used_at is null and invalidated_at is null;',
]
async function dropEvidencePk() {
  // restore: first remove any duplicate rows the mutation let through (bypassing the append-only trigger), then re-add the key
  saved.push(async () => {
    const c = await pool.connect()
    try {
      await c.query(`set session_replication_role = replica`)
      await c.query(
        `delete from public.handover_evidence a using public.handover_evidence b where a.ctid > b.ctid and a.order_id = b.order_id`,
      )
      await c.query(`set session_replication_role = origin`)
      await c.query(`alter table public.handover_evidence add primary key (order_id)`)
    } finally {
      c.release()
    }
  })
  await pool.query(`alter table public.handover_evidence drop constraint handover_evidence_pkey`)
}
async function neuterStepOrder() {
  saved.push(await funcDef('app_private.step_order(uuid,text,text,uuid,text)'))
  await pool.query(
    `create or replace function app_private.step_order(p_order uuid, p_from text, p_to text, p_actor uuid, p_reason text) returns void language plpgsql security definer set search_path='' as $$ begin update public.orders set status = p_to where id = p_order; insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason) values (p_order, p_from, p_to, p_actor, p_reason); end $$`,
  )
}
async function barrier() {
  saved.push(await funcDef('app_private.test_seam(text)'))
  await pool.query(
    `create or replace function app_private.test_seam(p_name text) returns void language plpgsql security definer set search_path='' as $$ begin if p_name = 'after_proof_checks' then perform pg_advisory_lock_shared(${KEY}); perform pg_advisory_unlock_shared(${KEY}); end if; end $$`,
  )
}
async function restoreAll() {
  while (saved.length) {
    const r = saved.pop()!
    if (typeof r === 'string') await pool.query(r)
    else await r()
  }
}

/** Hold every racer at the barrier until all are waiting, then release them together. */
async function race<T>(n: number, run: () => Promise<T>[]) {
  const holder = await pool.connect()
  try {
    await holder.query(`select pg_advisory_lock(${KEY})`)
    const promises = run()
    for (let i = 0; i < 200; i++) {
      const w = await pool.query(
        `select count(*)::int n from pg_locks where locktype='advisory' and not granted and objid=${KEY}`,
      )
      if (w.rows[0].n >= n) break
      await new Promise((r) => setTimeout(r, 25))
    }
    await holder.query(`select pg_advisory_unlock(${KEY})`)
    return await Promise.all(promises)
  } finally {
    holder.release()
  }
}

afterEach(async () => {
  await restoreAll()
  if (created.users.length) {
    const c = await pool.connect()
    try {
      await purge(c, created)
    } finally {
      c.release()
    }
    created.users.length = created.vendors.length = created.points.length = 0
  }
})

const N = 8
const oks = (r: { kind: string }[]) => r.filter((x) => x.kind === 'ok').length

describe('delivery completion: exactly one completion under concurrent replays', () => {
  it('with all controls: 8 simultaneous identical requests -> exactly one succeeds, the others see already_completed', async () => {
    const f = await fixture()
    const results = await Promise.all(Array.from({ length: N }, () => attempt(f)))
    expect(oks(results)).toBe(1)
    expect(
      results
        .filter((r) => r.kind !== 'ok')
        .every((r) => r.kind === 'refused' && r.reason === 'already_completed'),
    ).toBe(true)
    expect(await counts(f.order)).toEqual({ evidence: 1, completed: 1 })
    const a = (
      await pool.query(
        `select count(*)::int n from public.delivery_assignments where order_id=$1 and status='completed'`,
        [f.order],
      )
    ).rows[0].n
    expect(a).toBe(1)
  })

  it('CONTROL REMOVAL 1: without the order-row lock, the assignment lock still holds', async () => {
    const f = await fixture()
    await removeOrderLock()
    await barrier()
    const results = await race(N, () => Array.from({ length: N }, () => attempt(f)))
    expect(oks(results)).toBe(1)
    expect(await counts(f.order)).toEqual({ evidence: 1, completed: 1 })
  })

  it('CONTROL REMOVAL 2: without the order lock AND the assignment lock, the proof-session lock still holds', async () => {
    const f = await fixture()
    await removeOrderLock()
    await mutateComplete([NO_ASSIGNMENT_LOCK])
    await barrier()
    const results = await race(N, () => Array.from({ length: N }, () => attempt(f)))
    expect(oks(results)).toBe(1)
    expect(await counts(f.order)).toEqual({ evidence: 1, completed: 1 })
  })

  it('CONTROL REMOVAL 3: without all three locks, the evidence primary key and step_order still hold', async () => {
    const f = await fixture()
    await removeOrderLock()
    await mutateComplete([NO_ASSIGNMENT_LOCK, NO_SESSION_LOCK])
    await barrier()
    const results = await race(N, () => Array.from({ length: N }, () => attempt(f)))
    expect(oks(results)).toBe(1)
    expect(await counts(f.order)).toEqual({ evidence: 1, completed: 1 })
  })

  it('CONTROL REMOVAL 4: without the locks AND the primary key, the conditional update in step_order is the last backstop', async () => {
    const f = await fixture()
    await removeOrderLock()
    await mutateComplete([NO_ASSIGNMENT_LOCK, NO_SESSION_LOCK])
    await dropEvidencePk()
    await barrier()
    const results = await race(N, () => Array.from({ length: N }, () => attempt(f)))
    expect(oks(results)).toBe(1)
    expect(await counts(f.order)).toEqual({ evidence: 1, completed: 1 }) // the losers' evidence rolled back
  })

  it('CONTROL REMOVAL 5: with EVERY layer removed, duplicate completions DO happen (so the test can detect it)', async () => {
    const f = await fixture()
    await removeOrderLock()
    await mutateComplete([NO_ASSIGNMENT_LOCK, NO_SESSION_LOCK])
    await dropEvidencePk()
    await neuterStepOrder()
    await barrier()
    const results = await race(N, () => Array.from({ length: N }, () => attempt(f)))
    expect(oks(results)).toBeGreaterThan(1)
    expect((await counts(f.order)).evidence).toBeGreaterThan(1)
  })

  it('everything is restored after the mutations: a fresh order completes exactly once again', async () => {
    await restoreAll()
    const f = await fixture()
    const results = await Promise.all(Array.from({ length: 4 }, () => attempt(f)))
    expect(oks(results)).toBe(1)
    expect(await counts(f.order)).toEqual({ evidence: 1, completed: 1 })
    const pk = await pool.query(
      `select 1 from pg_constraint where conname='handover_evidence_pkey'`,
    )
    expect(pk.rowCount).toBe(1)
  })
})

describe('starting the confirmation in parallel (double taps)', () => {
  it('leaves exactly one live session; only the newest token works', async () => {
    const f = await tx(async (c) => {
      const shop = await mkShop(c)
      const x = await journeyToArrival(c, { shop })
      created.users.push(shop.owner, x.cust, x.r.id)
      created.vendors.push(shop.vendor)
      created.points.push(shop.point)
      return { order: x.order, cust: x.cust }
    })
    const begins = await Promise.all(
      Array.from({ length: 6 }, () =>
        tx((c) => proofBegin(c, AAL2(f.cust), f.order)).then(
          (r) => r.token,
          () => null,
        ),
      ),
    )
    const tokens = begins.filter((t): t is string => t !== null)
    expect(tokens.length).toBeGreaterThanOrEqual(1)
    const live = (
      await pool.query(
        `select count(*)::int n from public.delivery_proof_sessions where order_id=$1 and used_at is null and invalidated_at is null`,
        [f.order],
      )
    ).rows[0].n
    expect(live).toBe(1)
    const liveHash = (
      await pool.query(
        `select token_hash from public.delivery_proof_sessions where order_id=$1 and used_at is null and invalidated_at is null`,
        [f.order],
      )
    ).rows[0].token_hash as string
    const sha = (t: string) => createHash('sha256').update(t).digest('hex')
    const newest = tokens.find((t) => sha(t) === liveHash)
    const stale = tokens.find((t) => sha(t) !== liveHash)
    expect(newest).toBeDefined() // exactly one of the issued tokens is the live one
    if (stale) {
      const r = await tx((c) => completeDelivery(c, AAL2(f.cust), f.order, stale, PNG()))
      expect(r).toMatchObject({ ok: false, reason: 'wrong_proof' })
    }
    expect(await tx((c) => completeDelivery(c, AAL2(f.cust), f.order, newest!, PNG()))).toEqual({
      ok: true,
    })
    expect((await counts(f.order)).evidence).toBe(1)
  })
})
