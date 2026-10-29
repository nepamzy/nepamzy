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
/** The result plus, for a failure, the provider's HTTP status and its own short reason (never the key). */
export type MailOutcome = { result: MailResult; status?: number; reason?: string }

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

/** What the provider said, kept short and free of anything but its own error text. */
function providerReason(raw: string): string | undefined {
  try {
    const j = JSON.parse(raw) as { code?: unknown; message?: unknown }
    const code = typeof j.code === 'string' ? j.code : ''
    const msg = typeof j.message === 'string' ? j.message : ''
    return (
      `${code}${code && msg ? ': ' : ''}${msg}`.replace(CONTROL, ' ').trim().slice(0, 200) ||
      undefined
    )
  } catch {
    return raw.replace(CONTROL, ' ').trim().slice(0, 120) || undefined
  }
}

export async function sendMailDetailed(
  to: string,
  mail: RenderedEmail,
  deps: { config?: MailConfig | null; fetchImpl?: typeof fetch } = {},
): Promise<MailOutcome> {
  try {
    const config = deps.config === undefined ? mailConfig() : deps.config
    if (!config) return { result: 'disabled' }
    if (!EMAIL.test(to)) return { result: 'failed', reason: 'invalid recipient address' }
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
      const reason = providerReason(await res.text().catch(() => ''))
      logger.warn('e-mail not accepted by the provider', { status: res.status, reason })
      return { result: 'failed', status: res.status, reason }
    }
    return { result: 'sent' }
  } catch (e) {
    const reason = e instanceof Error ? e.name : 'error'
    logger.warn('e-mail send failed', { err: reason })
    return { result: 'failed', reason }
  }
}

export async function sendMail(
  to: string,
  mail: RenderedEmail,
  deps: { config?: MailConfig | null; fetchImpl?: typeof fetch } = {},
): Promise<MailResult> {
  return (await sendMailDetailed(to, mail, deps)).result
}
