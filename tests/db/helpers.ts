import { Pool, type PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export const pool = new Pool({ connectionString: DATABASE_URL, max: 16 })

export type Aal = 'aal1' | 'aal2'
export type Principal = { id: string; aal: Aal } | null // null => anon

/** Run fn inside a transaction that is always rolled back (setup rows disappear). */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    return await fn(c)
  } finally {
    await c.query('rollback').catch(() => undefined)
    c.release()
  }
}

export async function createUser(c: PoolClient, label = 'u'): Promise<string> {
  const id = randomUUID()
  await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '',
       now(), '{}'::jsonb, '{}'::jsonb, now(), now())`,
    [id, `${label}-${id}@example.test`],
  )
  return id
}

export async function giveRole(c: PoolClient, userId: string, role: string) {
  await c.query(
    `insert into public.role_assignments (user_id, role) values ($1, $2::public.app_role)
     on conflict do nothing`,
    [userId, role],
  )
}

export async function removeCustomerRole(c: PoolClient, userId: string) {
  await c.query(
    `update public.role_assignments set status='revoked', revoked_at=now()
     where user_id=$1 and role='customer'`,
    [userId],
  )
}

/** Execute fn as the given principal (simulating a PostgREST request), then restore superuser. */
export async function as<T>(c: PoolClient, who: Principal, fn: () => Promise<T>): Promise<T> {
  if (who) {
    const claims = JSON.stringify({ sub: who.id, role: 'authenticated', aal: who.aal })
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [claims, who.id])
    await c.query('set local role authenticated')
  } else {
    await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true)`)
    await c.query('set local role anon')
  }
  try {
    return await fn()
  } finally {
    await c.query('reset role')
  }
}

/** Run a statement that must fail; return the Postgres error (code + message). */
export async function failure(c: PoolClient, sql: string, params: unknown[] = []) {
  await c.query('savepoint sp')
  try {
    await c.query(sql, params)
  } catch (e) {
    await c.query('rollback to savepoint sp')
    return e as { code?: string; message: string }
  }
  await c.query('release savepoint sp')
  throw new Error(`expected statement to fail but it succeeded: ${sql}`)
}

export const PRIV_DENIED = '42501'
