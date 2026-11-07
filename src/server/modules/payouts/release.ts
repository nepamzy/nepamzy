import 'server-only'
import { logger } from '@/lib/logger'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { notifyAdmin } from '@/server/modules/engagement/admin-alerts'
import {
  PaymentsUnavailable,
  createTransferRecipient,
  finalizeTestTransfer,
  startTransfer,
  verifyTransfer,
  type TransferOutcome,
} from '@/server/modules/payments/paystack'
import { decryptField } from '@/server/security/field-crypto'

type Claimed = {
  o_id: string
  o_vendor: string
  o_amount: number | string
  o_reference: string
  o_attempts: number
  o_resume: boolean
}

export type ReleaseResult = {
  claimed: number
  paid: number
  pending: number
  failed: number
  unavailable?: boolean
}

type Sb = ReturnType<typeof createSupabaseServiceClient>

const mark = (
  sb: Sb,
  reference: string,
  status: 'paid' | 'failed' | 'processing',
  code: string | null,
  error: string | null,
) =>
  sb.rpc('payout_mark', { p_reference: reference, p_status: status, p_code: code, p_error: error })

/** Pays every shop whose waiting time is over. Safe to repeat and to run twice at once: the database hands each payout to one caller. */
export async function releasePayouts(limit = 25): Promise<ReleaseResult> {
  const sb = createSupabaseServiceClient()
  const out: ReleaseResult = { claimed: 0, paid: 0, pending: 0, failed: 0 }
  const { data, error } = await sb.rpc('payout_claim_due', { p_limit: limit })
  if (error) {
    logger.error('payout_claim_due failed', { code: error.code })
    throw new Error('payout claim failed')
  }
  const rows = (data ?? []) as Claimed[]
  out.claimed = rows.length
  for (const row of rows) {
    const result = await payOne(sb, row)
    if (result === 'paid') out.paid++
    else if (result === 'pending') out.pending++
    else if (result === 'unavailable') {
      out.unavailable = true
      // leave it processing: the next run asks Paystack about the same reference before doing anything
    } else out.failed++
  }
  if (out.failed > 0) notifyAdmin({ type: 'payout_failed', count: out.failed })
  return out
}

async function payOne(
  sb: Sb,
  row: Claimed,
): Promise<'paid' | 'pending' | 'failed' | 'unavailable'> {
  const amount = Number(row.o_amount)
  try {
    // a run that stopped half way: find out what happened to the transfer before doing anything else
    if (row.o_resume) {
      const known = await verifyTransfer(row.o_reference)
      if (known && known.state !== 'failed') return await settle(sb, row, known)
      if (known && known.state === 'failed') {
        await mark(sb, row.o_reference, 'failed', known.code, 'transfer failed')
        return 'failed'
      }
      // Paystack has no record of it: it never left, so it is safe to start it now
    }
    const { data: bank } = await sb
      .from('vendor_bank_accounts')
      .select('bank_code, account_name, account_cipher, paystack_recipient_code')
      .eq('vendor_id', row.o_vendor)
      .maybeSingle()
    if (!bank) {
      await mark(sb, row.o_reference, 'failed', null, 'The shop has no verified bank account yet')
      return 'failed'
    }
    let recipient = bank.paystack_recipient_code as string | null
    if (!recipient) {
      recipient = await createTransferRecipient({
        name: bank.account_name as string,
        accountNumber: decryptField(bank.account_cipher as string),
        bankCode: bank.bank_code as string,
      })
      await sb.rpc('payout_set_recipient', { p_vendor: row.o_vendor, p_code: recipient })
    }
    let started: TransferOutcome = await startTransfer({
      amountKobo: amount,
      recipient,
      reference: row.o_reference,
      reason: 'AFIT Market payout',
    })
    if (started.state === 'duplicate') {
      const known = await verifyTransfer(row.o_reference)
      if (!known) throw new Error('duplicate reference but no record')
      started = known
    }
    if (started.state === 'otp') {
      // Test mode asks for a code on every transfer; live mode must have "confirm transfers" switched off in Paystack settings.
      const code = started.code
      if (!code) throw new Error('otp without a transfer code')
      started = await finalizeTestTransfer(code)
    }
    return await settle(sb, row, started)
  } catch (e) {
    if (e instanceof PaymentsUnavailable) return 'unavailable'
    // network trouble or a Paystack outage: stay "processing" so the same reference is checked next time
    logger.error('payout attempt failed', { payout: row.o_id, err: String(e).slice(0, 160) })
    return 'unavailable'
  }
}

async function settle(
  sb: Sb,
  row: Claimed,
  r: TransferOutcome,
): Promise<'paid' | 'pending' | 'failed'> {
  if (r.state === 'duplicate') return 'pending'
  if (r.state === 'paid') {
    await mark(sb, row.o_reference, 'paid', r.code, null)
    return 'paid'
  }
  if (r.state === 'pending') {
    await mark(sb, row.o_reference, 'processing', r.code, null)
    return 'pending'
  }
  await mark(
    sb,
    row.o_reference,
    'failed',
    r.code,
    r.message ?? (r.state === 'otp' ? 'otp_required' : 'transfer failed'),
  )
  return 'failed'
}
