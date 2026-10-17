import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import { freshCode, PASSWORD } from './helpers'

/** A supabase-js client for a user who has completed TOTP (aal2): what a hand-written API caller would hold. */
export async function aal2ClientWithSecret(email: string, secret: string): Promise<SupabaseClient> {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const si = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (si.error) throw si.error
  const factors = await c.auth.mfa.listFactors()
  const f = factors.data?.totp?.[0]
  if (!f) throw new Error('no factor')
  const ch = await c.auth.mfa.challenge({ factorId: f.id })
  if (ch.error) throw ch.error
  const v = await c.auth.mfa.verify({
    factorId: f.id,
    challengeId: ch.data.id,
    code: await freshCode(secret),
  })
  if (v.error) throw v.error
  return c
}

/** A signed-in client at aal1 only (password, no second factor). */
export async function aal1Client(email: string): Promise<SupabaseClient> {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const si = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (si.error) throw si.error
  return c
}

export const anonClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** Owner-level SQL for test setup and for reading ground truth (never used to make an assertion pass by itself). */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  try {
    return (await pool.query(text, params)).rows as T[]
  } finally {
    await pool.end()
  }
}
