'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AccessRequirement } from '@/server/modules/identity-and-access/policy'
import {
  dbFailed,
  done,
  failed,
  gate,
  nairaToKobo,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

const FINANCE: AccessRequirement = { roles: ['platform_admin', 'finance_admin'], aal: 'aal2' }

export async function resolveFlagAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'flagId', 40)
  if (!z.uuid().safeParse(id).success) return failed('That flag was not found.')
  const g = await gate(FINANCE)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('resolve_reconciliation_flag', {
    p_flag: id,
    p_note: text(fd, 'note', 500),
  })
  if (error) return dbFailed(error, 'Add a short note describing how this was resolved.')
  revalidatePath('/admin/payments')
  return done('Flag resolved.')
}

/** Records a refund REQUEST only. No money moves in this release. */
export async function requestRefundAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const order = text(fd, 'orderId', 40)
  if (!z.uuid().safeParse(order).success) return failed('That order was not found.')
  const kobo = nairaToKobo(text(fd, 'amount', 20))
  if (kobo === null || kobo <= 0)
    return failed('Enter the refund amount in naira, for example 1500 or 1500.50.')
  const g = await gate(FINANCE)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('refund_request', {
    p_order: order,
    p_amount: kobo,
    p_reason: text(fd, 'reason', 500),
  })
  if (error)
    return dbFailed(error, 'The refund could not be recorded. Check the amount and reason.')
  revalidatePath('/admin/payments')
  return done('Refund request recorded (no money has moved).')
}
