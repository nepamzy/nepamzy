import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { describeEstimate, estimateTrip } from '@/server/modules/location/routing'

export const dynamic = 'force-dynamic'
const noStore = { 'Cache-Control': 'private, no-store' }

/**
 * Live tracking for ONE order, for the customer who placed it. Route handlers sit outside layouts, so access is checked
 * here AND again inside the database function (owner only, aal2, order in transit, rider on shift).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore })
  const { who, decision } = await checkAccess({ roles: ['customer'], aal: 'aal2' })
  if (!decision.allow)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore })
  // The page polls every 10 s (6 per minute); allow several tabs but stop a runaway client.
  if (!(await rateLimit(`tracking:${who.userId}`, 60, 40)))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: noStore })
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('get_order_tracking', { p_order: id })
  if (error) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore })
  const t = data as {
    tracking: boolean
    rider?: { lat: number; lng: number }
    destination?: { lat: number | null; lng: number | null }
  }
  let estimate = null
  if (t.tracking && t.rider && t.destination?.lat != null && t.destination.lng != null) {
    estimate = describeEstimate(
      await estimateTrip(t.rider, { lat: t.destination.lat, lng: t.destination.lng }),
    )
  }
  return NextResponse.json({ ...t, estimate }, { headers: noStore })
}
