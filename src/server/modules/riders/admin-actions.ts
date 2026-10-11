'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AccessRequirement } from '@/server/modules/identity-and-access/policy'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

const ADMIN: AccessRequirement = { roles: ['platform_admin'], aal: 'aal2' }
const OPS: AccessRequirement = { roles: ['platform_admin', 'support_agent'], aal: 'aal2' }
const uuid = z.uuid()

export async function decideRiderApplicationAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const id = text(fd, 'applicationId', 40)
  const decision = text(fd, 'decision', 10)
  if (!uuid.safeParse(id).success || !['approve', 'reject'].includes(decision))
    return failed('That request was not valid.')
  const g = await gate(ADMIN)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('decide_rider_application', {
    p_application: id,
    p_decision: decision,
    p_reason: text(fd, 'reason', 500) || null,
  })
  if (error) return dbFailed(error)
  revalidatePath('/admin/riders')
  return done(decision === 'approve' ? 'Rider approved.' : 'Application rejected.')
}

export async function setRiderStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'riderId', 40)
  const status = text(fd, 'status', 12)
  if (!uuid.safeParse(id).success || !['approved', 'suspended'].includes(status))
    return failed('That request was not valid.')
  const g = await gate(ADMIN)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('set_rider_status', {
    p_rider: id,
    p_status: status,
    p_reason: text(fd, 'reason', 500),
  })
  if (error) return dbFailed(error)
  revalidatePath('/admin/riders')
  return done(status === 'suspended' ? 'Rider suspended.' : 'Rider reinstated.')
}

export async function resolveRiderIssueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'issueId', 40)
  if (!uuid.safeParse(id).success) return failed('That issue was not found.')
  const g = await gate(OPS)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('resolve_rider_issue', {
    p_issue: id,
    p_note: text(fd, 'note', 300),
  })
  if (error) return dbFailed(error)
  revalidatePath('/admin/rider-issues')
  return done('Issue resolved.')
}

export async function opsReleaseAssignmentAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const id = text(fd, 'assignmentId', 40)
  if (!uuid.safeParse(id).success) return failed('That delivery was not found.')
  const g = await gate(OPS)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('ops_release_assignment', {
    p_assignment: id,
    p_reason: text(fd, 'reason', 300),
  })
  if (error) return dbFailed(error, 'Only a delivery that has not been picked up can be released.')
  revalidatePath('/admin/rider-issues')
  return done('Delivery returned to the pool.')
}
