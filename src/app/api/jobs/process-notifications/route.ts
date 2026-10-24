import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type Claimed = {
  id: string
  channel: string
  attempts: number
  title: string
  body: string
  link: string | null
}

/**
 * Notification outbox worker (`Authorization: Bearer $JOBS_SECRET`). Claims a bounded batch, "sends" each through the
 * LOCAL SINK ONLY (a log line; no email/SMS/push provider exists in this codebase), and records the outcome.
 * Safe to repeat and safe to run concurrently: the database hands each row to exactly one worker.
 * Scheduling is a deployment step that has not been done (docs/operations/jobs.md).
 */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET ?? ''
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sb = createSupabaseServiceClient()
  const { data, error } = await sb.rpc('notification_outbox_claim', { p_limit: 20 })
  if (error) {
    logger.error('notification_outbox_claim failed', { code: error.code })
    await sb.rpc('record_job_run', {
      p_job: 'process-notifications',
      p_ok: false,
      p_detail: { stage: 'claim' },
    })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
  let sent = 0
  let failed = 0
  for (const row of (data ?? []) as Claimed[]) {
    let ok = true
    let err: string | null = null
    try {
      if (row.channel !== 'local_sink') throw new Error('unsupported channel')
      // The "send": a structured log line. No provider is called.
      logger.info('local sink notification', { outbox: row.id, title: row.title })
    } catch (e) {
      ok = false
      err = e instanceof Error ? e.message.slice(0, 200) : 'send failed'
    }
    const r = await sb.rpc('notification_outbox_complete', { p_id: row.id, p_ok: ok, p_error: err })
    if (r.error) logger.error('notification_outbox_complete failed', { code: r.error.code })
    if (ok) sent += 1
    else failed += 1
  }
  await sb.rpc('record_job_run', {
    p_job: 'process-notifications',
    p_ok: failed === 0,
    p_detail: { sent, failed },
  })
  return NextResponse.json({ ok: true, sent, failed })
}
