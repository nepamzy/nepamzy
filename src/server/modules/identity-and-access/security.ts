import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/logger'

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Client IP for rate-limit keys. Behind a trusted proxy this is the first X-Forwarded-For hop.
 * Limitation (documented in docs/security-privacy.md): without a trusted proxy this header is
 * client-controlled, so IP keys are combined with account-scoped keys and never used alone for
 * account protection.
 */
export async function clientIp(): Promise<string> {
  const h = await headers()
  return (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown').slice(
    0,
    64,
  )
}

/** Returns true when the action is ALLOWED. Fails closed if the limiter is unavailable. */
export async function rateLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await createSupabaseServiceClient().rpc('rate_limit_hit', {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max: max,
    })
    if (error) throw error
    return data === true
  } catch (e) {
    logger.error('rate limiter unavailable (failing closed)', { err: String(e) })
    return false
  }
}

/** Append a security event to the audit trail. Never throws. Never include secrets or raw emails. */
export async function recordSecurityEvent(
  actor: string | null,
  action: `auth.${string}` | `mfa.${string}`,
  details: Record<string, unknown> = {},
) {
  try {
    const { error } = await createSupabaseServiceClient().rpc('record_security_event', {
      p_actor: actor,
      p_action: action,
      p_details: details,
    })
    if (error) throw error
  } catch (e) {
    logger.error('failed to record security event', { action, err: String(e) })
  }
}
