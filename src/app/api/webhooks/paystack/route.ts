import { NextResponse } from 'next/server'
import { paystackConfig } from '@/lib/env'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
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
  // A shop payout (a transfer) changed state: record it. Transfers carry our own reference, so a stranger's event matches nothing.
  const ev = body as {
    event?: unknown
    data?: { reference?: unknown; transfer_code?: unknown; reason?: unknown }
  }
  if (typeof ev.event === 'string' && ev.event.startsWith('transfer.')) {
    const reference = typeof ev.data?.reference === 'string' ? ev.data.reference : ''
    const status =
      ev.event === 'transfer.success'
        ? 'paid'
        : ev.event === 'transfer.failed' || ev.event === 'transfer.reversed'
          ? 'failed'
          : null
    if (reference.startsWith('afitpo-') && status) {
      const code = typeof ev.data?.transfer_code === 'string' ? ev.data.transfer_code : null
      const { error } = await createSupabaseServiceClient().rpc('payout_mark', {
        p_reference: reference,
        p_status: status,
        p_code: code,
        p_error:
          status === 'paid'
            ? null
            : ev.event === 'transfer.reversed'
              ? 'reversed'
              : 'transfer failed',
      })
      if (error) {
        logger.error('payout webhook failed', { code: error.code })
        return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true, outcome: 'transfer' })
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
