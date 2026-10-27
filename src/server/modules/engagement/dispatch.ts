import 'server-only'
import { after } from 'next/server'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { rateLimit, sha256Hex } from '@/server/modules/identity-and-access/security'
import { notificationEmail, welcomeEmail, type RenderedEmail } from './email-templates'
import { mailConfig, sendMail, type MailConfig, type MailResult } from './mail'
import {
  pushConfig,
  sendPush,
  type PushConfig,
  type PushPayload,
  type PushResult,
  type PushSub,
} from './push'

/**
 * Delivery worker: turns each in-app notification (written by the database triggers for orders, refunds, returns and
 * support cases) into one branded e-mail and one pop-up per registered device, exactly once.
 *  - The database hands each notification to one caller only (public.dispatch_claim), so two workers never double-send.
 *  - A channel that is not configured, a person who opted out of e-mail, or an unconfirmed address is "skipped", never an error.
 *  - A transient failure leaves the channel pending (retried by a later claim, three attempts in all), then marks it failed.
 *  - If neither channel is configured nothing is claimed, so notifications are delivered once configuration is added.
 *  - Never throws to its caller. Never logs addresses, keys or message text.
 */
export type Claimed = {
  id: string
  user_id: string
  kind: string
  title: string
  body: string
  link: string | null
  attempts: number
  email_status: 'pending' | 'sent' | 'skipped' | 'failed'
  push_status: 'pending' | 'sent' | 'skipped' | 'failed'
}
export type Report = {
  email_status: Claimed['email_status']
  push_status: Claimed['push_status']
  last_error: string | null
}
export type StoredSub = PushSub & { id: string; user_id: string }

export type Deps = {
  mail: MailConfig | null
  push: PushConfig | null
  siteUrl: string
  claim: (limit: number) => Promise<Claimed[]>
  confirmedEmail: (userId: string) => Promise<string | null>
  emailOptOuts: (userIds: string[]) => Promise<Set<string>>
  subscriptions: (userIds: string[]) => Promise<Map<string, StoredSub[]>>
  sendEmail: (to: string, mail: RenderedEmail) => Promise<MailResult>
  sendPush: (sub: PushSub, payload: PushPayload) => Promise<PushResult>
  dropSubscription: (endpoint: string) => Promise<void>
  report: (id: string, r: Report) => Promise<void>
}
export type DrainResult = {
  disabled: boolean
  claimed: number
  emailed: number
  pushed: number
  failed: number
}

const MAX_ATTEMPTS = 3

export async function drainNotifications(
  limit = 20,
  deps: Deps = defaultDeps(),
): Promise<DrainResult> {
  const out: DrainResult = { disabled: false, claimed: 0, emailed: 0, pushed: 0, failed: 0 }
  try {
    if (!deps.mail && !deps.push) return { ...out, disabled: true }
    const items = await deps.claim(limit)
    out.claimed = items.length
    if (items.length === 0) return out
    const userIds = [...new Set(items.map((n) => n.user_id))]
    const optOut = deps.mail ? await deps.emailOptOuts(userIds) : new Set<string>()
    const subs = deps.push ? await deps.subscriptions(userIds) : new Map<string, StoredSub[]>()
    for (const n of items) {
      let email = n.email_status
      let pushStatus = n.push_status
      let err: string | null = null
      const last = n.attempts >= MAX_ATTEMPTS
      if (email === 'pending') {
        if (!deps.mail || optOut.has(n.user_id)) email = 'skipped'
        else {
          const to = await deps.confirmedEmail(n.user_id)
          if (!to) email = 'skipped'
          else {
            const r = await deps.sendEmail(to, notificationEmail(n, deps.siteUrl))
            if (r === 'sent') {
              email = 'sent'
              out.emailed++
            } else if (r === 'disabled') email = 'skipped'
            else {
              email = last ? 'failed' : 'pending'
              err = 'e-mail not accepted'
            }
          }
        }
      }
      if (pushStatus === 'pending') {
        const mine = subs.get(n.user_id) ?? []
        if (!deps.push || mine.length === 0) pushStatus = 'skipped'
        else {
          const payload: PushPayload = {
            title: n.title,
            body: n.body,
            url: n.link && /^\/[A-Za-z0-9_/-]{0,120}$/.test(n.link) ? n.link : '/notifications',
          }
          const results = await Promise.all(
            mine.map(async (s) => {
              const r = await deps.sendPush(s, payload)
              if (r === 'gone') await deps.dropSubscription(s.endpoint)
              return r
            }),
          )
          if (results.includes('sent')) {
            pushStatus = 'sent'
            out.pushed++
          } else if (results.every((r) => r === 'gone' || r === 'disabled')) pushStatus = 'skipped'
          else {
            pushStatus = last ? 'failed' : 'pending'
            err = err ?? 'push not accepted'
          }
        }
      }
      if (email === 'failed' || pushStatus === 'failed') out.failed++
      await deps.report(n.id, { email_status: email, push_status: pushStatus, last_error: err })
    }
  } catch (e) {
    logger.warn('notification delivery run failed', { err: e instanceof Error ? e.name : 'error' })
  }
  return out
}

