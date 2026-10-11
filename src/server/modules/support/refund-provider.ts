import 'server-only'
import { mockPaymentsAllowed } from '@/lib/env'

/**
 * The refund provider boundary. In this release ONLY a clearly labelled FAKE provider exists, and only in the local
 * environment. It never contacts any service and its answers say nothing about how Paystack really behaves (K19/K30).
 * Real execution is deliberately not implemented: asking for it fails closed.
 */
export type FakeScenario = 'success' | 'failure' | 'timeout'
export type ProviderOutcome = {
  outcome: 'succeeded' | 'failed' | 'unknown'
  providerRef: string | null
  detail: string
}
export interface RefundProvider {
  readonly mode: 'fake'
  execute(
    input: { refundId: string; amountKobo: number },
    scenario: FakeScenario,
  ): Promise<ProviderOutcome>
}

export class RefundProviderUnavailable extends Error {
  constructor() {
    super('refund_provider_not_configured')
  }
}

export const fakeRefundProvider: RefundProvider = {
  mode: 'fake',
  async execute({ refundId }, scenario) {
    if (scenario === 'failure')
      return { outcome: 'failed', providerRef: null, detail: 'FAKE provider declined the refund' }
    if (scenario === 'timeout')
      return {
        outcome: 'unknown',
        providerRef: null,
        detail: 'FAKE provider did not answer in time',
      }
    return {
      outcome: 'succeeded',
      providerRef: `fake_re_${refundId.replaceAll('-', '').slice(0, 16)}`,
      detail: 'FAKE provider accepted (no money moved)',
    }
  },
}

/** Fails closed: outside the local environment there is no provider at all. */
export function getRefundProvider(): RefundProvider {
  if (!mockPaymentsAllowed()) throw new RefundProviderUnavailable()
  return fakeRefundProvider
}
