'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
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

const uuid = z.uuid()
const CUSTOMER: AccessRequirement = { roles: ['customer'], aal: 'aal2' }
const RIDER: AccessRequirement = { roles: ['rider'], aal: 'aal2' }
const FINANCE: AccessRequirement = { roles: ['platform_admin', 'finance_admin'], aal: 'aal2' }
const ADMIN: AccessRequirement = { roles: ['platform_admin'], aal: 'aal2' }

export async function saveRiderBankDetailsAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  if (!(await rateLimit(`bank:${g.who.userId}`, 3600, 10)))
    return failed('Too many requests. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('rider_set_bank_details', {
    p_bank: text(fd, 'bank_name', 60),
    p_number: text(fd, 'account_number', 20),
    p_name: text(fd, 'account_name', 80),
  })
  if (error)
    return dbFailed(
      error,
      'Check the bank name, the 10-digit account number and the account name, then try again.',
    )
  revalidatePath('/rider/payments')
  return done(
    'Saved. Deliveries you have already completed keep the details they were opened with.',
  )
}

export async function openDeliveryFeeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const order = text(fd, 'orderId', 40)
  if (!uuid.safeParse(order).success) return failed('That order was not found.')
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('open_delivery_fee_payment', { p_order: order })
  if (error) return dbFailed(error, 'Could not open the delivery fee payment.')
  revalidatePath(`/orders/${order}/delivery-fee`)
  const state = (data as { state?: string }).state
  return state === 'payment'
    ? done('Payment details are shown below.')
    : failed('A delivery fee payment is not available for this order right now.')
}

export async function reportDeliveryFeeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'paymentId', 40)
  if (!uuid.safeParse(id).success) return failed('That payment was not found.')
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  if (!(await rateLimit(`dfp-report:${g.who.userId}`, 3600, 10)))
    return failed('Too many requests. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('report_delivery_fee_transfer', {
    p_payment: id,
    p_note: text(fd, 'note', 300) || null,
  })
  if (error) return dbFailed(error, 'Could not record your report.')
  revalidatePath('/orders', 'layout')
  return done('Thank you. The rider has been asked to confirm they received it.')
}

export async function respondDeliveryFeeAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const id = text(fd, 'paymentId', 40)
  const decision = text(fd, 'decision', 10)
  if (!uuid.safeParse(id).success || !['confirm', 'dispute'].includes(decision))
    return failed('That payment was not found.')
  const g = await gate(RIDER)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('respond_delivery_fee_transfer', {
    p_payment: id,
    p_response: decision,
    p_note: text(fd, 'note', 300) || null,
  })
  if (error)
    return dbFailed(error, 'Could not save your answer. A dispute needs a short explanation.')
  revalidatePath('/rider/payments')
  return done(
    decision === 'confirm'
      ? 'Confirmed. A receipt has been issued.'
      : 'Recorded as not received. An administrator will review it.',
  )
}

export async function resolveDeliveryFeeDisputeAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const id = text(fd, 'paymentId', 40)
  const outcome = text(fd, 'outcome', 20)
  if (!uuid.safeParse(id).success || !['received', 'not_received'].includes(outcome))
    return failed('That payment was not found.')
  const g = await gate(FINANCE)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('admin_resolve_delivery_fee_dispute', {
    p_payment: id,
    p_outcome: outcome,
    p_reason: text(fd, 'reason', 500),
  })
  if (error) return dbFailed(error, 'Could not record the decision. A written reason is required.')
  revalidatePath('/admin/delivery-fee-payments')
  return done('Decision recorded.')
}

export async function voidDeliveryFeeReceiptAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const id = text(fd, 'receiptId', 40)
  if (!uuid.safeParse(id).success) return failed('That receipt was not found.')
  const g = await gate(ADMIN)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('admin_void_delivery_fee_receipt', {
    p_receipt: id,
    p_reason: text(fd, 'reason', 500),
  })
  if (error) return dbFailed(error, 'Could not void the receipt. A written reason is required.')
  revalidatePath('/admin/delivery-fee-payments')
  return done('Receipt voided. The record is kept.')
}
