import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Scheduler entry point (`Authorization: Bearer $JOBS_SECRET`). Deletes expired GPS history. Safe to repeat. Scheduling is a deployment step. */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET ?? ''
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await createSupabaseServiceClient().rpc('purge_location_data')
  if (error) {
    logger.error('purge_location_data failed', { code: error.code })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...(data as object) })
}
