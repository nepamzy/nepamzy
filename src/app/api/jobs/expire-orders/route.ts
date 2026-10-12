import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Called by a scheduler (cron, hosting scheduler) with `Authorization: Bearer $JOBS_SECRET`. Safe to repeat. */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET ?? ''
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sb = createSupabaseServiceClient()
  const { data, error } = await sb.rpc('expire_unpaid_orders')
  if (error) {
    logger.error('expire_unpaid_orders failed', { code: error.code })
    await sb.rpc('record_job_run', { p_job: 'expire-orders', p_ok: false, p_detail: {} })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
  await sb.rpc('record_job_run', { p_job: 'expire-orders', p_ok: true, p_detail: {} })
  return NextResponse.json({ ok: true, expired: data })
}
