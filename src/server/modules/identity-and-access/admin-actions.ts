'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkAccess } from './guard'

export type RoleFormState = { error?: string; message?: string }
const schema = z.object({
  userId: z.uuid(),
  role: z.enum(['vendor_owner', 'vendor_staff', 'rider', 'support_agent', 'finance_admin', 'platform_admin']),
  op: z.enum(['grant', 'revoke']),
})

/** The database function re-checks role + aal2 + self-change; this is the server-side first gate. */
export async function changeRoleAction(_p: RoleFormState, formData: FormData): Promise<RoleFormState> {
  const { decision } = await checkAccess({ roles: ['platform_admin'], aal: 'aal2' })
  if (!decision.allow) return { error: 'You are not allowed to do this.' }
  const parsed = schema.safeParse({ userId: formData.get('userId'), role: formData.get('role'), op: formData.get('op') })
  if (!parsed.success) return { error: 'Check the user ID and role.' }
  const supabase = await createSupabaseServerClient()
  const { userId, role, op } = parsed.data
  const { error } = op === 'grant'
    ? await supabase.rpc('grant_role', { p_user: userId, p_role: role })
    : await supabase.rpc('revoke_role', { p_user: userId, p_role: role })
  if (error) return { error: error.message.includes('own roles') ? 'You cannot change your own roles.' : 'The change was refused.' }
  return { message: op === 'grant' ? 'Role granted and recorded.' : 'Role revoked and recorded.' }
}
