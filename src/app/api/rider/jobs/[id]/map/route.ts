import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { rateLimit } from '@/server/modules/identity-and-access/security'

export const dynamic = 'force-dynamic'
const noStore = { 'Cache-Control': 'private, no-store' }

/** The rider's own map for ONE active delivery: themselves, the delivery point, and the customer if they chose to share. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore })
  const { who, decision } = await checkAccess({ roles: ['rider'], aal: 'aal2' })
  if (!decision.allow)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore })
  if (!(await rateLimit(`ridermap:${who.userId}`, 60, 60)))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: noStore })
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('rider_job_map', { p_assignment: id })
  if (error) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore })
  return NextResponse.json(data, { headers: noStore })
}
