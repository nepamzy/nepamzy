import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUser, pool } from './helpers'

// Harness for parallel-connection atomicity tests. Uses a STUB capacity rule now; Batch 4 reuses
// the same pattern for the real "rider max five active deliveries" rule.
afterAll(async () => {
  await pool.end()
})

const SLOT = 990001
let userIds: string[] = []

beforeAll(async () => {
  const c = await pool.connect()
  try {
    await c.query('begin')
    userIds = []
    for (let i = 0; i < 12; i++) userIds.push(await createUser(c, 'conc'))
    await c.query('delete from public.stub_capacity_slots where id=$1', [SLOT])
    await c.query('insert into public.stub_capacity_slots (id, capacity) values ($1, 5)', [SLOT])
    await c.query('commit')
  } finally {
    c.release()
  }
})

afterAll(async () => {
  const c = await pool.connect()
  try {
    await c.query('delete from public.stub_capacity_slots where id=$1', [SLOT])
    await c.query('delete from auth.users where id = any($1::uuid[])', [userIds])
  } finally {
    c.release()
  }
})

async function claimAs(userId: string): Promise<boolean> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal2' }), userId],
    )
    await c.query('set local role authenticated')
    const r = await c.query('select public.stub_claim_slot($1) as ok', [SLOT])
    await c.query('commit')
    return r.rows[0].ok as boolean
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

describe('atomic capacity (stub)', () => {
  it('12 simultaneous claims on a capacity-5 slot succeed exactly 5 times', async () => {
    const results = await Promise.all(userIds.map((u) => claimAs(u)))
    expect(results.filter(Boolean)).toHaveLength(5)
    const used = await pool.query('select used from public.stub_capacity_slots where id=$1', [SLOT])
    expect(used.rows[0].used).toBe(5)
  })
  it('unknown slot raises', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(
        `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: userIds[0], role: 'authenticated', aal: 'aal2' }), userIds[0]],
      )
      await c.query('set local role authenticated')
      await expect(c.query('select public.stub_claim_slot($1)', [424242])).rejects.toThrow(
        /unknown slot/,
      )
    } finally {
      await c.query('rollback')
      c.release()
    }
  })
  it('anon cannot claim', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role anon')
      await expect(c.query('select public.stub_claim_slot($1)', [SLOT])).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await c.query('rollback')
      c.release()
    }
  })
})
