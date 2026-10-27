'use server'

import { notifyAdmin } from '@/server/modules/engagement/admin-alerts'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import type { AccessRequirement } from '@/server/modules/identity-and-access/policy'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'
import { getRefundProvider, type FakeScenario } from './refund-provider'

const uuid = z.uuid()
const CUSTOMER: AccessRequirement = { roles: ['customer'], aal: 'aal2' }
const STAFF: AccessRequirement = {
  roles: ['platform_admin', 'support_agent', 'finance_admin'],
  aal: 'aal2',
}
const SUPPORT: AccessRequirement = { roles: ['platform_admin', 'support_agent'], aal: 'aal2' }
const FINANCE: AccessRequirement = { roles: ['platform_admin', 'finance_admin'], aal: 'aal2' }
const ANY_USER: AccessRequirement = { aal: 'aal2' }

type Line = { order_item_id: string; quantity: number }
/** Reads `item_<id>` checkboxes with a matching `qty_<id>` number. Quantities are only a REQUEST; the database enforces limits. */
function parseLines(fd: FormData): Line[] {
  const lines: Line[] = []
  for (const [k] of fd.entries()) {
    if (!k.startsWith('item_')) continue
    const id = k.slice(5)
    const q = Number(text(fd, `qty_${id}`, 4))
    if (uuid.safeParse(id).success && Number.isInteger(q) && q >= 1 && q <= 100)
      lines.push({ order_item_id: id, quantity: q })
  }
  return lines
}

export async function requestRefundCustomerAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const order = text(fd, 'orderId', 40)
  if (!uuid.safeParse(order).success) return failed('That order was not found.')
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  const scope = text(fd, 'scope', 10)
  const lines = scope === 'items' ? parseLines(fd) : null
  if (scope === 'items' && (!lines || lines.length === 0))
    return failed('Choose at least one item.')
  if (!(await rateLimit(`refund-request:${g.who.userId}`, 3600, 20)))
    return failed('Too many requests. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('customer_request_refund', {
    p_order: order,
    p_items: lines,
    p_reason: text(fd, 'reason', 500),
    p_key: text(fd, 'key', 80),
  })
  if (error)
    return dbFailed(error, 'The refund request could not be sent. Check the details and try again.')
  revalidatePath(`/orders/${order}/help`)
  const r = data as { replayed: boolean }
  if (!r.replayed) notifyAdmin({ type: 'refund_requested', orderId: order, by: 'customer' })
  return done(
    r.replayed
      ? 'You already sent this request. Its status is shown below.'
      : 'Your refund request was sent. It is not a refund yet: our team will review it and you will see its status here.',
  )
}

export async function requestReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const order = text(fd, 'orderId', 40)
  if (!uuid.safeParse(order).success) return failed('That order was not found.')
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  const lines = parseLines(fd)
  if (lines.length === 0) return failed('Choose at least one item to return.')
  if (!(await rateLimit(`return-request:${g.who.userId}`, 3600, 20)))
    return failed('Too many requests. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('customer_request_return', {
    p_order: order,
    p_items: lines,
    p_reason: text(fd, 'reason', 500),
    p_key: text(fd, 'key', 80),
  })
  if (error)
    return dbFailed(error, 'The return request could not be sent. Check the details and try again.')
  notifyAdmin({ type: 'return_requested', orderId: order })
  revalidatePath(`/orders/${order}/help`)
  return done(
    'Your return request was sent. A return is not a refund: support will decide and you will see its status here.',
  )
}

export async function openCaseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const order = text(fd, 'orderId', 40)
  if (!uuid.safeParse(order).success) return failed('That order was not found.')
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  if (!(await rateLimit(`case-open:${g.who.userId}`, 3600, 20)))
    return failed('Too many reports. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('open_support_case', {
    p_order: order,
    p_type: text(fd, 'type', 30),
    p_description: text(fd, 'description', 1000),
    p_key: text(fd, 'key', 80),
  })
  if (error)
    return dbFailed(
      error,
      'Your report could not be sent. Choose what went wrong and describe it in a few words.',
    )
  revalidatePath(`/orders/${order}/help`)
  revalidatePath('/cases')
  const r = data as { case_no: string; replayed: boolean }
  if (!r.replayed)
    notifyAdmin({ type: 'support_case', caseNo: r.case_no, kind: text(fd, 'type', 30) })
  return done(
    `${r.replayed ? 'You already reported this' : 'Your report was received'}: ${r.case_no}. Support will look at it and you can follow it under Reports.`,
  )
}