export function defaultDeps(): Deps {
  const svc = createSupabaseServiceClient()
  return {
    mail: mailConfig(),
    push: pushConfig(),
    siteUrl: process.env.SITE_URL ?? 'http://localhost:3000',
    async claim(limit) {
      const { data, error } = await svc.rpc('dispatch_claim', { p_limit: limit })
      if (error) throw new Error(`dispatch_claim failed: ${error.code ?? ''}`)
      return (data ?? []) as Claimed[]
    },
    async confirmedEmail(userId) {
      const { data } = await svc.auth.admin.getUserById(userId)
      const u = data?.user
      return u?.email && u.email_confirmed_at ? u.email : null
    },
    async emailOptOuts(userIds) {
      const { data } = await svc
        .from('notification_preferences')
        .select('user_id')
        .in('user_id', userIds)
        .eq('email_enabled', false)
      return new Set((data ?? []).map((r) => r.user_id as string))
    },
    async subscriptions(userIds) {
      const { data } = await svc
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', userIds)
      const m = new Map<string, StoredSub[]>()
      for (const r of (data ?? []) as StoredSub[])
        m.set(r.user_id, [...(m.get(r.user_id) ?? []), r])
      return m
    },
    sendEmail: (to, mail) => sendMail(to, mail),
    sendPush: (sub, payload) => sendPush(sub, payload),
    async dropSubscription(endpoint) {
      await svc.from('push_subscriptions').delete().eq('endpoint', endpoint)
    },
    async report(id, r) {
      const done = r.email_status !== 'pending' && r.push_status !== 'pending'
      await svc
        .from('notification_dispatch')
        .update({
          email_status: r.email_status,
          push_status: r.push_status,
          last_error: r.last_error,
          done_at: done ? new Date().toISOString() : null,
        })
        .eq('notification_id', id)
    },
  }
}

/** Runs a small delivery pass right after the response, so people are notified within seconds of an action. */
export function kickDispatch(): void {
  if (!mailConfig() && !pushConfig()) return
  const run = async () => {
    try {
      if (!(await rateLimit('dispatch:kick', 5, 2))) return
      await drainNotifications(10)
    } catch {
      /* best effort */
    }
  }
  try {
    after(run)
  } catch {
    void run()
  }
}

/** Welcome e-mail, at most once per address per year. */
export function notifyWelcome(email: string): void {
  const run = async () => {
    try {
      if (!mailConfig()) return
      if (!(await rateLimit(`welcome:${sha256Hex(email)}`, 31536000, 1))) return
      await sendMail(email, welcomeEmail(process.env.SITE_URL ?? 'http://localhost:3000'))
    } catch {
      /* best effort */
    }
  }
  try {
    after(run)
  } catch {
    void run()
  }
}
