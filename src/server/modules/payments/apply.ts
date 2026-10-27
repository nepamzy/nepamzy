import 'server-only'
import { alertablePaymentOutcome, notifyAdmin } from '@/server/modules/engagement/admin-alerts'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import type { PaymentEventCall } from './events'

/** Hands a verified event to the database, which is idempotent and decides what it means. */
export async function applyPaymentEvent(c: PaymentEventCall): Promise<string> {
  const { data, error } = await createSupabaseServiceClient().rpc('payment_apply_event', {
    p_event_id: c.eventId,
    p_event_type: c.type,
    p_reference: c.reference,
    p_amount: c.amountKobo,
    p_currency: c.currency,
    p_payload: c.payload,
  })
  if (error) throw new Error(`payment_apply_event failed: ${error.code ?? ''}`)
  const outcome = String(data)
  if (alertablePaymentOutcome(outcome))
    notifyAdmin({
      type: 'payment',
      outcome,
      amountKobo: c.amountKobo,
      currency: c.currency,
      reference: c.reference,
    })
  return outcome
}