export async function addStatementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'caseId', 40)
  if (!uuid.safeParse(id).success) return failed('That report was not found.')
  const g = await gate(ANY_USER)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('case_add_statement', {
    p_case: id,
    p_body: text(fd, 'body', 1000),
    p_internal: text(fd, 'internal', 5) === 'on',
  })
  if (error)
    return dbFailed(
      error,
      'Your statement could not be added. Write a few words about what happened.',
    )
  revalidatePath(`/cases/${id}`)
  revalidatePath(`/admin/cases/${id}`)
  return done('Statement added.')
}

// ---------------------------------------------------------------------------------------------
// Staff: refunds
// ---------------------------------------------------------------------------------------------
async function refundRpc(
  fn: string,
  args: Record<string, unknown>,
  ok: string,
  req = STAFF,
): Promise<ActionState> {
  const g = await gate(req)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc(fn, args)
  if (error)
    return dbFailed(
      error,
      'That step is not possible for this refund any more. Refresh and check its status.',
    )
  revalidatePath('/admin/refunds')
  return done(ok)
}
const refundId = (fd: FormData) => {
  const id = text(fd, 'refundId', 40)
  return uuid.safeParse(id).success ? id : null
}

export async function refundReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = refundId(fd)
  if (!id) return failed('That refund was not found.')
  return refundRpc(
    'refund_start_review',
    { p_refund: id, p_note: text(fd, 'note', 300) || null },
    'Review started.',
  )
}

export async function refundDecideAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = refundId(fd)
  const decision = text(fd, 'decision', 10)
  if (!id || !['approve', 'reject'].includes(decision)) return failed('That request was not valid.')
  if (text(fd, 'reason', 500).length < 5)
    return failed('Please give a short reason (at least 5 characters).')
  return refundRpc(
    'refund_decide',
    { p_refund: id, p_decision: decision, p_reason: text(fd, 'reason', 500) },
    decision === 'approve'
      ? 'Approved. Nothing has been paid yet: executing the refund is a separate step.'
      : 'Refund request rejected.',
  )
}

/** Executes through the FAKE provider only (fails closed outside the local environment). No real money moves. */
export async function refundExecuteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = refundId(fd)
  if (!id) return failed('That refund was not found.')
  const scenario = (
    ['success', 'failure', 'timeout'].includes(text(fd, 'scenario', 10))
      ? text(fd, 'scenario', 10)
      : 'success'
  ) as FakeScenario
  const g = await gate(FINANCE)
  if ('state' in g) return g.state
  let provider
  try {
    provider = getRefundProvider()
  } catch {
    return failed('Refund execution is not available in this environment.')
  }
  const sb = await createSupabaseServerClient()
  const begin = await sb.rpc('refund_begin_execution', { p_refund: id, p_mode: provider.mode })
  if (begin.error)
    return dbFailed(
      begin.error,
      'This refund cannot be executed right now. Refresh and check its status.',
    )
  const { amount_kobo } = begin.data as { amount_kobo: number }
  let result
  try {
    result = await provider.execute({ refundId: id, amountKobo: amount_kobo }, scenario)
  } catch (e) {
    logger.error('refund provider threw', { err: String(e) })
    result = {
      outcome: 'unknown' as const,
      providerRef: null,
      detail: 'Provider call failed unexpectedly',
    }
  }
  const rec = await sb.rpc('refund_record_outcome', {
    p_refund: id,
    p_outcome: result.outcome,
    p_provider_ref: result.providerRef,
    p_detail: result.detail,
  })
  revalidatePath('/admin/refunds')
  if (rec.error)
    return failed(
      'The provider answered but the result could not be recorded. It needs reconciliation.',
    )
  return done(
    result.outcome === 'succeeded'
      ? 'FAKE provider: recorded as succeeded. No real money moved.'
      : result.outcome === 'failed'
        ? 'FAKE provider: recorded as failed. The amount is available again.'
        : 'FAKE provider: no answer. The refund needs reconciliation before anything else happens to it.',
  )
}

