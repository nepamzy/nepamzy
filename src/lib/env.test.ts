import { afterEach, describe, expect, it } from 'vitest'
import { appEnv, mockPaymentsAllowed, paystackConfig, serverEnv, serviceEnv } from './env'

const keep = { ...process.env }
afterEach(() => {
  process.env = { ...keep }
})

describe('env validation', () => {
  it('fails fast naming variables but never printing values', () => {
    process.env.SUPABASE_URL = 'not-a-url-SECRETVALUE'
    process.env.SITE_URL = 'http://127.0.0.1:3000'
    process.env.SUPABASE_PUBLISHABLE_KEY = 'short'
    let msg = ''
    try {
      serverEnv()
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/SUPABASE_URL/)
    expect(msg).toMatch(/SUPABASE_PUBLISHABLE_KEY/)
    expect(msg).not.toMatch(/SECRETVALUE/)
  })
  it('requires the service key separately', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => serviceEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
  it('APP_ENV fails closed: unset or unknown values mean production (no mock payments)', () => {
    delete process.env.APP_ENV
    expect(appEnv()).toBe('production')
    expect(mockPaymentsAllowed()).toBe(false)
    process.env.APP_ENV = 'LOCAL'
    expect(mockPaymentsAllowed()).toBe(false)
    process.env.APP_ENV = 'banana'
    expect(appEnv()).toBe('production')
    process.env.APP_ENV = 'staging'
    expect(mockPaymentsAllowed()).toBe(false)
    process.env.APP_ENV = 'production'
    expect(mockPaymentsAllowed()).toBe(false)
    process.env.APP_ENV = 'local'
    expect(mockPaymentsAllowed()).toBe(true)
  })

  it('Paystack: only test keys are accepted; live or malformed keys disable payments', () => {
    process.env.APP_ENV = 'production'
    delete process.env.PAYSTACK_BASE_URL
    for (const bad of [
      undefined,
      '',
      'sk_live_abc_defg_hijkl',
      'pk_test_abc_defg_hijkl',
      'sk_test_',
      'sk_test_short',
    ]) {
      if (bad === undefined) delete process.env.PAYSTACK_SECRET_KEY
      else process.env.PAYSTACK_SECRET_KEY = bad
      expect(paystackConfig()).toBeNull()
    }
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc_defg_hijkl'
    expect(paystackConfig()).toEqual({
      secretKey: 'sk_test_abc_defg_hijkl',
      baseUrl: 'https://api.paystack.co',
    })
  })
  it('Paystack: a custom base URL is honoured only when APP_ENV=local', () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc_defg_hijkl'
    process.env.PAYSTACK_BASE_URL = 'http://127.0.0.1:3002/'
    process.env.APP_ENV = 'local'
    expect(paystackConfig()?.baseUrl).toBe('http://127.0.0.1:3002')
    process.env.APP_ENV = 'production'
    expect(paystackConfig()?.baseUrl).toBe('https://api.paystack.co')
  })
})
