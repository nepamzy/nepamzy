'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { registerPickupCodeForOrder } from './queries'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

const ACTIONS = ['accept', 'reject', 'start_preparing', 'mark_ready'] as const
const uuid = z.uuid()

export async function vendorOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const orderId = text(fd, 'orderId', 40)
  const action = text(fd, 'action', 30)
  if (!uuid.safeParse(orderId).success || !(ACTIONS as readonly string[]).includes(action))
    return failed('That request was not valid.')
  const gated = await gate({ roles: ['vendor_owner', 'vendor_staff'], aal: 'aal2' })
  if ('state' in gated) return gated.state
  if (action === 'reject' && text(fd, 'reason', 200).length < 3)
    return failed('Please give a short reason so the customer can be told.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_transition_order', {
    p_order: orderId,
    p_action: action,
    p_reason: text(fd, 'reason', 200) || null,
  })
  if (error)
    return dbFailed(
      error,
      'That step is not possible for this order any more. Refresh and check its status.',
    )
  if (action === 'mark_ready') {
    try {
      await registerPickupCodeForOrder(orderId) // no-op for delivery orders and when already registered
    } catch (e) {
      // The customer page registers it lazily too, so this is not fatal; but it must be visible in logs.
      logger.error('pickup code registration failed', { err: String(e) })
    }
  }
  revalidatePath('/vendor/orders')
  revalidatePath('/vendor/handover')
  return done('Order updated.')
}

const SIGNATURE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/

export async function typedSignatureEnabled(): Promise<boolean> {
  const { data } = await createSupabaseServiceClient()
    .from('platform_settings')
    .select('value')
    .eq('key', 'typed_signature_enabled')
    .maybeSingle()
  return data?.value === true
}

export async function completePickupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const orderId = text(fd, 'orderId', 40)
  if (!uuid.safeParse(orderId).success) return failed('That order was not found.')
  const gated = await gate({ roles: ['vendor_owner', 'vendor_staff'], aal: 'aal2' })
  if ('state' in gated) return gated.state
  const recipient = text(fd, 'recipient', 80)
  if (recipient.length < 2) return failed("Enter the recipient's name.")
  const method = text(fd, 'method', 20) === 'typed' ? 'typed_acknowledgement' : 'drawn'
  let signature: string | null = null
  let typed: string | null = null
  if (method === 'drawn') {
    const dataUrl = String(fd.get('signature') ?? '')
    const m = SIGNATURE.exec(dataUrl)
    if (!m || dataUrl.length > 540_000)
      return failed('The recipient must sign in the box before completing.')
    const png = Buffer.from(m[1]!, 'base64')
    if (png.length < 300)
      return failed('The signature looks empty. Please ask the recipient to sign again.')
    signature = '\\x' + png.toString('hex')
  } else {
    typed = text(fd, 'typed', 120)
    if (typed.length < 2) return failed('Type the recipient’s full name to acknowledge receipt.')
    if (!(await typedSignatureEnabled()))
      return failed(
        'A typed acknowledgement is not enabled. Ask the recipient to sign, or contact support.',
      )
  }
  if (!(await rateLimit(`pickup:${gated.who.userId}`, 600, 40)))
    return failed('Too many attempts. Please wait a few minutes.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('complete_pickup', {
    p_order: orderId,
    p_code: text(fd, 'code', 20),
    p_recipient: recipient,
    p_signature: signature,
    p_method: method,
    p_typed: typed,
  })
  if (error) {
    if (/signature_required/.test(error.message))
      return failed('The recipient must sign in the box before completing.')
    if (/typed_signature_disabled/.test(error.message))
      return failed('A typed acknowledgement is not enabled.')
    return dbFailed(
      error,
      'This order cannot be handed over right now. Refresh and check its status.',
    )
  }
  const r = data as { ok: boolean; reason?: string; attempts_left?: number }
  if (!r.ok) {
    if (r.reason === 'wrong_code')
      return failed(`That code is not right. ${r.attempts_left ?? 0} tries left before it locks.`)
    if (r.reason === 'code_locked')
      return failed('Too many wrong codes. This pickup is locked; contact support.')
    return failed('That pickup code is no longer valid.')
  }
  revalidatePath('/vendor/handover')
  revalidatePath('/vendor/orders')
  return done('Handover complete. Receipt is available to the customer.')
}
