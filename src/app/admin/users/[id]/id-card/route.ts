import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { idCardForAdmin } from '@/server/modules/identity-and-access/identity'

export const dynamic = 'force-dynamic'

/** A student's ID card photo, for administrators only. Every look is logged. Route handlers sit outside layouts, so access is checked here. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id
  if (!z.uuid().safeParse(id).success) return new Response('Not found', { status: 404 })
  const { decision } = await checkAccess({ roles: ['platform_admin'], aal: 'aal2' })
  if (!decision.allow) return new Response('Not allowed', { status: 403 })
  const jpeg = await idCardForAdmin(id)
  if (!jpeg) return new Response('Not found', { status: 404 })
  const sb = await createSupabaseServerClient()
  await sb.rpc('admin_log_identity_view', { p_user: id })
  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline; filename="id-card.jpg"',
    },
  })
}
