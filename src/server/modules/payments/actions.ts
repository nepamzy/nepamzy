'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { paystackConfig, serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { dbFailed, failed, gate, type ActionState } from '@/server/modules/shared/action-helpers'
import { initializeTransaction } from './paystack'

/** Starts a Paystack (TEST mode) payment for an unpaid order. The amount is read from the database, not the form. */
export async function payWithPaystackAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const orderId = String(fd.get('orderId') ?? '')
  if (!z.uuid().safeParse(orderId).success) return failed('That order was not found.')
  const gated = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in gated) return gated.state
  if (!paystackConfig()) return failed('Online payment is not open yet.')
  if (!(await rateLimit(`payinit:${gated.who.userId}`, 600, 15)))
    return failed('Too many payment attempts. Please wait a few minutes.')

  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('payment_prepare', { p_order: orderId })
  if (error) return dbFailed(error)
  const prep = data as { reference: string; amount_kobo: number; order_number: string }
  const { data: u } = await sb.auth.getUser()
  const email = u.user?.email
  if (!email) return failed('Please sign in again.')

  let url: string
  try {
    const init = await initializeTransaction({
      email,
      amountKobo: Number(prep.amount_kobo),
      reference: prep.reference,
      callbackUrl: `${serverEnv().SITE_URL}/api/payments/return`,
      orderNumber: prep.order_number,
    })
    await createSupabaseServiceClient().rpc('payment_set_access_code', {
      p_reference: prep.reference,
      p_access_code: init.access_code,
    })
    url = init.authorization_url
  } catch (e) {
    logger.error('paystack initialize failed', { err: String(e) })
    return failed('We could not reach the payment provider. Please try again in a moment.')
  }
  redirect(url)
}
