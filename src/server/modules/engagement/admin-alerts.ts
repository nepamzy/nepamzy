import 'server-only'
import { after } from 'next/server'
import { logger } from '@/lib/logger'
import { formatNaira } from '@/lib/money'
import { rateLimit } from '@/server/modules/identity-and-access/security'

/**
 * Operator alert e-mails: a short plain-text message to the platform owner for each important event
 * (sign-up, application, order, payment, refund/return request, support case).
 *
 * Rules this module keeps:
 *  - Best effort. A missing configuration, a provider outage or a daily cap NEVER affects the user's request.
 *  - No personal data in the message: e-mail addresses are masked, no names, phones, addresses or order contents.
 *    Free text from users appears only after being stripped of control characters and truncated.
 *  - The subject line is built from fixed strings only (no user text), so it cannot be used to inject headers.
 *  - Server-only. The Brevo API key is read from the environment and is never logged or sent to the browser.
 *  - Capped (200 per rolling day, shared by every server instance through the database limiter) to stay inside the
 *    free Brevo allowance of 300 e-mails a day.
 */

export type AdminAlertEvent =
  | { type: 'signup'; email: string }
  | { type: 'vendor_application'; businessName: string }
  | { type: 'rider_application' }
  | { type: 'order_placed'; orderId: string }
  | { type: 'payment'; outcome: string; amountKobo: number; currency: string; reference: string }
  | { type: 'refund_requested'; orderId: string; by: 'customer' | 'finance' }
  | { type: 'return_requested'; orderId: string }
  | { type: 'support_case'; caseNo: string; kind: string }
  | { type: 'contact_message' }

export type AdminAlertConfig = { apiKey: string; to: string; from: string; fromName: string }
export type AdminAlertResult = 'sent' | 'disabled' | 'capped' | 'failed'

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'
const DAILY_CAP = 200
/** Payment outcomes worth an e-mail; duplicates, ignored and out-of-order events are not. */
const PAYMENT_OUTCOMES = new Set([
  'paid',
  'late_payment',
  'amount_mismatch',
  'duplicate_payment',
  'failed',
])

export const alertablePaymentOutcome = (o: string) => PAYMENT_OUTCOMES.has(o)

/** Null (alerts off) unless all of BREVO_API_KEY, ADMIN_ALERT_TO and ADMIN_ALERT_FROM are set and well formed. */
export function adminAlertConfig(
  env: Record<string, string | undefined> = process.env,
): AdminAlertConfig | null {
  const apiKey = (env.BREVO_API_KEY ?? '').trim()
  const to = (env.ADMIN_ALERT_TO ?? '').trim()
  const from = (env.ADMIN_ALERT_FROM ?? '').trim()
  if (apiKey.length < 20 || !EMAIL.test(to) || !EMAIL.test(from)) return null
  const fromName = clean(env.ADMIN_ALERT_FROM_NAME ?? '', 40) || 'AFIT Market'
  return { apiKey, to, from, fromName }
}

/** Removes control characters and newlines, collapses spaces, truncates. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g
export function clean(s: string, max: number): string {
  return s.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** `jane.doe@gmail.com` -> `j***@gmail.com` */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  return `${clean(email.slice(0, 1), 1)}***@${clean(email.slice(at + 1), 80)}`
}

const IDENT = /[^A-Za-z0-9._-]/g
const ident = (s: string, max: number) => clean(s, max).replace(IDENT, '')

/** Subject and body for an event. Pure function: nothing here touches the network or the environment. */
export function buildAdminAlert(
  event: AdminAlertEvent,
  siteUrl: string,
  now: Date = new Date(),
): { subject: string; text: string } {
  const lines: string[] = []
  let subject: string
  let link = '/admin'
  switch (event.type) {
    case 'signup':
      subject = '[AFIT Market] New sign-up'
      lines.push(`A new account was created (not yet confirmed): ${maskEmail(event.email)}`)
      link = '/admin/roles'
      break
    case 'vendor_application':
      subject = '[AFIT Market] New vendor application'
      lines.push(`Business: ${clean(event.businessName, 80)}`, 'It is waiting for your decision.')
      link = '/admin/applications'
      break
    case 'rider_application':
      subject = '[AFIT Market] New rider application'
      lines.push('A rider application is waiting for your decision.')
      link = '/admin/riders'
      break
    case 'order_placed':
      subject = '[AFIT Market] New order placed'
      lines.push(`Order id: ${ident(event.orderId, 40)}`, 'Status: waiting for payment.')
      link = '/admin/payments'
      break
    case 'payment':
      subject = '[AFIT Market] Payment update'
      lines.push(
        `Result: ${ident(event.outcome, 30)}`,
        `Amount: ${formatNaira(Math.max(0, Math.trunc(event.amountKobo)))} ${ident(event.currency, 3)}`,
        `Reference: ${ident(event.reference, 60)}`,
      )
      link = '/admin/payments'
      break
    case 'refund_requested':
      subject = '[AFIT Market] Refund requested'
      lines.push(`Order id: ${ident(event.orderId, 40)}`, `Requested by: ${event.by}`)
      link = '/admin/refunds'
      break
    case 'return_requested':
      subject = '[AFIT Market] Return requested'
      lines.push(`Order id: ${ident(event.orderId, 40)}`)
      link = '/admin/returns'
      break
    case 'contact_message':
      subject = '[AFIT Market] New contact message'
      lines.push('A message from the public contact form is waiting.')
      link = '/admin/messages'
      break
    case 'support_case':
      subject = '[AFIT Market] New support report'
      lines.push(`Case: ${ident(event.caseNo, 30)}`, `Type: ${ident(event.kind, 30)}`)
      link = '/admin/cases'
      break
  }
  const when = now.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour12: false })
  const base = siteUrl.replace(/\/+$/, '')
  return {
    subject,
    text: [
      ...lines,
      '',
      `Time (Lagos): ${when}`,
      `Open: ${base}${link}`,
      '',
      'Automatic alert from AFIT Market.',
    ].join('\n'),
  }
}

/** Sends one alert now. Never throws. Exported for tests; application code should call `notifyAdmin`. */
export async function sendAdminAlert(
  event: AdminAlertEvent,
  deps: {
    config?: AdminAlertConfig | null
    fetchImpl?: typeof fetch
    siteUrl?: string
    underCap?: () => Promise<boolean>
  } = {},
): Promise<AdminAlertResult> {
  try {
    const config = deps.config === undefined ? adminAlertConfig() : deps.config
    if (!config) return 'disabled'
    const underCap = deps.underCap ?? (() => rateLimit('adminalert:day', 86400, DAILY_CAP))
    if (!(await underCap())) {
      logger.warn('admin alert dropped: daily cap reached')
      return 'capped'
    }
    const { subject, text } = buildAdminAlert(
      event,
      deps.siteUrl ?? process.env.SITE_URL ?? 'http://localhost:3000',
    )
    const res = await (deps.fetchImpl ?? fetch)(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: config.fromName, email: config.from },
        to: [{ email: config.to }],
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      logger.warn('admin alert not accepted by the e-mail provider', { status: res.status })
      return 'failed'
    }
    return 'sent'
  } catch (e) {
    logger.warn('admin alert failed', { err: e instanceof Error ? e.name : 'error' })
    return 'failed'
  }
}

/**
 * Fire and forget: schedules the alert to run after the response is sent. Safe to call from server actions and
 * route handlers; a failure here can never reach the caller.
 */
export function notifyAdmin(event: AdminAlertEvent): void {
  try {
    after(() => sendAdminAlert(event))
  } catch {
    void sendAdminAlert(event)
  }
}
