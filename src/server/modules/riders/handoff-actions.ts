'use server'

import { revalidatePath } from 'next/cache'
import QRCode from 'qrcode'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { signatureProblem } from '@/server/modules/identity-and-access/identity'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { parseSignature } from '@/server/modules/orders-and-state-machine/signature'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

const uuid = z.uuid()
const RIDER = { roles: ['rider' as const], aal: 'aal2' as const }

/**
 * At the door, on the rider's phone: the customer signs, the server compares it with the signature saved at sign-up,
 * then the rider signs and the delivery is confirmed. Only the assigned rider can do this, and only after arrival.
 */
export async function riderCompleteDeliveryAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const orderId = text(fd, 'orderId', 40)
  if (!uuid.safeParse(orderId).success) return failed('That order was not found.')
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  const riderId = g.who.userId
  if (!riderId) return failed('Please sign in again.')
  const recipient = text(fd, 'recipient', 80)
  if (recipient.length < 2) return failed('Enter the customer’s name.')
  if (fd.get('confirm') !== 'on') return failed('Please tick the box to confirm the hand-over.')
  const customer = parseSignature(String(fd.get('customer_signature') ?? ''))
  if (!customer.ok) return failed('The customer must sign in the first box.')
  const rider = parseSignature(String(fd.get('rider_signature') ?? ''))
  if (!rider.ok)
    return failed('Please sign in the second box, after the customer’s signature is accepted.')
  if (!(await rateLimit(`rider-handoff:${riderId}`, 600, 30)))
    return failed('Too many attempts. Please wait a few minutes.')

  // Only the rider assigned to this arrived delivery may continue.
  const service = createSupabaseServiceClient()
  const { data: job } = await service
    .from('delivery_assignments')
    .select('id, order_id')
    .eq('order_id', orderId)
    .eq('rider_id', riderId)
    .eq('status', 'en_route')
    .not('arrival_detected_at', 'is', null)
    .maybeSingle()
  if (!job) return failed('This delivery is not ready for hand-over, or it is not yours.')
  const { data: ord } = await service
    .from('orders')
    .select('customer_id')
    .eq('id', orderId)
    .maybeSingle()
  const mismatch = ord?.customer_id ? await signatureProblem(ord.customer_id, customer.png) : null
  if (mismatch) return failed(mismatch)

  const { data, error } = await service.rpc('rider_delivery_complete', {
    p_actor: riderId,
    p_order: orderId,
    p_recipient: recipient,
    p_customer_sig: customer.hex,
    p_rider_sig: rider.hex,
  })
  if (error)
    return dbFailed(
      error,
      'This delivery cannot be confirmed right now. Refresh and check its status.',
    )
  revalidatePath('/rider/jobs')
  revalidatePath(`/orders/${orderId}`)
  const r = data as { ok: boolean; reason?: string }
  if (!r.ok)
    return r.reason === 'already_completed'
      ? done('This delivery was already confirmed.')
      : failed('This delivery cannot be confirmed right now. Refresh and check its status.')
  return done('Delivery confirmed. Thank you.')
}

export type QrOpen =
  { ok: true; url: string; qr: string; expiresAt: string } | { ok: false; error: string }

/** The rider shows a QR code; the customer scans it with their own phone (signed in) and confirms. */
export async function riderOpenQrAction(orderId: string): Promise<QrOpen> {
  if (!uuid.safeParse(orderId).success) return { ok: false, error: 'That order was not found.' }
  const g = await gate(RIDER)
  if ('state' in g) return { ok: false, error: g.state.error ?? 'Please sign in again.' }
  if (!(await rateLimit(`rider-qr:${g.who.userId}`, 600, 30)))
    return { ok: false, error: 'Too many codes. Please wait a few minutes.' }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('rider_qr_open', { p_order: orderId })
  if (error)
    return { ok: false, error: 'A code cannot be made yet. Wait for arrival to be detected.' }
  const r = data as { token: string; expires_at: string }
  const url = `${serverEnv().SITE_URL}/confirm/${orderId}.${r.token}`
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
  return { ok: true, url, qr, expiresAt: r.expires_at }
}
