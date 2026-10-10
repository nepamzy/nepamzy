import { describe, expect, it } from 'vitest'
import { redact } from './logger'

describe('redact', () => {
  it('hides sensitive keys at any depth', () => {
    const out = redact({
      user: 'a',
      password: 'x',
      nested: { access_token: 't', otpCode: '123456', ok: 1 },
      list: [{ secret: 's' }],
    }) as Record<string, unknown>
    expect(JSON.stringify(out)).not.toMatch(/"x"|"t"|123456|"s"/)
    expect(out.user).toBe('a')
  })
})
