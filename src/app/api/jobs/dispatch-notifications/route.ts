import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { drainNotifications } from '@/server/modules/engagement/dispatch'

export const dynamic = 'force-dynamic'

/**
 * Delivery worker (`Authorization: Bearer $JOBS_SECRET`): sends e-mail and pop-up copies of new notifications.
 * Safe to call as often as every minute and safe to run concurrently: the database hands each notification to one caller.
 */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET ?? ''
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const r = await drainNotifications(40)
  return NextResponse.json({ ok: true, ...r })
}
