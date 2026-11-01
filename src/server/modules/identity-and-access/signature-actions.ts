'use server'

import { redirect } from 'next/navigation'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { failed, gate, text, type ActionState } from '@/server/modules/shared/action-helpers'
import { parseSignature } from '@/server/modules/orders-and-state-machine/signature'
import { safeNextPath } from './policy'
import { hasSignature, saveSignature } from './identity'

/** For accounts that have no saved signature yet: saves it once, then sends the person on where they were going. */
export async function saveMySignatureAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate({ aal: 'aal2' })
  if ('state' in g) return g.state
  const userId = g.who.userId
  if (!userId) return failed('Please sign in again.')
  const next = safeNextPath(text(fd, 'next', 300))
  if (await hasSignature(userId)) redirect(next)
  const sig = parseSignature(String(fd.get('signature') ?? ''))
  if (!sig.ok) return failed('Please sign in the box first.')
  if (!(await rateLimit(`save-signature:${userId}`, 600, 20)))
    return failed('Too many attempts. Please wait a few minutes.')
  if (!(await saveSignature(userId, String(fd.get('signature') ?? ''))))
    return failed('We could not save your signature. Please try again.')
  redirect(next)
}
