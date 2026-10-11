import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { AAL2, pool, purge } from './helpers'
import {
  approve,
  callJson,
  outcome,
  paidOrder,
  requestRefund,
  staff,
  startFake,
} from './refund-helpers'

/**
 * Concurrency proofs for the refund invariants (Phase 10):
 *   (R1) cumulative active refunds never exceed what the ledger shows as received;
 *   (R2) one idempotency key creates one refund;
 *   (R3) a refund is approved once, executed once and recorded as paid once.
 * Layers for R1: the order-row lock (app_private.lock_order_row), the balance check inside the function, and the trigger
 * app_private.refunds_cap_guard (which takes its OWN order-row lock and re-checks the sum). Control-removal tests remove
 * them one at a time behind a barrier (app_private.test_seam) and finally remove them all to show the test notices.
 */
afterAll(async () => {
  await pool.end()
})

const KEY = 4242003
const created = { users: [] as string[], vendors: [] as string[], points: [] as string[] }
const saved: string[] = []

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

async function fixture(nFinance: number) {
  return tx(async (c) => {
    const o = await paidOrder(c)
    const fins: string[] = []
    for (let i = 0; i < nFinance; i++) fins.push(await staff(c, 'finance_admin'))
    created.users.push(o.owner, o.cust, ...fins)
    created.vendors.push(o.vendor)
    return { ...o, fins }
  })
}

const settle = <T>(p: Promise<T>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: Error) => ({ ok: false as const, error: e.message }),
  )
const total = async (order: string) =>
  Number(
    (
      await pool.query(
        `select coalesce(sum(amount_kobo),0) n from public.refunds where order_id=$1 and status in ('requested','under_review','approved','processing','succeeded','reconciliation_required')`,
        [order],
      )
    ).rows[0].n,
  )

// ---- mutation helpers ------------------------------------------------------------------------
const funcDef = async (sig: string) =>
  (await pool.query(`select pg_get_functiondef($1::regprocedure) d`, [sig])).rows[0].d as string
async function removeOrderLock() {
  saved.push(await funcDef('app_private.lock_order_row(uuid)'))
  await pool.query(
    `create or replace function app_private.lock_order_row(p_order uuid) returns void language sql security definer set search_path='' as $$ select 1 $$`,
  )
}
async function dropCapTrigger() {
  const def = (
    await pool.query(`select pg_get_triggerdef(oid) d from pg_trigger where tgname='refunds_cap'`)
  ).rows[0].d as string
  saved.push(def)
  await pool.query(`drop trigger refunds_cap on public.refunds`)
}
async function barrier() {
  saved.push(await funcDef('app_private.test_seam(text)'))
  await pool.query(
    `create or replace function app_private.test_seam(p_name text) returns void language plpgsql security definer set search_path='' as $$ begin if p_name = 'refund_after_balance_check' then perform pg_advisory_lock_shared(${KEY}); perform pg_advisory_unlock_shared(${KEY}); end if; end $$`,
  )
}
async function restoreAll() {
  while (saved.length) await pool.query(saved.pop()!)
}
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

const financeRequest = (fin: string, order: string, amount: number) =>
  settle(
    tx((c) =>
      callJson(c, AAL2(fin), `select public.refund_request($1,$2,'concurrent goodwill') r`, [
        order,
        amount,
      ]),
    ),
  )

describe('R1: cumulative refunds never exceed what was received', () => {
  it('with all controls: 8 simultaneous customer requests for the full amount -> exactly one succeeds', async () => {
    const f = await fixture(0)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => settle(tx((c) => requestRefund(c, f.cust, f.order, null)))),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await total(f.order)).toBe(f.received)
    expect(
      results
        .filter((r) => !r.ok)
        .every((r) => !r.ok && /nothing_to_refund|refund_exceeds_received/.test(r.error)),
    ).toBe(true)
  })

  it('with all controls: 6 finance users each asking for 40% -> exactly two fit', async () => {
    const f = await fixture(6)
    const each = Math.floor(f.received * 0.4)
    const results = await Promise.all(f.fins.map((fin) => financeRequest(fin, f.order, each)))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(await total(f.order)).toBe(each * 2)
    expect(await total(f.order)).toBeLessThanOrEqual(f.received)
  })

  it('CONTROL REMOVAL 1: without the order lock, the trigger (its own lock + re-check) still holds the cap', async () => {
    const f = await fixture(6)
    const each = Math.floor(f.received * 0.4)
    await removeOrderLock()
    await barrier()
    const results = await race(6, () => f.fins.map((fin) => financeRequest(fin, f.order, each)))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(await total(f.order)).toBeLessThanOrEqual(f.received)
  })

  it('CONTROL REMOVAL 2: without the order lock AND the trigger, the cap is BROKEN (so the test can detect it)', async () => {
    const f = await fixture(6)
    const each = Math.floor(f.received * 0.4)
    await removeOrderLock()
    await dropCapTrigger()
    await barrier()
    const results = await race(6, () => f.fins.map((fin) => financeRequest(fin, f.order, each)))
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(2)
    expect(await total(f.order)).toBeGreaterThan(f.received)
  })

  it('everything is restored after the mutations', async () => {
    await restoreAll()
    const f = await fixture(3)
    const each = Math.floor(f.received * 0.4)
    const results = await Promise.all(f.fins.map((fin) => financeRequest(fin, f.order, each)))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    const trig = await pool.query(`select 1 from pg_trigger where tgname='refunds_cap'`)
    expect(trig.rowCount).toBe(1)
  })
})

describe('R2/R3: idempotency, approval and execution happen once', () => {
  it('six parallel submissions with ONE key -> one refund, all callers get it', async () => {
    const f = await fixture(0)
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        settle(
          tx((c) =>
            requestRefund(c, f.cust, f.order, null, 'same click six times', 'one-key-for-all'),
          ),
        ),
      ),
    )
    expect(results.every((r) => r.ok)).toBe(true)
    const ids = new Set(results.map((r) => (r.ok ? r.v.id : '')))
    expect(ids.size).toBe(1)
    expect(
      (await pool.query(`select count(*)::int n from public.refunds where order_id=$1`, [f.order]))
        .rows[0].n,
    ).toBe(1)
  })

  it('simultaneous approvals -> exactly one wins; simultaneous execution starts -> exactly one; paid once', async () => {
    const f = await fixture(5)
    const r = await tx((c) => requestRefund(c, f.cust, f.order, null))
    const approvals = await Promise.all(
      f.fins.slice(0, 4).map((fin) => settle(tx((c) => approve(c, fin, r.id)))),
    )
    expect(approvals.filter((a) => a.ok)).toHaveLength(1)
    const starts = await Promise.all(
      f.fins.slice(0, 4).map((fin) => settle(tx((c) => startFake(c, fin, r.id)))),
    )
    expect(starts.filter((a) => a.ok)).toHaveLength(1)
    const reports = await Promise.all(
      f.fins
        .slice(0, 4)
        .map((fin) => settle(tx((c) => outcome(c, fin, r.id, 'succeeded', 'fake_re_conc')))),
    )
    expect(reports.every((x) => x.ok)).toBe(true) // replays are harmless
    expect(
      (
        await pool.query(
          `select count(*)::int n from public.ledger_entries where refund_id=$1 and entry_type='refund_paid'`,
          [r.id],
        )
      ).rows[0].n,
    ).toBe(1)
    expect(
      (await pool.query(`select status from public.refunds where id=$1`, [r.id])).rows[0].status,
    ).toBe('succeeded')
  })
})
