'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AccessRequirement } from '@/server/modules/identity-and-access/policy'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { checkFix } from '@/server/modules/location/geo'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'
import { locationSettings } from './queries'

const uuid = z.uuid()
const RIDER: AccessRequirement = { roles: ['rider'], aal: 'aal2' }

/** Applicants are plain customers (the rider role is granted on approval). */
export async function submitRiderApplicationAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const g = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in g) return g.state
  if (!(await rateLimit(`riderapply:${g.who.userId}`, 3600, 5)))
    return failed('Too many attempts. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('submit_rider_application', {
    p_name: text(fd, 'fullName', 80),
    p_phone: text(fd, 'phone', 20),
    p_vehicle: text(fd, 'vehicle', 200) || null,
    p_accept: fd.get('accept') === 'on',
  })
  if (error)
    return dbFailed(
      error,
      'Check the form: name and phone are required, and you must accept the rules.',
    )
  revalidatePath('/rider-apply')
  return done('Application sent. An administrator will review it.')
}

export async function ackTermsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  if (fd.get('accept') !== 'on') return failed('Tick the box to accept the rider terms.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('rider_ack_terms', { p_version: text(fd, 'version', 60) })
  if (error) return dbFailed(error)
  revalidatePath('/rider')
  return done('Thank you. You can now go active.')
}

export async function goActiveAction(): Promise<ActionState> {
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('rider_go_active')
  if (error) return dbFailed(error)
  revalidatePath('/rider')
  revalidatePath('/rider/jobs')
  return done('You are active. Location is shared only while you carry an accepted delivery.')
}

export async function goInactiveAction(): Promise<ActionState> {
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('rider_go_inactive')
  if (error) return dbFailed(error)
  revalidatePath('/rider')
  revalidatePath('/rider/jobs')
  const n = (data as { released: number }).released
  return done(
    n > 0
      ? `You are off duty. ${n} accepted delivery(ies) were returned to the pool.`
      : 'You are off duty. Location sharing is off.',
  )
}

export async function acceptOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const orderId = text(fd, 'orderId', 40)
  if (!uuid.safeParse(orderId).success) return failed('That delivery was not found.')
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  if (!(await rateLimit(`accept:${g.who.userId}`, 300, 30)))
    return failed('Too many attempts. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('rider_accept_order', { p_order: orderId })
  if (error) return dbFailed(error)
  revalidatePath('/rider/jobs')
  return done('Delivery accepted.')
}

export type TokenState = ActionState & { token?: string; expiresAt?: string }
export async function issueTokenAction(_p: TokenState, fd: FormData): Promise<TokenState> {
  const id = text(fd, 'assignmentId', 40)
  if (!uuid.safeParse(id).success) return failed('That delivery was not found.')
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  if (!(await rateLimit(`token:${g.who.userId}`, 300, 20)))
    return failed('Too many attempts. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('rider_issue_handover_token', { p_assignment: id })
  if (error) return dbFailed(error)
  const r = data as { token: string; expires_at: string }
  return {
    ok: true,
    token: r.token,
    expiresAt: r.expires_at,
    message: 'Show this code to the vendor. It works once.',
  }
}

export async function startRouteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'assignmentId', 40)
  if (!uuid.safeParse(id).success) return failed('That delivery was not found.')
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('rider_start_route', { p_assignment: id })
  if (error) return dbFailed(error)
  revalidatePath('/rider/jobs')
  return done('On your way. Keep this screen open so your location can be shared.')
}

const REASONS = [
  'vendor_not_ready',
  'recipient_unavailable',
  'blocked_route',
  'safety_security_restriction',
  'gps_issue',
]
export async function reportIssueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'assignmentId', 40)
  const reason = text(fd, 'reason', 40)
  if (!uuid.safeParse(id).success || !REASONS.includes(reason)) return failed('Choose a reason.')
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  if (!(await rateLimit(`issue:${g.who.userId}`, 600, 20)))
    return failed('Too many reports. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('rider_report_issue', {
    p_assignment: id,
    p_reason: reason,
    p_note: text(fd, 'note', 300) || null,
  })
  if (error) return dbFailed(error)
  return done(
    reason === 'gps_issue'
      ? 'Reported to support. This does not mark you as arrived; keep going and support will follow up.'
      : 'Reported to support. Nothing happens to your account because of a report.',
  )
}

export type LocationResult = { accepted: boolean; reason?: string }
/**
 * Called by the browser while (and only while) the rider is active with an accepted delivery. The browser never talks
 * to Supabase: this action re-checks access, pre-validates, rate-limits and calls the database function, which is the
 * authority on every rule (shift, active work, freshness, accuracy, frequency, arrival).
 */
export async function postLocationAction(input: {
  lat: number
  lng: number
  accuracyM: number
  observedAtMs: number
}): Promise<LocationResult> {
  const g = await gate(RIDER)
  if ('state' in g) return { accepted: false, reason: 'not_allowed' }
  const s = await locationSettings()
  const pre = checkFix(
    {
      lat: Number(input.lat),
      lng: Number(input.lng),
      accuracyM: Number(input.accuracyM),
      observedAtMs: Number(input.observedAtMs),
    },
    Date.now(),
    s,
  )
  if (!pre.ok) return { accepted: false, reason: pre.reason }
  if (!(await rateLimit(`loc:${g.who.userId}`, 600, 400)))
    return { accepted: false, reason: 'rate_limited' }
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('rider_post_location', {
    p_lat: input.lat,
    p_lng: input.lng,
    p_accuracy: input.accuracyM,
    p_observed_at: new Date(input.observedAtMs).toISOString(),
  })
  if (error)
    return {
      accepted: false,
      reason: /tracking_not_active/.test(error.message) ? 'tracking_not_active' : 'error',
    }
  const r = data as { accepted: boolean; reason?: string }
  if (r.accepted) revalidatePath('/rider/jobs')
  return { accepted: r.accepted, reason: r.reason }
}

// ---- vendor side -------------------------------------------------------------------------------
export async function confirmRiderPickupAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const orderId = text(fd, 'orderId', 40)
  if (!uuid.safeParse(orderId).success) return failed('That order was not found.')
  const g = await gate({ roles: ['vendor_owner', 'vendor_staff'], aal: 'aal2' })
  if ('state' in g) return g.state
  if (!(await rateLimit(`ridertoken:${g.who.userId}`, 600, 40)))
    return failed('Too many attempts. Please wait a few minutes.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('vendor_confirm_rider_pickup', {
    p_order: orderId,
    p_token: text(fd, 'token', 20),
  })
  if (error) return dbFailed(error)
  const r = data as { ok: boolean; reason?: string; attempts_left?: number }
  if (!r.ok) {
    const msg: Record<string, string> = {
      wrong_token: `That code is not right. ${r.attempts_left ?? 0} tries left before it locks.`,
      token_locked: 'Too many wrong codes. Ask the rider to show a new code.',
      token_expired: 'That code has expired. Ask the rider to show a new code.',
      token_unavailable: 'The rider has not shown a code yet.',
      no_pending_pickup: 'There is no rider waiting to collect this order.',
    }
    return failed(msg[r.reason ?? ''] ?? 'That code is not valid.')
  }
  revalidatePath('/vendor/handover')
  revalidatePath('/vendor/orders')
  return done('Parcel handed to the rider.')
}
