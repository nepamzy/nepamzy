'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import { rateLimit } from '@/server/modules/identity-and-access/security'

const uuid = z.uuid()
export type ShareResult = { accepted: boolean; reason?: string }

/**
 * The customer chooses to show their rider where they are, for one order, while a rider is on the delivery. The browser
 * never talks to Supabase: access is re-checked here and again inside the database function.
 */
export async function postCustomerLocationAction(
  orderId: string,
  fix: { lat: number; lng: number; accuracyM: number },
): Promise<ShareResult> {
  if (!uuid.safeParse(orderId).success) return { accepted: false, reason: 'not_allowed' }
  const { who, decision } = await checkAccess({ roles: ['customer'], aal: 'aal2' })
  if (!decision.allow) return { accepted: false, reason: 'not_allowed' }
  if (![fix.lat, fix.lng, fix.accuracyM].every(Number.isFinite))
    return { accepted: false, reason: 'invalid' }
  if (!(await rateLimit(`custloc:${who.userId}`, 600, 300)))
    return { accepted: false, reason: 'rate_limited' }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('customer_post_location', {
    p_order: orderId,
    p_lat: fix.lat,
    p_lng: fix.lng,
    p_accuracy: fix.accuracyM,
  })
  if (error) return { accepted: false, reason: 'not_allowed' }
  return data as ShareResult
}

export async function stopCustomerLocationAction(orderId: string): Promise<void> {
  if (!uuid.safeParse(orderId).success) return
  const { decision } = await checkAccess({ roles: ['customer'], aal: 'aal2' })
  if (!decision.allow) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('customer_stop_location', { p_order: orderId })
}
