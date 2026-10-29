'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AccessRequirement } from '@/server/modules/identity-and-access/policy'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

const uuid = z.uuid()
const ADMIN: AccessRequirement = { roles: ['platform_admin'], aal: 'aal2' }

export async function setUserSuspendedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(ADMIN)
  if ('state' in g) return g.state
  const id = text(fd, 'userId', 40)
  const suspend = text(fd, 'suspend', 5) === '1'
  const reason = text(fd, 'reason', 300)
  if (!uuid.safeParse(id).success) return failed('That account was not found.')
  if (reason.length < 5) return failed('Write a reason of at least 5 characters.')
  if (!(await rateLimit(`admin:suspend:${g.who.userId}`, 600, 20)))
    return failed('Too many changes. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('admin_set_user_suspended', {
    p_user: id,
    p_suspended: suspend,
    p_reason: reason,
  })
  if (error) {
    if (error.message === 'staff_account')
      return failed('This is a staff account. Remove the staff role first, then suspend.')
    return dbFailed(error, 'Could not change this account.')
  }
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${id}`)
  return done(suspend ? 'Account suspended. Open sessions were ended.' : 'Account reinstated.')
}

export async function setProductVisibilityAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const g = await gate(ADMIN)
  if ('state' in g) return g.state
  const id = text(fd, 'productId', 40)
  const hide = text(fd, 'hide', 5) === '1'
  const reason = text(fd, 'reason', 300)
  if (!uuid.safeParse(id).success) return failed('That item was not found.')
  if (reason.length < 5) return failed('Write a reason of at least 5 characters.')
  if (!(await rateLimit(`admin:product:${g.who.userId}`, 600, 40)))
    return failed('Too many changes. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('admin_set_product_visibility', {
    p_product: id,
    p_hidden: hide,
    p_reason: reason,
  })
  if (error) {
    if (error.message === 'product_not_active') return failed('Only an active item can be hidden.')
    if (error.message === 'product_not_hidden') return failed('This item is not hidden.')
    return dbFailed(error, 'Could not change this item.')
  }
  revalidatePath('/admin/products')
  return done(hide ? 'Item hidden from the marketplace.' : 'Item is visible again.')
}
