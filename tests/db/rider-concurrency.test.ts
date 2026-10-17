import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { pool, purge } from './helpers'
import { accept, deliveryOrder, mkRider, mkShop } from './rider-helpers'

/**
 * Concurrency proofs for the two rider invariants:
 *   (I1) a rider never has more than FIVE active deliveries;
 *   (I2) an order never has more than ONE active assignment.
 *
 * Layers (see docs/database.md):
 *   I1: rider-row lock (app_private.lock_rider)  +  unique (rider_id, slot) index  [slots 1..5]
 *   I2: order-row lock (app_private.lock_order_row) + unique active-per-order index + conditional update in step_order
 * Control-removal tests REMOVE layers and use a barrier (app_private.test_seam) so every racing session has passed its
 * check before any writes. They show (a) which layer is the backstop and (b) that the test notices when ALL layers are gone.
 */
afterAll(async () => {
  await pool.end()
})

const KEY = 4242001
const created = { users: [] as string[], vendors: [] as string[], points: [] as string[] }
const saved: string[] = [] // DDL that restores whatever a test removed

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

async function fixtures(nOrders: number, nRiders = 1) {
  return tx(async (c) => {
    const shop = await mkShop(c)
    const riders = []
    for (let i = 0; i < nRiders; i++) riders.push(await mkRider(c))
    const orders: string[] = []
    const owner = shop.owner
    for (let i = 0; i < nOrders; i++) {
      const o = await deliveryOrder(c, { shop })
      orders.push(o.order)
      created.users.push(o.cust)
    }
    created.users.push(owner, ...riders.map((r) => r.id))
    created.vendors.push(shop.vendor)
    created.points.push(shop.point)
    return { riders: riders.map((r) => r.id), orders }
  })
}

const attempt = (rider: string, order: string) =>
  tx((c) => accept(c, rider, order)).then(
    () => ({ ok: true as const }),
    (e: Error) => ({ ok: false as const, error: e.message }),
  )

const activeFor = async (rider: string) =>
  Number(
    (
      await pool.query(
        `select count(*)::int n from public.delivery_assignments where rider_id=$1 and status in ('accepted','picked_up','en_route')`,
        [rider],
      )
    ).rows[0].n,
  )
const activeForOrder = async (order: string) =>
  Number(
    (
      await pool.query(
        `select count(*)::int n from public.delivery_assignments where order_id=$1 and status in ('accepted','picked_up','en_route')`,
        [order],
      )
    ).rows[0].n,
  )

// ---- mutation helpers ---------------------------------------------------------------------
async function funcDef(sig: string) {
  return (await pool.query(`select pg_get_functiondef($1::regprocedure) d`, [sig])).rows[0]
    .d as string
}
async function indexDef(name: string) {
  return (await pool.query(`select indexdef from pg_indexes where indexname=$1`, [name])).rows[0]
    ?.indexdef as string | undefined
}
async function removeRiderLock() {
  saved.push(await funcDef('app_private.lock_rider(uuid)'))
  await pool.query(
    `create or replace function app_private.lock_rider(p_rider uuid) returns void language sql security definer set search_path='' as $$ select 1 $$`,
  )
}
async function removeOrderLock() {
  saved.push(await funcDef('app_private.lock_order_row(uuid)'))
  await pool.query(
    `create or replace function app_private.lock_order_row(p_order uuid) returns void language sql security definer set search_path='' as $$ select 1 $$`,
  )
}
async function dropIndex(name: string) {
  const d = await indexDef(name)
  if (!d) throw new Error(`index ${name} missing`)
  saved.push(d)
  await pool.query(`drop index public.${name}`)
}
async function neuterStepOrder() {
  saved.push(await funcDef('app_private.step_order(uuid,text,text,uuid,text)'))
  await pool.query(
    `create or replace function app_private.step_order(p_order uuid, p_from text, p_to text, p_actor uuid, p_reason text) returns void language plpgsql security definer set search_path='' as $$ begin update public.orders set status = p_to where id = p_order; insert into public.order_status_history (order_id, from_status, to_status, actor_id, reason) values (p_order, p_from, p_to, p_actor, p_reason); end $$`,
  )
}
async function barrierAt(name: string) {
  saved.push(await funcDef('app_private.test_seam(text)'))
  await pool.query(
    `create or replace function app_private.test_seam(p_name text) returns void language plpgsql security definer set search_path='' as $$ begin if p_name = '${name}' then perform pg_advisory_lock_shared(${KEY}); perform pg_advisory_unlock_shared(${KEY}); end if; end $$`,
  )
}
async function restoreAll() {
  while (saved.length) await pool.query(saved.pop()!)
}
afterEach(restoreAll)

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
  // keep the database tidy even when a test fails half-way
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

