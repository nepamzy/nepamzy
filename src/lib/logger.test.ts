import { describe, expect, it } from 'vitest'
import { formatLine, redact } from './logger'

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

describe('formatLine', () => {
  it('includes the request id when there is one, and redacts secrets either way', () => {
    const withId = JSON.parse(formatLine('info', 'hello', { password: 'x', ok: 1 }, 'req-123'))
    expect(withId.requestId).toBe('req-123')
    expect(withId.password).toBe('[redacted]')
    expect(JSON.parse(formatLine('info', 'hello', {})).requestId).toBeUndefined()
  })
})
