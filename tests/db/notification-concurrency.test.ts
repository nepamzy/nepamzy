import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { createUser, pool, purge, svc } from './helpers'

/**
 * Concurrency proofs for the notification outbox worker:
 *   (N1) two workers never receive the same item (row lock with SKIP LOCKED);
 *   (N2) completing the same item twice records one delivery (unique outbox id + state check).
 * The control-removal test widens the race window (a short sleep per candidate row) and removes the row lock to show
 * that the test really can see duplicates.
 */
afterAll(async () => {
  await pool.end()
})

const saved: string[] = []
const created = { users: [] as string[], vendors: [] as string[], points: [] as string[] }

async function seed(n: number) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(
      `update public.notification_outbox set status='dead', locked_at=null where status in ('pending','processing')`,
    )
    const u = await createUser(c, 'worker-user')
    await c.query(
      `insert into public.notification_preferences (user_id, email_enabled) values ($1, true)`,
      [u],
    )
    for (let i = 0; i < n; i++)
      await c.query(
        `select app_private.notify($1,'order','Order update','Open your order.','/orders/x',$2)`,
        [u, `conc-${i}`],
      )
    await c.query('commit')
    created.users.push(u)
    return u
  } finally {
    c.release()
  }
}

const claim = async (limit: number) => {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role service_role')
    const r = (await c.query(`select public.notification_outbox_claim($1) r`, [limit])).rows[0]
      .r as { id: string }[]
    await c.query('commit')
    return r.map((x) => x.id)
  } finally {
    c.release()
  }
}
const complete = async (id: string) => {
  const c: PoolClient = await pool.connect()
  try {
    await c.query('begin')
    await svc(c, () => c.query(`select public.notification_outbox_complete($1, true)`, [id]))
    await c.query('commit')
  } finally {
    c.release()
  }
}

const funcDef = async () =>
  (
    await pool.query(
      `select pg_get_functiondef('public.notification_outbox_claim(int)'::regprocedure) d`,
    )
  ).rows[0].d as string
async function mutate(f: (d: string) => string) {
  const def = await funcDef()
  saved.push(def)
  const m = f(def)
  if (m === def) throw new Error('mutation did not change the function')
  await pool.query(m)
}
afterEach(async () => {
  while (saved.length) await pool.query(saved.pop()!)
  if (created.users.length) {
    const c = await pool.connect()
    try {
      await purge(c, created)
    } finally {
      c.release()
    }
    created.users.length = 0
  }
})

const SLEEP = (d: string) =>
  d.replace(
    'order by next_attempt_at, created_at limit v_limit',
    'and pg_sleep(0.05) is not null order by next_attempt_at, created_at limit v_limit',
  )
const NO_LOCK = (d: string) => d.replace('for update skip locked', '')

describe('outbox workers never share an item', () => {
  it('8 workers racing for 40 items receive disjoint sets that add up to exactly 40; duplicate completions record one delivery', async () => {
    await seed(40)
    const sets = await Promise.all(Array.from({ length: 8 }, () => claim(10)))
    const all = sets.flat()
    expect(all).toHaveLength(40)
    expect(new Set(all).size).toBe(40)
    await Promise.all(all.slice(0, 5).flatMap((id) => [complete(id), complete(id), complete(id)]))
    const d = await pool.query(
      `select outbox_id, count(*)::int n from public.notification_deliveries where outbox_id = any($1::uuid[]) group by 1`,
      [all.slice(0, 5)],
    )
    expect(d.rows).toHaveLength(5)
    expect(d.rows.every((r) => r.n === 1)).toBe(true)
  })

  it('CONTROL REMOVAL 1: with a widened race window the row lock still keeps the sets disjoint', async () => {
    await seed(6)
    await mutate(SLEEP)
    const sets = await Promise.all(Array.from({ length: 6 }, () => claim(6)))
    const all = sets.flat()
    expect(all).toHaveLength(6)
    expect(new Set(all).size).toBe(6)
  })

  it('CONTROL REMOVAL 2: with the row lock REMOVED (and the window widened) workers DO receive the same item', async () => {
    await mutate((d) => NO_LOCK(SLEEP(d)))
    // A race is probabilistic: a loaded CI runner can serialise the six workers by chance. The claim being tested is that the
    // duplication CAN happen without the lock, so allow a few fresh attempts; the assertion itself is unchanged.
    let duplicated = false
    for (let attempt = 0; attempt < 5 && !duplicated; attempt++) {
      await seed(6)
      const sets = await Promise.all(Array.from({ length: 6 }, () => claim(6)))
      const all = sets.flat()
      duplicated = all.length > new Set(all).size
    }
    expect(duplicated).toBe(true)
  })

  it('everything is restored after the mutations', async () => {
    await seed(10)
    const sets = await Promise.all(Array.from({ length: 4 }, () => claim(10)))
    const all = sets.flat()
    expect(all).toHaveLength(10)
    expect(new Set(all).size).toBe(10)
  })
})