export async function refundReconcileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = refundId(fd)
  const resolution = text(fd, 'resolution', 10)
  if (!id || !['succeeded', 'failed'].includes(resolution))
    return failed('That request was not valid.')
  return refundRpc(
    'refund_reconcile',
    {
      p_refund: id,
      p_resolution: resolution,
      p_provider_ref: text(fd, 'ref', 100) || null,
      p_note: text(fd, 'note', 300),
    },
    'Reconciled.',
    FINANCE,
  )
}

// ---------------------------------------------------------------------------------------------
// Staff: cases and returns
// ---------------------------------------------------------------------------------------------
const caseId = (fd: FormData) => {
  const id = text(fd, 'caseId', 40)
  return uuid.safeParse(id).success ? id : null
}
async function caseRpc(
  fn: string,
  args: Record<string, unknown>,
  ok: string,
  id: string,
): Promise<ActionState> {
  const g = await gate(SUPPORT)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc(fn, args)
  if (error)
    return dbFailed(
      error,
      'That step is not possible for this report any more. Refresh and check its status.',
    )
  revalidatePath('/admin/cases')
  revalidatePath(`/admin/cases/${id}`)
  return done(ok)
}

export async function caseStartReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = caseId(fd)
  if (!id) return failed('That report was not found.')
  return caseRpc('case_start_review', { p_case: id }, 'Review started.', id)
}
export async function caseDecideAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = caseId(fd)
  if (!id) return failed('That report was not found.')
  const decision = text(fd, 'decision', 20)
  const items = parseLines(fd)
  return caseRpc(
    'case_decide',
    {
      p_case: id,
      p_decision: decision,
      p_reason: text(fd, 'reason', 1000),
      p_items: items.length ? items : null,
    },
    decision.endsWith('refund')
      ? 'Decision recorded. A refund REQUEST was created: finance still has to approve and execute it.'
      : 'Decision recorded.',
    id,
  )
}
export async function caseCloseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = caseId(fd)
  if (!id) return failed('That report was not found.')
  return caseRpc(
    'case_close',
    { p_case: id, p_note: text(fd, 'note', 300) || null },
    'Report closed.',
    id,
  )
}
export async function returnDecideAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'returnId', 40)
  const decision = text(fd, 'decision', 10)
  if (!uuid.safeParse(id).success || !['approve', 'reject'].includes(decision))
    return failed('That request was not valid.')
  const g = await gate(SUPPORT)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('staff_decide_return', {
    p_return: id,
    p_decision: decision,
    p_reason: text(fd, 'reason', 500),
  })
  if (error)
    return dbFailed(error, 'That return can no longer be decided. Refresh and check its status.')
  revalidatePath('/admin/returns')
  return done(
    decision === 'approve' ? 'Return approved (this is not a refund).' : 'Return rejected.',
  )
}
export async function opsExceptionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const order = text(fd, 'orderId', 40)
  if (!uuid.safeParse(order).success) return failed('That order was not found.')
  const g = await gate(SUPPORT)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('ops_handle_delivery_exception', {
    p_order: order,
    p_reason: text(fd, 'reason', 500),
  })
  if (error)
    return dbFailed(
      error,
      'This order cannot be handled this way (it must be on its way to the recipient).',
    )
  revalidatePath('/admin/cases')
  return done(
    `The parcel was released from the rider and a report was opened: ${(data as { case_no: string }).case_no}. Nothing was marked delivered.`,
  )
}

// ---------------------------------------------------------------------------------------------
// Shop: confirm a returned item arrived
// ---------------------------------------------------------------------------------------------
export async function confirmReturnReceivedAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const id = text(fd, 'returnId', 40)
  if (!uuid.safeParse(id).success) return failed('That return was not found.')
  const g = await gate({ roles: ['vendor_owner', 'vendor_staff'], aal: 'aal2' })
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_confirm_return_received', {
    p_return: id,
    p_condition: text(fd, 'condition', 300),
  })
  if (error) return dbFailed(error, 'Describe the condition of the item in a few words.')
  revalidatePath('/vendor/returns')
  return done('Thank you. The return is recorded as received.')
}
