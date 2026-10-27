import 'server-only'
import webpush from 'web-push'
import { logger } from '@/lib/logger'

/**
 * Browser / phone pop-up notifications (Web Push with VAPID keys). Free, no third-party account.
 * Off unless VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set. The private key never leaves the server; the public key is
 * handed to the browser by a server component (this app uses no NEXT_PUBLIC variables).
 *
 * SSRF guard: the server POSTs to the subscription endpoint, a URL the browser supplied. Only the real push services are
 * accepted (Google/Firebase, Mozilla, Apple, Microsoft, Opera-style Chromium relays), so a registered endpoint can never
 * point at an internal address.
 */
export type PushConfig = { publicKey: string; privateKey: string; subject: string }
export type PushSub = { endpoint: string; p256dh: string; auth: string }
export type PushPayload = { title: string; body: string; url: string }
export type PushResult = 'sent' | 'gone' | 'failed' | 'disabled'

const ALLOWED_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.opera\.com$/,
]

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false
    return ALLOWED_HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

export function pushConfig(
  env: Record<string, string | undefined> = process.env,
): PushConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim()
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,50}$/.test(privateKey))
    return null
  const mail = (env.MAIL_FROM ?? '').trim()
  const subject = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)
    ? `mailto:${mail}`
    : (env.SITE_URL ?? 'https://example.com')
  return { publicKey, privateKey, subject }
}

export async function sendPush(
  sub: PushSub,
  payload: PushPayload,
  config: PushConfig | null = pushConfig(),
): Promise<PushResult> {
  if (!config) return 'disabled'
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'gone'
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        TTL: 3600,
        timeout: 8000,
      },
    )
    return 'sent'
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) return 'gone'
    logger.warn('push send failed', { status: status ?? 0 })
    return 'failed'
  }
}
