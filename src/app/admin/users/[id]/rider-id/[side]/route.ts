import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { riderIdCardForAdmin } from '@/server/modules/identity-and-access/identity'

export const dynamic = 'force-dynamic'

/** The front or back of a new rider's ID card, for administrators only. Every look is logged. Route handlers sit outside layouts, so access is checked here. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; side: string }> }) {
  const { id, side } = await ctx.params
  if (!z.uuid().safeParse(id).success || (side !== 'front' && side !== 'back'))
    return new Response('Not found', { status: 404 })
  const { decision } = await checkAccess({ roles: ['platform_admin'], aal: 'aal2' })
  if (!decision.allow) return new Response('Not allowed', { status: 403 })
  const jpeg = await riderIdCardForAdmin(id, side)
  if (!jpeg) return new Response('Not found', { status: 404 })
  const sb = await createSupabaseServerClient()
  await sb.rpc('admin_log_identity_view', { p_user: id })
  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="rider-id-${side}.jpg"`,
    },
  })
}
