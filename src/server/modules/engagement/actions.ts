'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import type { AccessRequirement } from '@/server/modules/identity-and-access/policy'
import { EDITABLE_SETTINGS } from './queries'
import {
  dbFailed,
  done,
  failed,
  gate,
  int,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

const uuid = z.uuid()
const CUSTOMER: AccessRequirement = { roles: ['customer'], aal: 'aal2' }
const ANY_USER: AccessRequirement = { aal: 'aal2' }
const SUPPORT: AccessRequirement = { roles: ['platform_admin', 'support_agent'], aal: 'aal2' }
const ADMIN: AccessRequirement = { roles: ['platform_admin'], aal: 'aal2' }

export async function markNotificationsReadAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const g = await gate(ANY_USER)
  if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  if (id && !uuid.safeParse(id).success) return failed('That notification was not found.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('notification_mark_read', { p_id: id || null })
  if (error) return dbFailed(error, 'Could not update your notifications.')
  revalidatePath('/notifications')
  return done(id ? 'Marked as read.' : 'All notifications marked as read.')
}

export async function setNotificationPreferenceAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const g = await gate(ANY_USER)
  if ('state' in g) return g.state
  const on = text(fd, 'email_enabled', 5) === 'on'
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('set_notification_preference', { p_email: on })
  if (error) return dbFailed(error, 'Could not save your choice.')
  revalidatePath('/notifications')
  return done(on ? 'Saved: copies go to the local test sink.' : 'Saved: no copies are sent.')
}

export async function createReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const order = text(fd, 'orderId', 40)
  if (!uuid.safeParse(order).success) return failed('That order was not found.')
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  const rating = int(fd, 'rating')
  if (rating === null || rating < 1 || rating > 5) return failed('Choose a rating from 1 to 5.')
  if (!(await rateLimit(`review:${g.who.userId}`, 3600, 10)))
    return failed('Too many requests. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('create_review', {
    p_order: order,
    p_rating: rating,
    p_comment: text(fd, 'comment', 500) || null,
  })
  if (error) return dbFailed(error, 'Your review could not be saved.')
  revalidatePath(`/orders/${order}`)
  return done('Thank you. Your review is published and cannot be edited.')
}

export async function reportReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const review = text(fd, 'reviewId', 40)
  if (!uuid.safeParse(review).success) return failed('That review was not found.')
  const g = await gate(ANY_USER)
  if ('state' in g) return g.state
  if (!(await rateLimit(`review-report:${g.who.userId}`, 3600, 10)))
    return failed('Too many requests. Please try again later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('report_review', {
    p_review: review,
    p_reason: text(fd, 'reason', 20),
    p_note: text(fd, 'note', 300) || null,
  })
  if (error) return dbFailed(error, 'Your report could not be sent. Choose a reason.')
  return done('Thanks. Our team will look at it. The review stays visible until a decision.')
}

export async function moderateReportAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'reportId', 40)
  if (!uuid.safeParse(id).success) return failed('That report was not found.')
  const g = await gate(SUPPORT)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('moderate_review_report', {
    p_report: id,
    p_action: text(fd, 'decision', 10),
    p_reason: text(fd, 'reason', 500),
  })
  if (error) return dbFailed(error, 'Give a reason of at least 10 characters.')
  revalidatePath('/admin/reviews')
  return done('Decision recorded.')
}

export async function unhideReviewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = text(fd, 'reviewId', 40)
  if (!uuid.safeParse(id).success) return failed('That review was not found.')
  const g = await gate(ADMIN)
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('unhide_review', {
    p_review: id,
    p_reason: text(fd, 'reason', 500),
  })
  if (error) return dbFailed(error, 'Give a reason of at least 10 characters.')
  revalidatePath('/admin/reviews')
  return done('Review restored.')
}

export async function setSettingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const key = text(fd, 'key', 60)
  if (!(EDITABLE_SETTINGS as readonly string[]).includes(key))
    return failed('That setting cannot be changed here.')
  const g = await gate(ADMIN)
  if ('state' in g) return g.state
  let value: unknown
  try {
    value = JSON.parse(text(fd, 'value', 2000))
  } catch {
    return failed('The value must be a number, "text in quotes", or a JSON object.')
  }
  const sb = await createSupabaseServerClient()
  const reason = text(fd, 'reason', 500)
  if (reason.length < 10) return failed('Give a reason of at least 10 characters.')
  const { error } = await sb.rpc('set_platform_setting', {
    p_key: key,
    p_value: value,
    p_reason: reason,
  })
  if (error) {
    // Key and database code only: never the value or the reason text.
    logger.warn('setting change refused', { setting: key, sqlstate: error.code })
    return dbFailed(error, 'That value was refused. Check the allowed range.')
  }
  revalidatePath('/admin/settings')
  return done('Saved and recorded in the audit trail.')
}
