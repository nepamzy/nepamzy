import { NextResponse } from 'next/server'
import { paystackConfig } from '@/lib/env'
import { logger } from '@/lib/logger'
import { applyPaymentEvent } from '@/server/modules/payments/apply'
import { webhookToCall } from '@/server/modules/payments/events'
import { verifySignature } from '@/server/modules/payments/signature'

export const dynamic = 'force-dynamic'
const MAX_BYTES = 64 * 1024

/**
 * Paystack webhook. Order of checks: configured -> size -> signature over the RAW body -> JSON -> known event.
 * Unknown events get 200 (so the provider stops retrying); processing failures get 500 (so it retries).
 */
export async function POST(req: Request) {
  const cfg = paystackConfig()
  if (!cfg) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })
  const raw = await req.text()
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })
  if (!verifySignature(raw, req.headers.get('x-paystack-signature'), cfg.secretKey)) {
    logger.warn('paystack webhook rejected: bad signature')
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const call = webhookToCall(body)
  if (call === 'invalid') return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  if (call === null) return NextResponse.json({ ok: true, outcome: 'ignored' })
  try {
    const outcome = await applyPaymentEvent(call)
    return NextResponse.json({ ok: true, outcome })
  } catch (e) {
    logger.error('paystack webhook processing failed', { err: String(e) })
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
