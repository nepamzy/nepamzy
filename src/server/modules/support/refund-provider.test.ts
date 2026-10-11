import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('refund provider boundary', () => {
  it('the fake provider answers deterministically and labels itself as fake', async () => {
    vi.stubEnv('APP_ENV', 'local')
    const { getRefundProvider } = await import('./refund-provider')
    const p = getRefundProvider()
    expect(p.mode).toBe('fake')
    const ok = await p.execute(
      { refundId: '11111111-2222-3333-4444-555555555555', amountKobo: 100 },
      'success',
    )
    expect(ok.outcome).toBe('succeeded')
    expect(ok.providerRef).toBe('fake_re_1111111122223333')
    expect(ok.detail).toMatch(/FAKE/)
    expect((await p.execute({ refundId: 'x', amountKobo: 1 }, 'failure')).outcome).toBe('failed')
    const t = await p.execute({ refundId: 'x', amountKobo: 1 }, 'timeout')
    expect(t).toMatchObject({ outcome: 'unknown', providerRef: null })
  })
  it.each(['production', 'staging', '', 'LOCAL ', 'unknown'])(
    'fails closed when APP_ENV=%j',
    async (env) => {
      vi.stubEnv('APP_ENV', env)
      const { getRefundProvider } = await import('./refund-provider')
      expect(() => getRefundProvider()).toThrow('refund_provider_not_configured')
    },
  )
})
