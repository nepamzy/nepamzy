import { describe, expect, it } from 'vitest'
import { transferState } from './paystack'

describe('transferState', () => {
  it('folds Paystack words into paid, pending, failed and otp', () => {
    expect(transferState('success')).toBe('paid')
    expect(transferState('otp')).toBe('otp')
    for (const w of ['failed', 'reversed', 'rejected', 'blocked'])
      expect(transferState(w)).toBe('failed')
    for (const w of ['pending', 'received', 'processing', undefined, 'something-new'])
      expect(transferState(w)).toBe('pending')
  })
})
