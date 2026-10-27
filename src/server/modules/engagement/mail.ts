import 'server-only'
import { logger } from '@/lib/logger'
import type { RenderedEmail } from './email-templates'

/**
 * Transactional e-mail to people through Brevo's HTTP API (the same account and key as the operator alerts).
 * Off unless BREVO_API_KEY and MAIL_FROM are set; never throws; the key is read from the environment only and is never
 * logged. The sender (MAIL_FROM) must be a sender verified in the Brevo account.
 */
export type MailConfig = { apiKey: string; from: string; fromName: string; replyTo: string }
export type MailResult = 'sent' | 'disabled' | 'failed'

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'
const CONTROL = /[\u0000-\u001f\u007f]+/g

export function mailConfig(
  env: Record<string, string | undefined> = process.env,
): MailConfig | null {
  const apiKey = (env.BREVO_API_KEY ?? '').trim()
  const from = (env.MAIL_FROM ?? '').trim()
  if (apiKey.length < 20 || !EMAIL.test(from)) return null
  const replyTo = (env.MAIL_REPLY_TO ?? '').trim()
  const fromName =
    (env.MAIL_FROM_NAME ?? '').replace(CONTROL, ' ').trim().slice(0, 40) || 'AFIT Market'
  return { apiKey, from, fromName, replyTo: EMAIL.test(replyTo) ? replyTo : from }
}

export async function sendMail(
  to: string,
  mail: RenderedEmail,
  deps: { config?: MailConfig | null; fetchImpl?: typeof fetch } = {},
): Promise<MailResult> {
  try {
    const config = deps.config === undefined ? mailConfig() : deps.config
    if (!config) return 'disabled'
    if (!EMAIL.test(to)) return 'failed'
    const res = await (deps.fetchImpl ?? fetch)(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: config.fromName, email: config.from },
        replyTo: { email: config.replyTo },
        to: [{ email: to }],
        subject: mail.subject.replace(CONTROL, ' ').slice(0, 150),
        htmlContent: mail.html,
        textContent: mail.text,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      logger.warn('e-mail not accepted by the provider', { status: res.status })
      return 'failed'
    }
    return 'sent'
  } catch (e) {
    logger.warn('e-mail send failed', { err: e instanceof Error ? e.name : 'error' })
    return 'failed'
  }
}
