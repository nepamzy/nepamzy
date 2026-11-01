'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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

/** The customer scanned the rider's QR code and confirms they received the order. */
export async function confirmDeliveryByQrAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const orderId = text(fd, 'orderId', 40)
  if (!uuid.safeParse(orderId).success) return failed('That order was not found.')
  const g = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in g) return g.state
  if (fd.get('confirm') !== 'on')
    return failed('Please tick the box to confirm you received the order.')
  if (!(await rateLimit(`delivery-qr:${g.who.userId}`, 600, 30)))
    return failed('Too many attempts. Please wait a few minutes.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('customer_qr_confirm', {
    p_order: orderId,
    p_token: text(fd, 'token', 40),
  })
  if (error)
    return dbFailed(
      error,
      'This delivery cannot be confirmed right now. Ask your rider to show a new code.',
    )
  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  const r = data as { ok: boolean; reason?: string }
  if (!r.ok) {
    if (r.reason === 'already_completed')
      return done('This delivery was already confirmed. Thank you.')
    if (r.reason === 'qr_expired')
      return failed('This code has expired. Ask your rider to show a new one.')
    if (r.reason === 'qr_locked')
      return failed('Too many wrong tries. Ask your rider to show a new code.')
    return failed('This code is not valid any more. Ask your rider to show a new one.')
  }
  return done('Thank you. Your delivery is confirmed. Your receipt is ready.')
}
