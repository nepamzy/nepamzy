import 'server-only'
import { forbidden, redirect } from 'next/navigation'
import { friendlyDbError, type DbError } from '@/lib/db-errors'
import { kickDispatch } from '@/server/modules/engagement/dispatch'
import { checkAccess } from '@/server/modules/identity-and-access/guard'
import {
  safeNextPath,
  type AccessRequirement,
  type Principal,
} from '@/server/modules/identity-and-access/policy'

export type ActionState = { ok?: boolean; error?: string; message?: string }
export const done = (message: string): ActionState => {
  // A successful action may have produced a notification: deliver it within seconds (no-op unless mail/push is configured).
  kickDispatch()
  return { ok: true, message }
}
export const failed = (error: string): ActionState => ({ error })
export const dbFailed = (e: DbError, fallback?: string): ActionState => ({
  error: friendlyDbError(e, fallback),
})

/**
 * First gate of every server action: the same central access decision as the page guards.
 * Returns the principal, or an ActionState the action should return to the user. The database re-checks
 * independently (RLS + function checks), so this is defence in depth, not the only control.
 */
export async function gate(
  req: AccessRequirement,
): Promise<{ who: Principal } | { state: ActionState }> {
  const { who, decision } = await checkAccess(req)
  if (decision.allow) return { who }
  return {
    state: failed(
      decision.action === 'forbidden'
        ? 'You are not allowed to do this.'
        : decision.action === 'switch-mode'
          ? 'You are in Customer mode. Switch to Administrator mode to do this.'
          : 'Please sign in and confirm your authenticator code to continue.',
    ),
  }
}

/** For flows where an unauthenticated / not-yet-MFA'd user should be sent to the right page instead. */
export async function gateOrRedirect(req: AccessRequirement, next: string): Promise<Principal> {
  const { who, decision } = await checkAccess(req)
  if (decision.allow) return who
  const n = encodeURIComponent(safeNextPath(next))
  if (decision.action === 'login') redirect(`/login?next=${n}`)
  if (decision.action === 'mfa-enroll') redirect(`/mfa/enroll?next=${n}`)
  if (decision.action === 'mfa-challenge') redirect(`/mfa/challenge?next=${n}`)
  if (decision.action === 'switch-mode') redirect(`/account/mode?next=${n}`)
  forbidden()
}

export function text(fd: FormData, key: string, max = 500): string {
  const v = fd.get(key)
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
export function int(fd: FormData, key: string): number | null {
  const v = text(fd, key, 12)
  return /^-?\d{1,9}$/.test(v) ? Number(v) : null
}
export { nairaToKobo } from './money-input'
