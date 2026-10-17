import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Job monitor endpoint (`Authorization: Bearer $JOBS_SECRET`, GET). 200 when every job has succeeded recently and no work is
 * piling up, 503 with the list of problems otherwise (never run / stale / failing / dead or stuck notifications).
 * It only reads. A monitor that calls it on a schedule is what turns "visible" into "monitored"; nothing calls it yet.
 */
export async function GET(req: Request) {
  const secret = process.env.JOBS_SECRET ?? ''
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await createSupabaseServiceClient().rpc('job_health_check')
  if (error) {
    logger.error('job_health_check failed', { sqlstate: error.code })
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
  const r = data as { ok: boolean; problems: unknown[] }
  return NextResponse.json(r, {
    status: r.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