describe('I1: at most five active deliveries per rider', () => {
  it('with all controls: 8 simultaneous accepts of 8 different orders -> exactly 5 succeed, distinct slots 1..5', async () => {
    const f = await fixtures(8)
    const results = await Promise.all(f.orders.map((o) => attempt(f.riders[0]!, o)))
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    expect(
      results.filter((r) => !r.ok).every((r) => !r.ok && /capacity_reached/.test(r.error)),
    ).toBe(true)
    expect(await activeFor(f.riders[0]!)).toBe(5)
    const slots = (
      await pool.query(
        `select slot from public.delivery_assignments where rider_id=$1 order by slot`,
        [f.riders[0]],
      )
    ).rows.map((r) => r.slot)
    expect(slots).toEqual([1, 2, 3, 4, 5])
    const unassigned = (
      await pool.query(
        `select count(*)::int n from public.orders where id = any($1::uuid[]) and status='AWAITING_RIDER'`,
        [f.orders],
      )
    ).rows[0].n
    expect(unassigned).toBe(3) // the refused orders stayed on offer: nothing half-applied
  })

  it('CONTROL REMOVAL 1: without the rider-row lock, the slot index alone still holds the limit', async () => {
    const f = await fixtures(8)
    await removeRiderLock()
    await barrierAt('after_capacity_check')
    const results = await race(8, () => f.orders.map((o) => attempt(f.riders[0]!, o)))
    expect(await activeFor(f.riders[0]!)).toBeLessThanOrEqual(5)
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1)
    expect(results.filter((r) => !r.ok).length).toBeGreaterThanOrEqual(3)
  })

  it('CONTROL REMOVAL 2: without the lock AND without the slot index, the invariant BREAKS (so the test can detect it)', async () => {
    const f = await fixtures(8)
    await removeRiderLock()
    await dropIndex('delivery_assignments_rider_slot_uq')
    await barrierAt('after_capacity_check')
    await race(8, () => f.orders.map((o) => attempt(f.riders[0]!, o)))
    expect(await activeFor(f.riders[0]!)).toBeGreaterThan(5)
  })
})

describe('I2: at most one active assignment per order', () => {
  it('with all controls: 6 riders racing for one order -> exactly one wins', async () => {
    const f = await fixtures(1, 6)
    const results = await Promise.all(f.riders.map((r) => attempt(r, f.orders[0]!)))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(
      results.filter((r) => !r.ok).every((r) => !r.ok && /order_unavailable/.test(r.error)),
    ).toBe(true)
    expect(await activeForOrder(f.orders[0]!)).toBe(1)
    const hist = (
      await pool.query(
        `select to_status from public.order_status_history where order_id=$1 and to_status='RIDER_ASSIGNED'`,
        [f.orders[0]],
      )
    ).rowCount
    expect(hist).toBe(1)
  })

  it('the SAME rider repeating the request in parallel is idempotent: one assignment, no errors', async () => {
    const f = await fixtures(1)
    const results = await Promise.all(
      Array.from({ length: 5 }, () => attempt(f.riders[0]!, f.orders[0]!)),
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(await activeForOrder(f.orders[0]!)).toBe(1)
  })

  it('CONTROL REMOVAL 3: without the order-row lock, the unique index still holds', async () => {
    const f = await fixtures(1, 6)
    await removeOrderLock()
    await barrierAt('after_order_check')
    const results = await race(6, () => f.riders.map((r) => attempt(r, f.orders[0]!)))
    expect(await activeForOrder(f.orders[0]!)).toBe(1)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('CONTROL REMOVAL 4: without the lock AND the index, the conditional status update in step_order is the last backstop', async () => {
    const f = await fixtures(1, 6)
    await removeOrderLock()
    await dropIndex('delivery_assignments_one_active_per_order')
    await barrierAt('after_order_check')
    const results = await race(6, () => f.riders.map((r) => attempt(r, f.orders[0]!)))
    expect(await activeForOrder(f.orders[0]!)).toBe(1)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('CONTROL REMOVAL 5: with ALL three layers removed, two riders DO get the same order (so the test can detect it)', async () => {
    const f = await fixtures(1, 6)
    await removeOrderLock()
    await dropIndex('delivery_assignments_one_active_per_order')
    await neuterStepOrder()
    await barrierAt('after_order_check')
    await race(6, () => f.riders.map((r) => attempt(r, f.orders[0]!)))
    expect(await activeForOrder(f.orders[0]!)).toBeGreaterThan(1)
  })

  it('everything is restored after the mutations: the controls work again', async () => {
    await restoreAll()
    const f = await fixtures(3, 3)
    const results = await Promise.all(f.riders.map((r) => attempt(r, f.orders[0]!)))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await indexDef('delivery_assignments_rider_slot_uq')).toBeTruthy()
    expect(await indexDef('delivery_assignments_one_active_per_order')).toBeTruthy()
  })
})
