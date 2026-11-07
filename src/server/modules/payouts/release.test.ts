import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  rpc,
  bank,
  notifyAdmin,
  startTransfer,
  verifyTransfer,
  createTransferRecipient,
  finalizeTestTransfer,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  bank: vi.fn(),
  notifyAdmin: vi.fn(),
  startTransfer: vi.fn(),
  verifyTransfer: vi.fn(),
  createTransferRecipient: vi.fn(),
  finalizeTestTransfer: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: bank }) }) }),
  }),
}))
vi.mock('@/server/modules/engagement/admin-alerts', () => ({ notifyAdmin }))
vi.mock('@/server/security/field-crypto', () => ({ decryptField: () => '0123456789' }))
vi.mock('@/server/modules/payments/paystack', () => {
  class PaymentsUnavailable extends Error {}
  return {
    PaymentsUnavailable,
    startTransfer,
    verifyTransfer,
    createTransferRecipient,
    finalizeTestTransfer,
  }
})
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { releasePayouts } from './release'

const row = (over: Record<string, unknown> = {}) => ({
  o_id: 'p1',
  o_vendor: 'v1',
  o_amount: 285_750,
  o_reference: 'afitpo-' + 'a'.repeat(32) + '-1',
  o_attempts: 1,
  o_resume: false,
  ...over,
})
const marks = () => rpc.mock.calls.filter((c) => c[0] === 'payout_mark').map((c) => c[1])

beforeEach(() => {
  vi.clearAllMocks()
  bank.mockResolvedValue({
    data: {
      bank_code: '058',
      account_name: 'MAMA PUT',
      account_cipher: 'x',
      paystack_recipient_code: 'RCP_abc12345',
    },
  })
  rpc.mockImplementation(async (name: string) =>
    name === 'payout_claim_due' ? { data: [row()], error: null } : { data: null, error: null },
  )
})

describe('releasePayouts', () => {
  it('pays a due payout and records it as paid', async () => {
    startTransfer.mockResolvedValue({ state: 'paid', code: 'TRF_1', message: null })
    const r = await releasePayouts()
    expect(r).toMatchObject({ claimed: 1, paid: 1, failed: 0 })
    expect(startTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 285_750, recipient: 'RCP_abc12345' }),
    )
    expect(marks()).toEqual([
      expect.objectContaining({
        p_status: 'paid',
        p_code: 'TRF_1',
        p_reference: row().o_reference,
      }),
    ])
    expect(notifyAdmin).not.toHaveBeenCalled()
  })

  it('saves the shop as a Paystack recipient the first time, and waits for the result when the transfer is pending', async () => {
    bank.mockResolvedValue({
      data: {
        bank_code: '058',
        account_name: 'MAMA PUT',
        account_cipher: 'x',
        paystack_recipient_code: null,
      },
    })
    createTransferRecipient.mockResolvedValue('RCP_new12345')
    startTransfer.mockResolvedValue({ state: 'pending', code: 'TRF_2', message: null })
    const r = await releasePayouts()
    expect(createTransferRecipient).toHaveBeenCalledWith({
      name: 'MAMA PUT',
      accountNumber: '0123456789',
      bankCode: '058',
    })
    expect(rpc).toHaveBeenCalledWith('payout_set_recipient', {
      p_vendor: 'v1',
      p_code: 'RCP_new12345',
    })
    expect(r).toMatchObject({ paid: 0, pending: 1 })
    expect(marks()[0]).toMatchObject({ p_status: 'processing', p_code: 'TRF_2' })
  })

  it('marks a payout failed and alerts the owner when the shop has no bank account', async () => {
    bank.mockResolvedValue({ data: null })
    const r = await releasePayouts()
    expect(r.failed).toBe(1)
    expect(startTransfer).not.toHaveBeenCalled()
    expect(marks()[0]).toMatchObject({ p_status: 'failed' })
    expect(notifyAdmin).toHaveBeenCalledWith({ type: 'payout_failed', count: 1 })
  })

  it('records a refusal from Paystack (for example a low balance) as failed', async () => {
    startTransfer.mockResolvedValue({
      state: 'failed',
      code: null,
      message: 'Your balance is not enough',
    })
    const r = await releasePayouts()
    expect(r.failed).toBe(1)
    expect(marks()[0]).toMatchObject({ p_status: 'failed', p_error: 'Your balance is not enough' })
  })

  it('after a run that stopped half way, asks Paystack first and never sends a second transfer', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'payout_claim_due'
        ? { data: [row({ o_resume: true })], error: null }
        : { data: null, error: null },
    )
    verifyTransfer.mockResolvedValue({ state: 'paid', code: 'TRF_3', message: null })
    const r = await releasePayouts()
    expect(r.paid).toBe(1)
    expect(startTransfer).not.toHaveBeenCalled()
    expect(marks()[0]).toMatchObject({ p_status: 'paid', p_code: 'TRF_3' })
  })

  it('starts the transfer for a resumed payout only when Paystack has no record of it', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'payout_claim_due'
        ? { data: [row({ o_resume: true })], error: null }
        : { data: null, error: null },
    )
    verifyTransfer.mockResolvedValue(null)
    startTransfer.mockResolvedValue({ state: 'paid', code: 'TRF_4', message: null })
    expect((await releasePayouts()).paid).toBe(1)
    expect(startTransfer).toHaveBeenCalledTimes(1)
  })

  it('treats a repeated reference as "already sent" and reads the real outcome', async () => {
    startTransfer.mockResolvedValue({ state: 'duplicate' })
    verifyTransfer.mockResolvedValue({ state: 'paid', code: 'TRF_5', message: null })
    expect((await releasePayouts()).paid).toBe(1)
  })

  it('finishes a test-mode transfer that asks for a code', async () => {
    startTransfer.mockResolvedValue({ state: 'otp', code: 'TRF_6', message: null })
    finalizeTestTransfer.mockResolvedValue({ state: 'paid', code: 'TRF_6', message: null })
    expect((await releasePayouts()).paid).toBe(1)
    expect(finalizeTestTransfer).toHaveBeenCalledWith('TRF_6')
  })

  it('leaves the payout "processing" when Paystack cannot be reached, so the same reference is checked next time', async () => {
    startTransfer.mockRejectedValue(new Error('Paystack responded 503'))
    const r = await releasePayouts()
    expect(r.unavailable).toBe(true)
    expect(marks()).toEqual([])
    expect(notifyAdmin).not.toHaveBeenCalled()
  })

  it('does nothing when no payout is due', async () => {
    rpc.mockImplementation(async () => ({ data: [], error: null }))
    expect(await releasePayouts()).toEqual({ claimed: 0, paid: 0, pending: 0, failed: 0 })
  })
})
