import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { jobAuthorized } from '@/server/jobs/auth'
import { drainNotifications } from '@/server/modules/engagement/dispatch'
import { releasePayouts } from '@/server/modules/payouts/release'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The one scheduled entry point (hosting cron calls it every day): expires unpaid orders, deletes old GPS history, sends any
 * waiting notifications and pays the shops whose waiting time is over. Each step is independent and safe to repeat.
 */
async function run(req: Request) {
  if (!jobAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = createSupabaseServiceClient()
  const report: Record<string, unknown> = {}
  const step = async (job: string, fn: () => Promise<unknown>) => {
    try {
      report[job] = await fn()
      await sb.rpc('record_job_run', { p_job: job, p_ok: true, p_detail: {} })
    } catch (e) {
      logger.error('scheduled job failed', { job, err: String(e).slice(0, 160) })
      report[job] = 'failed'
      await sb.rpc('record_job_run', { p_job: job, p_ok: false, p_detail: {} })
    }
  }
  await step('expire-orders', async () => {
    const { data, error } = await sb.rpc('expire_unpaid_orders')
    if (error) throw new Error(error.code)
    return data
  })
  await step('purge-location', async () => {
    const { error } = await sb.rpc('purge_location_data')
    if (error) throw new Error(error.code)
    return 'done'
  })
  await step('dispatch-notifications', () => drainNotifications(40))
  try {
    const r = await releasePayouts(25)
    report['release-payouts'] = r
    await sb.rpc('record_job_run', { p_job: 'release-payouts', p_ok: !r.unavailable, p_detail: r })
  } catch (e) {
    logger.error('scheduled job failed', { job: 'release-payouts', err: String(e).slice(0, 160) })
    report['release-payouts'] = 'failed'
    await sb.rpc('record_job_run', { p_job: 'release-payouts', p_ok: false, p_detail: {} })
  }
  return NextResponse.json({ ok: true, report })
}

export const POST = run
export const GET = run
