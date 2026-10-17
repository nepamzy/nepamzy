import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { clientIp, rateLimit } from '@/server/modules/identity-and-access/security'

export const dynamic = 'force-dynamic'
const noStore = { 'Cache-Control': 'no-store' }

/**
 * Liveness + database reachability for a load balancer or uptime monitor. Public by design and deliberately dull:
 * it returns only ok/not-ok (no version, no configuration, no counts) and is rate limited per client address.
 * Nothing calls it yet: monitoring is an unscheduled deployment step (docs/operations/jobs.md).
 */
export async function GET() {
  if (!(await rateLimit(`health:ip:${await clientIp()}`, 60, 60)))
    return NextResponse.json({ ok: false }, { status: 429, headers: noStore })
  try {
    const { error } = await createSupabaseServiceClient()
      .from('platform_settings')
      .select('key', { head: true, count: 'exact' })
      .limit(1)
    if (error) throw error
    return NextResponse.json({ ok: true }, { headers: noStore })
  } catch (e) {
    logger.error('health check: database unreachable', { err: String(e) })
    return NextResponse.json({ ok: false }, { status: 503, headers: noStore })
  }
}
