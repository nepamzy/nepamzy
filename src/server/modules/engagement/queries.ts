import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type NotificationItem = {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  read: boolean
  created_at: string
}
export type NotificationPage = { unread: number; items: NotificationItem[] }
export type OrderReviewState = {
  can_review: boolean
  reason?: 'already_reviewed' | 'own_shop' | 'not_finished'
  review?: { rating: number; comment: string | null; status: string }
}
export type PublicReviews = {
  count: number
  average_tenths: number | null
  reviews: { id: string; rating: number; comment: string | null; created_at: string }[]
}
export type ReviewReportRow = {
  id: string
  review_id: string
  reason: string
  note: string | null
  status: 'open' | 'upheld' | 'dismissed'
  created_at: string
  resolution_reason: string | null
  rating: number
  comment: string | null
  review_status: string
  vendor: string
}
export type JobHealth = {
  jobs: {
    job: string
    last_run_at: string | null
    last_ok_at: string | null
    last_run_ok: boolean | null
    failures_24h: number
  }[]
  notifications: Record<string, number | null>
  note: string
}

export const PAGE_SIZE = 20
const uuid = z.uuid()

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc(fn, args)
  if (error) return null
  return data as T
}

/** Page numbers come from the URL: clamp to a sane integer before they reach the database. */
export function pageParam(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v)
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : 1
}

export const listNotifications = (page = 1, unreadOnly = false) =>
  rpc<NotificationPage>('list_my_notifications', {
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_unread_only: unreadOnly,
  })
export const unreadCount = async () =>
  (await rpc<NotificationPage>('list_my_notifications', { p_limit: 1, p_offset: 0 }))?.unread ?? 0
export const getNotificationPreferences = async () =>
  (await rpc<{ email_enabled: boolean }>('get_notification_preferences')) ?? {
    email_enabled: false,
  }

export const myOrderReview = (order: string) =>
  uuid.safeParse(order).success
    ? rpc<OrderReviewState>('my_order_review', { p_order: order })
    : null
export const vendorReviews = (slug: string, page = 1) =>
  rpc<PublicReviews>('get_vendor_reviews', {
    p_slug: slug,
    p_limit: 10,
    p_offset: (page - 1) * 10,
  })

export const listReviewReports = async (status: string | null, page = 1) =>
  (await rpc<{ total: number; rows: ReviewReportRow[] }>('staff_list_review_reports', {
    p_status: status,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })) ?? { total: 0, rows: [] }

export const adminOverview = () => rpc<Record<string, number>>('admin_overview')
export const jobHealth = () => rpc<JobHealth>('admin_job_health')
