import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { AAL2, as, createUser, failure, pool, purge, svc, PRIV_DENIED } from './helpers'

/**
 * E-mail / pop-up delivery layer: the tables are closed to every browser-facing role, and dispatch_claim hands each
 * notification to exactly one worker, retries only abandoned work, and stops after three attempts.
 */
afterAll(async () => {
  await pool.end()
})
const created = { users: [] as string[], vendors: [] as string[], points: [] as string[] }
afterEach(async () => {
  if (!created.users.length) return
  const c = await pool.connect()
  try {
    await purge(c, created)
  } finally {
    c.release()
  }
  created.users.length = 0
})

async function seed(n: number) {
  // park everything that already exists so only this test's notifications are in play
  await pool.query(
    `insert into public.notification_dispatch (notification_id, email_status, push_status, done_at)
       select id, 'skipped', 'skipped', now() from public.notifications n
        where not exists (select 1 from public.notification_dispatch d where d.notification_id = n.id)`,
  )
  const c = await pool.connect()
  try {
    await c.query('begin')
    const u = await createUser(c, 'dispatch-user')
    for (let i = 0; i < n; i++)
      await c.query(
        `select app_private.notify($1,'order','Order update','Open your order.','/orders/x',$2)`,
        [u, `disp-${i}-${Math.random()}`],
      )
    await c.query('commit')
    created.users.push(u)
    return u
  } finally {
    c.release()
  }
}
async function onlyOwnedBy<T extends { id: string }>(user: string, rows: T[]) {
  const mine = (
    await pool.query(`select id from public.notifications where user_id = $1`, [user])
  ).rows.map((r) => r.id as string)
  return rows.filter((x) => mine.includes(x.id))
}
const claim = async (limit = 50, only?: string) => {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role service_role')
    const r = (await c.query(`select public.dispatch_claim($1) r`, [limit])).rows[0].r as {
      id: string
      attempts: number
      email_status: string
    }[]
    await c.query('commit')
    return only ? await onlyOwnedBy(only, r) : r
  } finally {
    c.release()
  }
}

describe('delivery tables and claim function are closed to browsers', () => {
  it('anon and signed-in users cannot read, write or call anything', async () => {
    const u = await seed(1)
    const c = await pool.connect()
    try {
      await c.query('begin')
      for (const sql of [
        'select * from public.push_subscriptions',
        'select * from public.notification_dispatch',
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${u}', 'https://fcm.googleapis.com/x/yyyyyyyy', 'p'||repeat('x',30), repeat('a',12))`,
        'select public.dispatch_claim(5)',
      ]) {
        expect((await as(c, AAL2(u), () => failure(c, sql))).code).toBe(PRIV_DENIED)
        expect((await as(c, null, () => failure(c, sql))).code).toBe(PRIV_DENIED)
      }
    } finally {
      await c.query('rollback').catch(() => undefined)
      c.release()
    }
  })
})

describe('dispatch_claim', () => {
  it('8 workers racing for 25 notifications receive each exactly once', async () => {
    const u = await seed(25)
    const mine = (
      await pool.query(`select id from public.notifications where user_id = $1`, [u])
    ).rows.map((r) => r.id as string)
    const sets = await Promise.all(Array.from({ length: 8 }, () => claim(50)))
    const got = sets.flat().map((x) => x.id)
    expect(got.filter((id) => mine.includes(id)).sort()).toEqual([...mine].sort())
    expect(new Set(got).size).toBe(got.length)
    expect(await claim()).toEqual([])
  })

  it('retries abandoned work at most three times and never re-hands finished work', async () => {
    const u = await seed(2)
    const first = await claim(50, u)
    expect(first).toHaveLength(2)
    const [a, b] = first.map((x) => x.id) as [string, string]
    await pool.query(
      `update public.notification_dispatch set email_status='sent', push_status='skipped', done_at=now() where notification_id=$1`,
      [a],
    )
    for (const expected of [2, 3]) {
      await pool.query(
        `update public.notification_dispatch set claimed_at = now() - interval '11 minutes' where notification_id = $1`,
        [b],
      )
      const again = await claim(50, u)
      expect(again.map((x) => x.id)).toEqual([b])
      expect(again[0]?.attempts).toBe(expected)
    }
    await pool.query(
      `update public.notification_dispatch set claimed_at = now() - interval '11 minutes' where notification_id = $1`,
      [b],
    )
    expect(await claim(50, u)).toEqual([])
    expect(u).toBeTruthy()
  })

  it('a partly delivered notification comes back with the finished channel marked, so it is not sent twice', async () => {
    const u = await seed(1)
    const [n] = await claim(50, u)
    await pool.query(
      `update public.notification_dispatch set email_status='sent', claimed_at = now() - interval '11 minutes' where notification_id = $1`,
      [n!.id],
    )
    const [again] = await claim(50, u)
    expect(again?.email_status).toBe('sent')
  })

  it('service role can use the push table; endpoints must be https and unique', async () => {
    const u = await seed(0)
    const c = await pool.connect()
    try {
      const ins = (ep: string) =>
        svc(c, () =>
          c.query(
            `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)`,
            [u, ep, 'p'.repeat(30), 'a'.repeat(12)],
          ),
        )
      const ep = `https://fcm.googleapis.com/fcm/send/unique-${Math.random().toString(36).slice(2)}`
      await ins(ep)
      await expect(ins(ep)).rejects.toThrow()
      await expect(ins('http://fcm.googleapis.com/fcm/send/not-secure')).rejects.toThrow()
    } finally {
      c.release()
    }
  })
})
