import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { jobAuthorized } from '@/server/jobs/auth'
import { releasePayouts } from '@/server/modules/payouts/release'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: Request) {
  if (!jobAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = createSupabaseServiceClient()
  try {
    const r = await releasePayouts(25)
    await sb.rpc('record_job_run', { p_job: 'release-payouts', p_ok: !r.unavailable, p_detail: r })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    logger.error('release-payouts failed', { err: String(e).slice(0, 160) })
    await sb.rpc('record_job_run', { p_job: 'release-payouts', p_ok: false, p_detail: {} })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

/** Pays the shops whose waiting time is over. `Authorization: Bearer $JOBS_SECRET`, or the hosting scheduler (GET). Safe to repeat. */
export const POST = run
export const GET = run
