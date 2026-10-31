'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { registerPickupCodeForOrder } from './queries'
import { parseSignature } from './signature'
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
    const sig = parseSignature(String(fd.get('signature') ?? ''))
    if (!sig.ok)
      return failed(
        sig.reason === 'too_small'
          ? 'The signature looks empty. Please ask the recipient to sign again.'
          : 'The recipient must sign in the box before completing.',
      )
    signature = sig.hex
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
  redirect('/vendor/handover?done=pickup')
}

// ---------------------------------------------------------------------------------------------
// Delivery confirmation (Phase 9): only the customer (the recipient) can start and complete it.
// The rider has no completion action anywhere in the application.
// ---------------------------------------------------------------------------------------------
export type BeginProofResult =
  { ok: true; token: string; expiresAt: string } | { ok: false; error: string }

/** Starts (or restarts) the recipient's confirmation. The one-time token is returned once and only a hash is stored. */
export async function beginDeliveryProofAction(orderId: string): Promise<BeginProofResult> {
  if (!uuid.safeParse(orderId).success) return { ok: false, error: 'That order was not found.' }
  const gated = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in gated)
    return { ok: false, error: gated.state.error ?? 'You are not allowed to do this.' }
  if (!(await rateLimit(`delivery-proof-begin:${gated.who.userId}`, 600, 30)))
    return { ok: false, error: 'Too many attempts. Please wait a few minutes.' }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('delivery_proof_begin', { p_order: orderId })
  if (error)
    return {
      ok: false,
      error: dbFailed(
        error,
        'Your delivery is not ready to be confirmed yet. Wait until the rider has arrived, then refresh this page.',
      ).error!,
    }
  revalidatePath(`/orders/${orderId}`)
  const r = data as { token: string; expires_at: string }
  return { ok: true, token: r.token, expiresAt: r.expires_at }
}

export async function completeDeliveryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const orderId = text(fd, 'orderId', 40)
  if (!uuid.safeParse(orderId).success) return failed('That order was not found.')
  const gated = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in gated) return gated.state
  const recipient = text(fd, 'recipient', 80)
  if (recipient.length < 2) return failed('Enter your name as the person receiving the order.')
  if (fd.get('confirm') !== 'on')
    return failed('Please tick the box to confirm you received the order.')
  const sig = parseSignature(String(fd.get('signature') ?? ''))
  if (!sig.ok)
    return failed(
      sig.reason === 'too_small'
        ? 'The signature looks empty. Please sign again.'
        : 'Please sign in the box before confirming.',
    )
  if (!(await rateLimit(`delivery-proof:${gated.who.userId}`, 600, 40)))
    return failed('Too many attempts. Please wait a few minutes.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('complete_delivery', {
    p_order: orderId,
    p_token: text(fd, 'token', 40),
    p_recipient: recipient,
    p_signature: sig.hex,
    p_method: 'drawn',
  })
  if (error) {
    if (/signature_required/.test(error.message))
      return failed('Please sign in the box before confirming.')
    if (/typed_signature_disabled/.test(error.message))
      return failed(
        'A typed confirmation is not accepted for deliveries. Please sign, or contact support.',
      )
    return dbFailed(
      error,
      'This delivery cannot be confirmed right now. Refresh and check its status.',
    )
  }
  const r = data as { ok: boolean; reason?: string; attempts_left?: number }
  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  if (!r.ok) {
    if (r.reason === 'already_completed')
      return done('This delivery was already confirmed. Thank you.')
    if (r.reason === 'proof_expired')
      return failed(
        'This confirmation timed out. Choose "Confirm receipt" again to start a new one.',
      )
    if (r.reason === 'proof_locked')
      return failed('Too many failed attempts. Restart the confirmation or contact support.')
    if (r.reason === 'wrong_proof')
      return failed('This confirmation is out of date. Restart it with "Confirm receipt".')
    return failed('This confirmation is no longer valid. Refresh the page and start again.')
  }
  return done('Thank you. Your delivery is confirmed. Your receipt is ready.')
}

export type PickupLookup =
  | {
      found: true
      orderId: string
      orderNumber: string
      items: { name: string; quantity: number }[]
    }
  | { found: false; message: string }

/** Vendor counter: resolve ONE pending pickup order from the customer's code. Never completes anything. */
export async function findPickupByCodeAction(code: string): Promise<PickupLookup> {
  const gated = await gate({ roles: ['vendor_owner', 'vendor_staff'], aal: 'aal2' })
  if ('state' in gated)
    return { found: false, message: gated.state.error ?? 'You are not allowed to do this.' }
  const clean = code.trim().slice(0, 20)
  if (clean.length < 4) return { found: false, message: 'Enter the code the customer shows you.' }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('vendor_find_pickup_by_code', { p_code: clean })
  if (error) return { found: false, message: dbFailed(error).error! }
  const r = data as {
    found: boolean
    reason?: string
    order_id?: string
    order_number?: string
    items?: { name: string; quantity: number }[]
  }
  if (!r.found)
    return {
      found: false,
      message:
        r.reason === 'too_many_attempts'
          ? 'Too many wrong codes. Wait ten minutes, then try again.'
          : r.reason === 'ambiguous'
            ? 'More than one order matches that code. Choose the order from the list below.'
            : 'No pickup is waiting for that code at your shop.',
    }
  return { found: true, orderId: r.order_id!, orderNumber: r.order_number!, items: r.items ?? [] }
}
